import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EMPTY, catchError, distinctUntilChanged, switchMap } from 'rxjs';
import { BarChart } from '../../charts/bar-chart/bar-chart';
import { LineChart } from '../../charts/line-chart/line-chart';
import { ChartPoint } from '../../charts/chart-utils';
import { ApiService, Dashboard, DashboardPersonStat, TurnoutBucket } from '../../services/api';
import { visitorMaxSessions } from '../../services/attendance-data';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe } from '../../pipes/localized-date';
import { readStored, writeStored } from '../../tools';

type PersonStat = DashboardPersonStat;

type RangePreset = '30d' | '90d' | '6m' | '12m' | 'all';
type Grouping = 'day' | 'week' | 'month';

/** Who counts as "absent lately": see `absentLately`. */
interface AbsentParams {
  /** Attended at least this percentage of the range's sessions… */
  minRate: number;
  /** …and missed each of its last this-many sessions. */
  sessions: number;
}

const PRESETS: { id: RangePreset; labelKey: string }[] = [
  { id: '30d', labelKey: 'dashboards.range30d' },
  { id: '90d', labelKey: 'dashboards.range90d' },
  { id: '6m', labelKey: 'dashboards.range6m' },
  { id: '12m', labelKey: 'dashboards.range12m' },
  { id: 'all', labelKey: 'dashboards.rangeAll' },
];

const GROUPINGS: { id: Grouping; labelKey: string }[] = [
  { id: 'day', labelKey: 'dashboards.groupDay' },
  { id: 'week', labelKey: 'dashboards.groupWeek' },
  { id: 'month', labelKey: 'dashboards.groupMonth' },
];

const STORAGE = {
  preset: 'auto-attendance.dashboards.range',
  grouping: 'auto-attendance.dashboards.grouping',
  hiddenWeekdays: 'auto-attendance.dashboards.hiddenWeekdays',
  absent: 'auto-attendance.dashboards.absent',
};

const DEFAULT_ABSENT: AbsentParams = { minRate: 25, sessions: 8 };

const isPreset = (v: unknown): v is RangePreset => PRESETS.some(p => p.id === v);
const isGrouping = (v: unknown): v is Grouping => GROUPINGS.some(g => g.id === v);
const isWeekdayList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(d => typeof d === 'string');
const isAbsentParams = (v: unknown): v is AbsentParams => {
  const p = v as AbsentParams;
  return !!p && validRate(p.minRate) && validSessions(p.sessions);
};
const validRate = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100;
const validSessions = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 999;

/** Parse an ISO date as local midnight, so weekdays don't shift by a timezone. */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function isoOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Monday = 1 … Sunday = 7, matching the translation keys. */
function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

@Component({
  selector: 'app-dashboards',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalizedDatePipe, BarChart, LineChart],
  templateUrl: './dashboards.html',
  styleUrl: './dashboards.scss',
})
export class Dashboards {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  readonly presets = PRESETS;
  readonly groupings = GROUPINGS;

  /** Numbers for the selected range, aggregated by the server. */
  dashboard = signal<Dashboard | null>(null);
  loading = signal(true);
  error = signal('');

  preset = signal<RangePreset>(readStored(STORAGE.preset, '6m', isPreset));
  customStart = signal('');
  customEnd = signal('');
  showAllAttendees = signal(false);

  grouping = signal<Grouping>(readStored(STORAGE.grouping, 'week', isGrouping));
  /** Weekdays (keys "1".."7") unticked on the weekday chart. */
  hiddenWeekdays = signal<Set<string>>(new Set(readStored(STORAGE.hiddenWeekdays, [], isWeekdayList)));

  /** The absence rule in use, and the one being typed in the advanced options. */
  absentParams = signal<AbsentParams>(readStored(STORAGE.absent, DEFAULT_ABSENT, isAbsentParams));
  absentDraft = signal<AbsentParams>({ ...this.absentParams() });

  constructor() {
    toObservable(computed(() => `${this.rangeStart() ?? ''}|${this.customEnd()}`)).pipe(
      distinctUntilChanged(),
      switchMap(() =>
        this.api.getDashboard(this.rangeStart(), this.customEnd() || null).pipe(
          catchError(err => {
            this.error.set(
              (err as { error?: { detail?: string } })?.error?.detail
                ?? this.translate.instant('dashboards.loadFailed')
            );
            this.loading.set(false);
            return EMPTY;
          })
        )
      ),
      takeUntilDestroyed(),
    ).subscribe(dashboard => {
      this.dashboard.set(dashboard);
      this.error.set('');
      this.loading.set(false);
    });
  }

