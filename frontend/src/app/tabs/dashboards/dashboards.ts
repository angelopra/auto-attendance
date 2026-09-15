import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EMPTY, catchError, distinctUntilChanged, switchMap } from 'rxjs';
import { BarChart } from '../../charts/bar-chart/bar-chart';
import { LineChart } from '../../charts/line-chart/line-chart';
import { ChartPoint, ORDINAL_RAMP } from '../../charts/chart-utils';
import { ApiService, Dashboard, DashboardPersonStat } from '../../services/api';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe } from '../../pipes/localized-date';

type PersonStat = DashboardPersonStat;

type RangePreset = 'all' | '30d' | '90d' | '12m';

/** Labels for the server's rate_distribution, band by band. */
const RATE_BAND_LABELS = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];

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

  /** Numbers for the selected range, aggregated by the server. */
  dashboard = signal<Dashboard | null>(null);
  loading = signal(true);
  error = signal('');

  preset = signal<RangePreset>('all');
  customStart = signal('');
  customEnd = signal('');
  showAllAttendees = signal(false);

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

  /** Average over the last 5 sessions against the 5 before them. */
  averageDelta = computed<number | null>(() => this.dashboard()?.average_delta ?? null);

  attendanceRate = computed(() => this.dashboard()?.attendance_rate ?? 0);

  /** People whose very first recorded presence falls in the last 30 days of the range. */
  newPeople = computed(() => this.dashboard()?.new_people ?? 0);

  bestSession = computed(() => this.dashboard()?.best_session ?? null);

  // ── Charts ──────────────────────────────────────────────────────────────
  perSessionPoints = computed<ChartPoint[]>(() =>
    (this.dashboard()?.per_session ?? []).map(({ date, count }) => ({
      label: this.language.formatDate(date),
      axisLabel: this.language.formatDayMonth(date),
      value: count,
      meta: this.t(`weekdays.${isoWeekday(parseDate(date))}`),
    }))
  );

  weekdayPoints = computed<ChartPoint[]>(() =>
    (this.dashboard()?.weekdays ?? []).map(bucket => ({
      label: this.t(`weekdays.${bucket.key}`),
      value: bucket.presences / bucket.sessions,
      meta: this.t('dashboards.sessionsMeta', { count: bucket.sessions }),
    }))
  );

  monthlyPoints = computed<ChartPoint[]>(() =>
    (this.dashboard()?.months ?? []).map(bucket => {
      const [year, month] = bucket.key.split('-');
      return {
        label: `${this.t(`months.${Number(month)}`)} ${year.slice(2)}`,
        value: bucket.sessions ? bucket.presences / bucket.sessions : 0,
        meta: this.t('dashboards.sessionsPresencesMeta', {
          sessions: bucket.sessions,
          presences: bucket.presences,
        }),
      };
    })
  );

  distributionPoints = computed<ChartPoint[]>(() => {
    const counts = this.dashboard()?.rate_distribution ?? [];
    return RATE_BAND_LABELS.map((label, i) => ({
      label,
      value: counts[i] ?? 0,
      meta: this.t('dashboards.people'),
      color: ORDINAL_RAMP[i],
    }));
  });

  // Chart chrome, translated.
  perSessionTitle = computed(() => this.t('dashboards.perSessionTitle'));
  perSessionSubtitle = computed(() => this.t('dashboards.perSessionSubtitle'));
  perSessionCategory = computed(() => this.t('dashboards.perSessionCategory'));
  perSessionValue = computed(() => this.t('dashboards.perSessionValue'));
  weekdayTitle = computed(() => this.t('dashboards.weekdayTitle'));
  weekdaySubtitle = computed(() => this.t('dashboards.weekdaySubtitle'));
  weekdayCategory = computed(() => this.t('dashboards.weekdayCategory'));
  monthTitle = computed(() => this.t('dashboards.monthTitle'));
  monthSubtitle = computed(() => this.t('dashboards.monthSubtitle'));
  monthCategory = computed(() => this.t('dashboards.monthCategory'));
  averagePeople = computed(() => this.t('dashboards.averagePeople'));
  distributionTitle = computed(() => this.t('dashboards.distributionTitle'));
  distributionSubtitle = computed(() => this.t('dashboards.distributionSubtitle'));
  distributionCategory = computed(() => this.t('dashboards.distributionCategory'));
  peopleLabel = computed(() => this.t('dashboards.people'));

  // ── Ranked tables ───────────────────────────────────────────────────────
  ranked = computed(() =>
    [...this.activeStats()].sort(
      (a, b) => b.attended - a.attended || a.person.name.localeCompare(b.person.name)
    )
  );

  topAttendees = computed(() =>
    this.showAllAttendees() ? this.ranked() : this.ranked().slice(0, 10)
  );

  absentLately = computed(() =>
    this.activeStats()
      .filter(s => s.missed_in_a_row >= 2)
      .sort((a, b) => b.missed_in_a_row - a.missed_in_a_row || b.attended - a.attended)
      .slice(0, 12)
  );

  // ── Presentation helpers ────────────────────────────────────────────────
  percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  oneDecimal(value: number): string {
    return value.toFixed(1);
  }

  signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
  }

  absenceSeverity(missed: number): 'warning' | 'critical' {
    return missed >= 4 ? 'critical' : 'warning';
  }

  absenceLabel(missed: number): string {
    return this.t(missed >= 4 ? 'dashboards.absentLong' : 'dashboards.absentWatch');
  }

  absenceMeta(stat: PersonStat): string {
    return this.t('dashboards.absentMeta', {
      count: stat.missed_in_a_row,
      date: this.language.formatDate(stat.last_seen),
    });
  }

  manualTitle(stat: PersonStat): string {
    return this.t('dashboards.manualFlagTitle', { count: stat.manual });
  }

  selfieUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
