"""
Attendance reports computed on the server: the dashboards and the Excel export.

Both need every presence ever recorded. Aggregating here means the browser receives
a handful of numbers (or a finished file) instead of the whole attendance history.
"""
import datetime as dt
import io
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, Optional

import xlsxwriter
from sqlalchemy.orm import Session, defer
from xlsxwriter.utility import xl_rowcol_to_cell

import models
import schemas

DateOrder = Literal["dmy", "mdy"]

#: A visitor is someone present in fewer than this percentage of every session ever
#: recorded. Integer maths (attended * 100 < percent * sessions) keeps the boundary
#: exact: 3 of 30 sessions is 10%, not a visitor.
VISITOR_PERCENT = 10


@dataclass
class PersonGroup:
    """One person as the interface shows them: every row sharing a name, joined."""
    person: models.KnownPerson                      # the name's oldest row
    ids: list[int] = field(default_factory=list)
    dismissed: bool = False
    entries: dict[dt.date, schemas.AttendanceEntry] = field(default_factory=dict)


PersonEntries = tuple[models.KnownPerson, dict[dt.date, schemas.AttendanceEntry]]


def format_date(date: dt.date, order: DateOrder) -> str:
    """Write a date the way the interface language does (see LanguageService.formatDate)."""
    return date.strftime("%d/%m/%Y" if order == "dmy" else "%m/%d/%Y")


def is_visitor(attended: int, total_sessions: int) -> bool:
    """Present in fewer than VISITOR_PERCENT% of every session ever recorded."""
    return total_sessions > 0 and attended * 100 < VISITOR_PERCENT * total_sessions


def sort_key(name: str) -> str:
    """Alphabetical order that files "Ângela" next to "Angela", not after "Zé"."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _active_manual(db: Session):
    """Manual entries of people who were not dismissed."""
    return (
        db.query(models.ManualAttendance)
        .join(models.KnownPerson, models.ManualAttendance.person_id == models.KnownPerson.id)
        .filter(models.KnownPerson.dismissed_at.is_(None))
    )


def session_dates(db: Session) -> set[dt.date]:
    """
    Every session ever recorded: any day with a photo, plus any day someone was
    registered on by hand (dismissed people's entries don't make a session).
    """
    photos = {d for (d,) in db.query(models.GroupPhoto.date).distinct()}
    manual = {d for (d,) in _active_manual(db).with_entities(models.ManualAttendance.date).distinct()}
    return photos | manual


def attendance_dates(db: Session) -> set[dt.date]:
    """Every date with a presence of someone not dismissed, Unknown faces included."""
    auto = (
        db.query(models.GroupPhoto.date)
        .join(models.AttendanceDetection, models.AttendanceDetection.photo_id == models.GroupPhoto.id)
        .join(models.KnownPerson, models.AttendanceDetection.person_id == models.KnownPerson.id)
        .filter(models.KnownPerson.dismissed_at.is_(None))
        .distinct()
    )
    manual = _active_manual(db).with_entities(models.ManualAttendance.date).distinct()
    return {d for (d,) in auto} | {d for (d,) in manual}


def person_groups(
    db: Session,
    dates: Optional[list[dt.date]] = None,
    *,
    include_unknown: bool = False,
    include_dismissed: bool = False,
) -> list[PersonGroup]:
    """
    Each person with their presences, in order of the name's oldest row.

    Labelling faces renames rows rather than merging them, so one name can own several
    rows; they are joined here. Unknown faces all share a placeholder name but are
    different people, so each one is its own group (and left out unless asked for).
    Dismissed people are left out unless asked for. Pass `dates` to only load
    presences on those dates.
    """
    query = (
        db.query(models.KnownPerson)
        .options(defer(models.KnownPerson.embedding))
        .order_by(models.KnownPerson.id)
    )
    if not include_unknown:
        query = query.filter(models.KnownPerson.name != models.UNKNOWN_NAME)
    persons = query.all()

    groups: dict[str, PersonGroup] = {}
    group_by_id: dict[int, PersonGroup] = {}
    for person in persons:
        key = f"#{person.id}" if person.name == models.UNKNOWN_NAME else person.name
        group = groups.setdefault(key, PersonGroup(person=person))
        group.ids.append(person.id)
        group.dismissed = group.dismissed or person.dismissed_at is not None
        group_by_id[person.id] = group

    auto = (
        db.query(models.AttendanceDetection.person_id, models.GroupPhoto.date)
        .join(models.GroupPhoto, models.AttendanceDetection.photo_id == models.GroupPhoto.id)
        .filter(models.AttendanceDetection.person_id.isnot(None))
    )
    manual = db.query(models.ManualAttendance).order_by(models.ManualAttendance.id)
    if dates is not None:
        auto = auto.filter(models.GroupPhoto.date.in_(dates))
        manual = manual.filter(models.ManualAttendance.date.in_(dates))

    for person_id, date in auto.distinct():
        group = group_by_id.get(person_id)
        if group is not None:
            group.entries[date] = schemas.AttendanceEntry(date=date, source="auto")

    for row in manual:
        group = group_by_id.get(row.person_id)
        if group is None:
            continue
        # A face found in a photo outranks a hand-added entry for the same day.
        group.entries.setdefault(
            row.date,
            schemas.AttendanceEntry(date=row.date, source=row.source, manual_id=row.id, note=row.note),
        )

    return [g for g in groups.values() if include_dismissed or not g.dismissed]


def grouped_attendance(db: Session, dates: Optional[list[dt.date]] = None) -> list[PersonEntries]:
    """Each labelled, not dismissed name with its presences (see `person_groups`)."""
    return [(g.person, g.entries) for g in person_groups(db, dates)]


# ── People ─────────────────────────────────────────────────────────────────────

def people_overview(db: Session) -> schemas.PeopleOverview:
    """Everyone, Unknown faces and dismissed people included, with their all-time count."""
    total = len(session_dates(db))
    people = []
    for group in person_groups(db, include_unknown=True, include_dismissed=True):
        attended = len(group.entries)
        if group.dismissed:
            category = "dismissed"
        elif is_visitor(attended, total):
            category = "visitor"
        else:
            category = "usual"
        people.append(
            schemas.PersonOverview(
                person=group.person,
                ids=group.ids,
                sessions=attended,
                last_seen=max(group.entries) if group.entries else None,
                category=category,
            )
        )
    return schemas.PeopleOverview(people=people, total_sessions=total, visitor_percent=VISITOR_PERCENT)


# ── Dashboards ─────────────────────────────────────────────────────────────────

def _trailing(flags: list, present: bool) -> int:
    """How many flags in a row, counting back from the end, are (not) present."""
    count = 0
    for flag in reversed(flags):
        if bool(flag) != present:
            break
        count += 1
    return count


def _week_key(date: dt.date) -> str:
    """The Monday that starts the date's week, as an ISO date."""
    return (date - dt.timedelta(days=date.weekday())).isoformat()