  /** Translate inside a computed: reading the language signal keeps it reactive. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.language.language();
    return this.translate.instant(key, params);
  }

  // ── Range filter ────────────────────────────────────────────────────────
  setPreset(preset: RangePreset) {
    this.preset.set(preset);
    this.customStart.set('');
    this.customEnd.set('');
    writeStored(STORAGE.preset, preset);
  }

  isPresetActive(preset: RangePreset): boolean {
    if (this.customStart()) return false;
    return this.preset() === preset && (preset !== 'all' || !this.customEnd());
  }

  onCustomStart(event: Event) { this.customStart.set((event.target as HTMLInputElement).value); }
  onCustomEnd(event: Event) { this.customEnd.set((event.target as HTMLInputElement).value); }

  private rangeStart = computed<string | null>(() => {
    if (this.customStart()) return this.customStart();
    const preset = this.preset();
    if (preset === 'all') return null;
    const today = new Date();
    const from = new Date(today);
    if (preset === '30d') from.setDate(today.getDate() - 30);
    if (preset === '90d') from.setDate(today.getDate() - 90);
    if (preset === '6m') from.setMonth(today.getMonth() - 6);
    if (preset === '12m') from.setMonth(today.getMonth() - 12);
    return isoOf(from);
  });

  sessions = computed(() => (this.dashboard()?.per_session ?? []).map(s => s.date));

  rangeLabel = computed(() => {
    const sessions = this.sessions();
    if (sessions.length === 0) return this.t('dashboards.noSessions');
    const first = this.language.formatDate(sessions[0]);
    const last = this.language.formatDate(sessions[sessions.length - 1]);
    return `${first} → ${last}`;
  });

  registeredPeople = computed(() => this.dashboard()?.registered_people ?? 0);

  hasData = computed(() => this.sessions().length > 0 && this.registeredPeople() > 0);

  /** People with at least one presence in range. */
  activeStats = computed<PersonStat[]>(() => this.dashboard()?.people ?? []);

  // ── Headline numbers ────────────────────────────────────────────────────
  averageAttendance = computed(() => this.dashboard()?.average_attendance ?? 0);

  bestSession = computed(() => this.dashboard()?.best_session ?? null);

  // ── People present, per session / week / month ──────────────────────────
  setGrouping(grouping: Grouping) {
    this.grouping.set(grouping);
    writeStored(STORAGE.grouping, grouping);
  }

  private turnoutMeta(bucket: TurnoutBucket): string {
    return this.t('dashboards.turnoutMeta', {
      sessions: bucket.sessions,
      average: (bucket.presences / bucket.sessions).toFixed(1),
    });
  }

  turnoutPoints = computed<ChartPoint[]>(() => {
    const dashboard = this.dashboard();
    if (!dashboard) return [];
    switch (this.grouping()) {
      case 'week':
        return dashboard.per_week.map(bucket => ({
          label: this.t('dashboards.weekOf', { date: this.language.formatDate(bucket.key) }),
          axisLabel: this.language.formatDayMonth(bucket.key),
          value: bucket.people,
          meta: this.turnoutMeta(bucket),
        }));
      case 'month':
        return dashboard.per_month.map(bucket => {
          const [year, month] = bucket.key.split('-');
          return {
            label: `${this.t(`months.${Number(month)}`)} ${year}`,
            axisLabel: `${this.t(`months.${Number(month)}`)} ${year.slice(2)}`,
            value: bucket.people,
            meta: this.turnoutMeta(bucket),
          };
        });
      default:
        return dashboard.per_session.map(({ date, count }) => ({
          label: this.language.formatDate(date),
          axisLabel: this.language.formatDayMonth(date),
          value: count,
          meta: this.t(`weekdays.${isoWeekday(parseDate(date))}`),
        }));
    }
  });

  turnoutTitle = computed(() => this.t(`dashboards.turnoutTitle.${this.grouping()}`));
  turnoutSubtitle = computed(() => this.t(`dashboards.turnoutSubtitle.${this.grouping()}`));
  turnoutCategory = computed(() => this.t(`dashboards.turnoutCategory.${this.grouping()}`));
  turnoutValue = computed(() => this.t('dashboards.perSessionValue'));

