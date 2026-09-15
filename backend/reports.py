"""
Attendance reports computed on the server: the dashboards and the Excel export.

Both need every presence ever recorded. Aggregating here means the browser receives
a handful of numbers (or a finished file) instead of the whole attendance history.
"""
import datetime as dt
import io
import re
from typing import Literal, Optional

import xlsxwriter
from sqlalchemy.orm import Session, defer

import models
import schemas

DateOrder = Literal["dmy", "mdy"]

#: Attendance-rate bands of the dashboard histogram. Upper bounds are exclusive;
#: the last one is past 100% so a perfect rate still lands in it.
RATE_BANDS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]

PersonEntries = tuple[models.KnownPerson, dict[dt.date, schemas.AttendanceEntry]]


def format_date(date: dt.date, order: DateOrder) -> str:
    """Write a date the way the interface language does (see LanguageService.formatDate)."""
    return date.strftime("%d/%m/%Y" if order == "dmy" else "%m/%d/%Y")


def attendance_dates(db: Session) -> set[dt.date]:
    """Every date with a presence recorded against anyone, Unknown faces included."""
    auto = (
        db.query(models.GroupPhoto.date)
        .join(models.AttendanceDetection, models.AttendanceDetection.photo_id == models.GroupPhoto.id)
        .filter(models.AttendanceDetection.person_id.isnot(None))
        .distinct()
    )
    manual = db.query(models.ManualAttendance.date).distinct()
    return {d for (d,) in auto} | {d for (d,) in manual}


def grouped_attendance(db: Session, dates: Optional[list[dt.date]] = None) -> list[PersonEntries]:
    """
    Each labelled name with its presences, in order of the name's oldest row.

    Labelling faces renames rows rather than merging them, so one name can own several
    rows; they are joined here. Unknown faces are left out. Pass `dates` to only load
    presences on those dates.
    """
    persons = (
        db.query(models.KnownPerson)
        .options(defer(models.KnownPerson.embedding))
        .filter(models.KnownPerson.name != models.UNKNOWN_NAME)
        .order_by(models.KnownPerson.id)
        .all()
    )
    name_by_id = {p.id: p.name for p in persons}

    groups: dict[str, PersonEntries] = {}
    for person in persons:
        groups.setdefault(person.name, (person, {}))

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
        name = name_by_id.get(person_id)
        if name is not None:
            groups[name][1][date] = schemas.AttendanceEntry(date=date, source="auto")

    for row in manual:
        name = name_by_id.get(row.person_id)
        if name is None:
            continue
        # A face found in a photo outranks a hand-added entry for the same day.
        groups[name][1].setdefault(
            row.date,
            schemas.AttendanceEntry(date=row.date, source="manual", manual_id=row.id, note=row.note),
        )

    return list(groups.values())


# ── Dashboards ─────────────────────────────────────────────────────────────────

def _trailing(flags: list, present: bool) -> int:
    """How many flags in a row, counting back from the end, are (not) present."""
    count = 0
    for flag in reversed(flags):
        if bool(flag) != present:
            break
        count += 1
    return count


def build_dashboard(
    db: Session, start_date: Optional[dt.date], end_date: Optional[dt.date]
) -> schemas.DashboardOut:
    photo_dates = {d for (d,) in db.query(models.GroupPhoto.date).distinct()}
    manual_dates = {d for (d,) in db.query(models.ManualAttendance.date).distinct()}
    # A session is any day with a photo, plus any day someone was registered on.
    sessions = sorted(
        d for d in photo_dates | manual_dates
        if (start_date is None or d >= start_date) and (end_date is None or d <= end_date)
    )
    people = grouped_attendance(db)

    counts = dict.fromkeys(sessions, 0)
    stats: list[schemas.DashboardPersonStat] = []
    for person, entries in people:
        flags = [entries.get(d) for d in sessions]
        attended = [d for d, flag in zip(sessions, flags) if flag]
        if not attended:
            continue
        for d in attended:
            counts[d] += 1
        stats.append(
            schemas.DashboardPersonStat(
                person=person,
                attended=len(attended),
                rate=len(attended) / len(sessions),
                last_seen=attended[-1],
                current_streak=_trailing(flags, present=True),
                missed_in_a_row=_trailing(flags, present=False),
                manual=sum(1 for flag in flags if flag and flag.source == "manual"),
            )
        )

    per_session = [schemas.SessionCount(date=d, count=counts[d]) for d in sessions]
    total = sum(counts.values())

    # Average over the last 5 sessions against the 5 before them.
    average_delta = None
    if len(sessions) >= 10:
        recent = sum(counts[d] for d in sessions[-5:]) / 5
        previous = sum(counts[d] for d in sessions[-10:-5]) / 5
        average_delta = recent - previous

    best_session = None
    for item in per_session:
        if best_session is None or item.count > best_session.count:
            best_session = item

    # First-ever presence in the last 30 days of the range. Anchored to the range's
    # end so the tile still means something with the range set to "all time".
    new_people = 0
    if sessions:
        cutoff = sessions[-1] - dt.timedelta(days=30)
        for _, entries in people:
            if entries:
                first = min(entries)
                if first >= cutoff and first >= sessions[0]:
                    new_people += 1

    weekdays: dict[int, schemas.PeriodBucket] = {}
    months: dict[str, schemas.PeriodBucket] = {}
    for d in sessions:
        for key, buckets in ((d.isoweekday(), weekdays), (d.strftime("%Y-%m"), months)):
            bucket = buckets.setdefault(key, schemas.PeriodBucket(key=str(key), sessions=0, presences=0))
            bucket.sessions += 1
            bucket.presences += counts[d]

    return schemas.DashboardOut(
        registered_people=len(people),
        total_presences=total,
        average_attendance=total / len(sessions) if sessions else 0,
        average_delta=average_delta,
        attendance_rate=total / (len(sessions) * len(stats)) if sessions and stats else 0,
        new_people=new_people,
        best_session=best_session,
        per_session=per_session,
        weekdays=[weekdays[k] for k in sorted(weekdays)],
        months=[months[k] for k in sorted(months)][-12:],
        rate_distribution=[sum(1 for s in stats if low <= s.rate < high) for low, high in RATE_BANDS],
        people=stats,
    )


# ── Excel export ───────────────────────────────────────────────────────────────

def _sheet_name(name: str) -> str:
    """Excel forbids []:*?/\\ in sheet names and caps them at 31 characters."""
    return re.sub(r"[\[\]:*?/\\]", " ", name).strip()[:31] or "Sheet1"


def build_attendance_workbook(
    db: Session,
    *,
    extra_dates: list[dt.date],
    date_order: DateOrder,
    date_label: str,
    present_label: str,
    manual_label: str,
    sheet_name: str,
) -> bytes:
    """One row per date, one column per person, marking who was there."""
    dates = sorted(attendance_dates(db) | set(extra_dates))
    people = grouped_attendance(db)

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    sheet = workbook.add_worksheet(_sheet_name(sheet_name))
    sheet.write_row(0, 0, [date_label, *(person.name for person, _ in people)])
    for row, date in enumerate(dates, start=1):
        cells = [format_date(date, date_order)]
        for _, entries in people:
            entry = entries.get(date)
            if entry is None:
                cells.append("")
            else:
                cells.append(manual_label if entry.source == "manual" else present_label)
        sheet.write_row(row, 0, cells)
    workbook.close()
    return output.getvalue()