def _turnout_buckets(
    sessions: list[dt.date],
    counts: dict[dt.date, int],
    attendees: dict[dt.date, set[int]],
    key_of,
) -> list[schemas.TurnoutBucket]:
    buckets: dict[str, schemas.TurnoutBucket] = {}
    people: dict[str, set[int]] = {}
    for d in sessions:
        key = key_of(d)
        bucket = buckets.setdefault(key, schemas.TurnoutBucket(key=key, sessions=0, presences=0, people=0))
        bucket.sessions += 1
        bucket.presences += counts[d]
        people.setdefault(key, set()).update(attendees[d])
    for key, bucket in buckets.items():
        bucket.people = len(people[key])
    return [buckets[k] for k in sorted(buckets)]


def build_dashboard(
    db: Session, start_date: Optional[dt.date], end_date: Optional[dt.date]
) -> schemas.DashboardOut:
    all_sessions = sorted(session_dates(db))
    sessions = [
        d for d in all_sessions
        if (start_date is None or d >= start_date) and (end_date is None or d <= end_date)
    ]
    groups = person_groups(db)

    counts = dict.fromkeys(sessions, 0)
    attendees: dict[dt.date, set[int]] = {d: set() for d in sessions}
    stats: list[schemas.DashboardPersonStat] = []
    visitors: list[schemas.VisitorStat] = []
    for index, group in enumerate(groups):
        flags = [group.entries.get(d) for d in sessions]
        attended = [d for d, flag in zip(sessions, flags) if flag]
        if not attended:
            continue
        for d in attended:
            counts[d] += 1
            attendees[d].add(index)
        stats.append(
            schemas.DashboardPersonStat(
                person=group.person,
                attended=len(attended),
                rate=len(attended) / len(sessions),
                last_seen=attended[-1],
                current_streak=_trailing(flags, present=True),
                missed_in_a_row=_trailing(flags, present=False),
                manual=sum(1 for flag in flags if flag and flag.source == "manual"),
            )
        )
        if is_visitor(len(group.entries), len(all_sessions)):
            visitors.append(
                schemas.VisitorStat(
                    person=group.person,
                    attended=len(attended),
                    total_attended=len(group.entries),
                    last_seen=attended[-1],
                )
            )

    visitors.sort(key=lambda v: (-v.last_seen.toordinal(), sort_key(v.person.name)))

    per_session = [schemas.SessionCount(date=d, count=counts[d]) for d in sessions]
    total = sum(counts.values())

    best_session = None
    for item in per_session:
        if best_session is None or item.count > best_session.count:
            best_session = item

    weekdays: dict[int, schemas.PeriodBucket] = {}
    for d in sessions:
        bucket = weekdays.setdefault(
            d.isoweekday(), schemas.PeriodBucket(key=str(d.isoweekday()), sessions=0, presences=0)
        )
        bucket.sessions += 1
        bucket.presences += counts[d]

    return schemas.DashboardOut(
        registered_people=len(groups),
        total_presences=total,
        average_attendance=total / len(sessions) if sessions else 0,
        best_session=best_session,
        per_session=per_session,
        per_week=_turnout_buckets(sessions, counts, attendees, _week_key),
        per_month=_turnout_buckets(sessions, counts, attendees, lambda d: d.strftime("%Y-%m")),
        weekdays=[weekdays[k] for k in sorted(weekdays)],
        people=stats,
        visitors=visitors,
        all_sessions=len(all_sessions),
        visitor_percent=VISITOR_PERCENT,
    )