  // ── Average turnout by weekday ──────────────────────────────────────────
  /** Weekdays with a session in range: the only ones worth a checkbox. */
  weekdayOptions = computed(() =>
    (this.dashboard()?.weekdays ?? []).map(bucket => ({
      key: bucket.key,
      label: this.t(`weekdays.${bucket.key}`),
    }))
  );

  toggleWeekday(key: string) {
    const hidden = new Set(this.hiddenWeekdays());
    hidden.has(key) ? hidden.delete(key) : hidden.add(key);
    this.hiddenWeekdays.set(hidden);
    writeStored(STORAGE.hiddenWeekdays, [...hidden].sort());
  }

  weekdayPoints = computed<ChartPoint[]>(() =>
    (this.dashboard()?.weekdays ?? [])
      .filter(bucket => !this.hiddenWeekdays().has(bucket.key))
      .map(bucket => ({
        label: this.t(`weekdays.${bucket.key}`),
        value: bucket.presences / bucket.sessions,
        meta: this.t('dashboards.sessionsMeta', { count: bucket.sessions }),
      }))
  );

  // Chart chrome, translated.
  weekdayTitle = computed(() => this.t('dashboards.weekdayTitle'));
  weekdaySubtitle = computed(() => this.t('dashboards.weekdaySubtitle'));
  weekdayCategory = computed(() => this.t('dashboards.weekdayCategory'));
  averagePeople = computed(() => this.t('dashboards.averagePeople'));

  // ── Ranked tables ───────────────────────────────────────────────────────
  ranked = computed(() =>
    [...this.activeStats()].sort(
      (a, b) => b.attended - a.attended || a.person.name.localeCompare(b.person.name)
    )
  );

  topAttendees = computed(() =>
    this.showAllAttendees() ? this.ranked() : this.ranked().slice(0, 10)
  );

  // ── Absent lately ───────────────────────────────────────────────────────
  /**
   * Regulars gone quiet: present in at least `minRate`% of the range's sessions, yet
   * missing from each of its last `sessions` ones. Worked out from the numbers already
   * loaded, so changing the rule costs no request.
   */
  absentLately = computed(() => {
    const { minRate, sessions } = this.absentParams();
    const total = this.sessions().length;
    return this.activeStats()
      .filter(s => s.attended * 100 >= minRate * total && s.missed_in_a_row >= sessions)
      .sort((a, b) => b.missed_in_a_row - a.missed_in_a_row || b.attended - a.attended
        || a.person.name.localeCompare(b.person.name));
  });

  absentExplanation = computed(() => {
    const { minRate, sessions } = this.absentParams();
    return this.t('dashboards.absentExplanation', { rate: minRate, count: sessions });
  });

  absentDraftValid = computed(() => {
    const draft = this.absentDraft();
    return validRate(draft.minRate) && validSessions(draft.sessions);
  });

  absentDraftChanged = computed(() => {
    const draft = this.absentDraft();
    const applied = this.absentParams();
    return draft.minRate !== applied.minRate || draft.sessions !== applied.sessions;
  });

  onAbsentDraft(field: keyof AbsentParams, event: Event) {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.absentDraft.update(draft => ({ ...draft, [field]: value }));
  }

  applyAbsent() {
    if (!this.absentDraftValid()) return;
    const params = { ...this.absentDraft() };
    this.absentParams.set(params);
    writeStored(STORAGE.absent, params);
  }

  resetAbsent() {
    this.absentDraft.set({ ...DEFAULT_ABSENT });
  }

  absenceMeta(stat: PersonStat): string {
    return this.t('dashboards.absentMeta', {
      count: stat.missed_in_a_row,
      rate: this.percent(stat.rate),
      date: this.language.formatDate(stat.last_seen),
    });
  }

  // ── Visitors ────────────────────────────────────────────────────────────
  visitors = computed(() => this.dashboard()?.visitors ?? []);

  visitorExplanation = computed(() => {
    const dashboard = this.dashboard();
    if (!dashboard) return '';
    return this.t('people.visitorHint', {
      percent: dashboard.visitor_percent,
      max: visitorMaxSessions(dashboard.all_sessions, dashboard.visitor_percent),
      total: dashboard.all_sessions,
    });
  });

  // ── Presentation helpers ────────────────────────────────────────────────
  percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  oneDecimal(value: number): string {
    return value.toFixed(1);
  }

  manualTitle(stat: PersonStat): string {
    return this.t('dashboards.manualFlagTitle', { count: stat.manual });
  }

  selfieUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