# ── Excel export ───────────────────────────────────────────────────────────────

def _sheet_name(name: str) -> str:
    """Excel forbids []:*?/\\ in sheet names and caps them at 31 characters."""
    return re.sub(r"[\[\]:*?/\\]", " ", name).strip()[:31] or "Sheet1"


def _total_format(workbook, label: str):
    """Bold number shown as "Total: 12" while the cell keeps a plain, summable value."""
    safe = re.sub(r'["\\]', "", label).strip() or "Total"
    return workbook.add_format({"bold": True, "num_format": f'"{safe}: "0', "align": "left"})


def build_attendance_workbook(
    db: Session,
    *,
    extra_dates: list[dt.date],
    date_order: DateOrder,
    date_label: str,
    present_label: str,
    manual_label: str,
    total_label: str,
    sheet_name: str,
) -> bytes:
    """
    One row per date, one column per person, marking who was there.

    A totals column closes each date row (presences that day) and a totals row closes
    each person column (presences of that person). The corners hold the number of
    people (top right), of dates (bottom left) and of presences (bottom right). Totals
    are formulas, so they stay right if the sheet is edited; the computed values are
    cached in the file for viewers that don't recalculate.

    Dismissed people are left out. Usual people come first, then visitors, each
    alphabetically.
    """
    dates = sorted(attendance_dates(db) | set(extra_dates))
    total_sessions = len(session_dates(db))
    groups = person_groups(db)
    groups.sort(key=lambda g: (is_visitor(len(g.entries), total_sessions), sort_key(g.person.name)))

    people_count = len(groups)
    total_col = people_count + 1           # column after the last person
    total_row = len(dates) + 1             # row after the last date
    first_person, last_person = 1, people_count
    first_date, last_date = 1, len(dates)

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    sheet = workbook.add_worksheet(_sheet_name(sheet_name))
    bold = workbook.add_format({"bold": True})
    total_fmt = _total_format(workbook, total_label)

    def write_count(row: int, col: int, first: tuple[int, int], last: tuple[int, int], value: int, fmt, func="COUNTA"):
        """A COUNTA/SUM over a range, or a plain number when the range is empty."""
        if first[0] > last[0] or first[1] > last[1]:
            sheet.write_number(row, col, value, fmt)
        else:
            cells = f"{xl_rowcol_to_cell(*first)}:{xl_rowcol_to_cell(*last)}"
            sheet.write_formula(row, col, f"={func}({cells})", fmt, value)

    # Header: names (as strings — a name starting with "=" must not become a formula).
    sheet.write_string(0, 0, date_label, bold)
    for col, group in enumerate(groups, start=1):
        sheet.write_string(0, col, group.person.name, bold)
    write_count(0, total_col, (0, first_person), (0, last_person), people_count, total_fmt)

    column_totals = [0] * people_count
    for row, date in enumerate(dates, start=1):
        sheet.write_string(row, 0, format_date(date, date_order))
        present = 0
        for col, group in enumerate(groups, start=1):
            entry = group.entries.get(date)
            if entry is None:
                continue
            sheet.write_string(row, col, manual_label if entry.source == "manual" else present_label)
            column_totals[col - 1] += 1
            present += 1
        write_count(row, total_col, (row, first_person), (row, last_person), present, bold)

    write_count(total_row, 0, (first_date, 0), (last_date, 0), len(dates), total_fmt)
    for col, value in enumerate(column_totals, start=1):
        write_count(total_row, col, (first_date, col), (last_date, col), value, bold)
    write_count(
        total_row, total_col, (total_row, first_person), (total_row, last_person),
        sum(column_totals), bold, func="SUM",
    )

    sheet.freeze_panes(1, 1)
    sheet.set_column(0, 0, 14)
    workbook.close()
    return output.getvalue()
