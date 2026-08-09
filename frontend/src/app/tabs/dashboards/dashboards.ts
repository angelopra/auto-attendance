import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { BarChart } from '../../charts/bar-chart/bar-chart';
import { LineChart } from '../../charts/line-chart/line-chart';
import { ChartPoint, ORDINAL_RAMP } from '../../charts/chart-utils';
import { ApiService, KnownPerson } from '../../services/api';
import {
  PersonAttendance,
  datesFromRows,
  groupAttendanceRows,
  unknownName,
} from '../../services/attendance-data';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe } from '../../pipes/localized-date';

interface PersonStat {
  person: KnownPerson;
  attended: number;
  rate: number;              // share of the sessions in range, 0..1
  firstSeen: string | null;
  lastSeen: string | null;
  currentStreak: number;     // sessions attended in a row, counting back from the last one
  longestStreak: number;
  missedInARow: number;      // sessions missed in a row at the end of the range
  manual: number;            // presences that were added by hand
}

type RangePreset = 'all' | '30d' | '90d' | '12m';

const RATE_BANDS = [
  { label: '0–20%', min: 0, max: 0.2 },
  { label: '20–40%', min: 0.2, max: 0.4 },
  { label: '40–60%', min: 0.4, max: 0.6 },
  { label: '60–80%', min: 0.6, max: 0.8 },
  { label: '80–100%', min: 0.8, max: 1.01 },
];

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
export class Dashboards implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  people = signal<PersonAttendance[]>([]);
  allSessions = signal<string[]>([]);
  loading = signal(true);
  error = signal('');

  preset = signal<RangePreset>('all');
  customStart = signal('');
  customEnd = signal('');
  showAllAttendees = signal(false);

  ngOnInit() {
    forkJoin({
      attendance: this.api.getAttendance(),
      photos: this.api.getPhotos(),
    }).subscribe({
      next: ({ attendance, photos }) => {
        this.people.set(
          groupAttendanceRows(attendance).filter(p => p.person.name !== unknownName)
        );
        // A session is any day with a photo, plus any day someone was registered on.
        const dates = new Set<string>([...datesFromRows(attendance), ...photos.map(p => p.date)]);
        this.allSessions.set([...dates].sort());
        this.loading.set(false);
      },
      error: err => {
        this.error.set(
          (err as { error?: { detail?: string } })?.error?.detail
            ?? this.translate.instant('dashboards.loadFailed')
        );
        this.loading.set(false);
      },
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

  sessions = computed(() => {
    const start = this.rangeStart();
    const end = this.customEnd();
    return this.allSessions().filter(d => (!start || d >= start) && (!end || d <= end));
  });

  rangeLabel = computed(() => {
    const sessions = this.sessions();
    if (sessions.length === 0) return this.t('dashboards.noSessions');
    const first = this.language.formatDate(sessions[0]);
    const last = this.language.formatDate(sessions[sessions.length - 1]);
    return `${first} → ${last}`;
  });

  hasData = computed(() => this.sessions().length > 0 && this.people().length > 0);

  // ── Per-person statistics ───────────────────────────────────────────────
  stats = computed<PersonStat[]>(() => {
    const sessions = this.sessions();

    return this.people().map(entry => {
      const flags = sessions.map(date => entry.entries.get(date));
      const attended = flags.filter(Boolean).length;

      let longestStreak = 0;
      let running = 0;
      for (const flag of flags) {
        running = flag ? running + 1 : 0;
        longestStreak = Math.max(longestStreak, running);
      }

      let currentStreak = 0;
      for (let i = flags.length - 1; i >= 0 && flags[i]; i--) currentStreak++;

      let missedInARow = 0;
      for (let i = flags.length - 1; i >= 0 && !flags[i]; i--) missedInARow++;

      const attendedDates = sessions.filter((_, i) => flags[i]);

      return {
        person: entry.person,
        attended,
        rate: sessions.length ? attended / sessions.length : 0,
        firstSeen: attendedDates[0] ?? null,
        lastSeen: attendedDates[attendedDates.length - 1] ?? null,
        currentStreak,
        longestStreak,
        missedInARow: attended ? missedInARow : 0,
        manual: flags.filter(f => f?.source === 'manual').length,
      };
    });
  });

  activeStats = computed(() => this.stats().filter(s => s.attended > 0));

  // ── Headline numbers ────────────────────────────────────────────────────
  private presencesPerSession = computed(() => {
    const sessions = this.sessions();
    const counts = new Map<string, number>();
    sessions.forEach(date => counts.set(date, 0));
    this.people().forEach(entry => {
      sessions.forEach(date => {
        if (entry.entries.has(date)) counts.set(date, (counts.get(date) ?? 0) + 1);
      });
    });
    return counts;
  });

  totalPresences = computed(() =>
    [...this.presencesPerSession().values()].reduce((a, b) => a + b, 0)
  );

  averageAttendance = computed(() => {
    const sessions = this.sessions().length;
    return sessions ? this.totalPresences() / sessions : 0;
  });

  /** Average over the last 5 sessions against the 5 before them. */
  averageDelta = computed<number | null>(() => {
    const sessions = this.sessions();
    if (sessions.length < 10) return null;
    const counts = this.presencesPerSession();
    const avg = (dates: string[]) =>
      dates.reduce((sum, d) => sum + (counts.get(d) ?? 0), 0) / dates.length;
    return avg(sessions.slice(-5)) - avg(sessions.slice(-10, -5));
  });

  attendanceRate = computed(() => {
    const sessions = this.sessions().length;
    const people = this.activeStats().length;
    if (!sessions || !people) return 0;
    return this.totalPresences() / (sessions * people);
  });

  /**
   * People whose very first recorded presence is recent.
   *
   * Anchored to the last 30 days of the selected range rather than to its start,
   * so the tile stays meaningful even with the range set to "all time" — where
   * every single person would otherwise count as new.
   */
  newPeople = computed(() => {
    const sessions = this.sessions();
    if (sessions.length === 0) return [];
    const last = parseDate(sessions[sessions.length - 1]);
    const cutoff = new Date(last);
    cutoff.setDate(last.getDate() - 30);
    const cutoffIso = isoOf(cutoff);

    return this.people()
      .filter(entry => {
        const first = [...entry.entries.keys()].sort()[0];
        return !!first && first >= cutoffIso && first >= sessions[0];
      })
      .map(entry => entry.person);
  });

  bestSession = computed<{ date: string; count: number } | null>(() => {
    const entries = [...this.presencesPerSession().entries()];
    if (entries.length === 0) return null;
    const [date, count] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    return { date, count };
  });

  // ── Charts ──────────────────────────────────────────────────────────────
  perSessionPoints = computed<ChartPoint[]>(() => {
    const counts = this.presencesPerSession();
    return this.sessions().map(date => ({
      label: this.language.formatDate(date),
      axisLabel: this.language.formatDayMonth(date),
      value: counts.get(date) ?? 0,
      meta: this.t(`weekdays.${isoWeekday(parseDate(date))}`),
    }));
  });

  weekdayPoints = computed<ChartPoint[]>(() => {
    const counts = this.presencesPerSession();
    const totals = new Map<number, { presences: number; sessions: number }>();
    this.sessions().forEach(date => {
      const day = isoWeekday(parseDate(date));
      const bucket = totals.get(day) ?? { presences: 0, sessions: 0 };
      bucket.presences += counts.get(date) ?? 0;
      bucket.sessions += 1;
      totals.set(day, bucket);
    });

    return [...totals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, bucket]) => ({
        label: this.t(`weekdays.${day}`),
        value: bucket.presences / bucket.sessions,
        meta: this.t('dashboards.sessionsMeta', { count: bucket.sessions }),
      }));
  });

  monthlyPoints = computed<ChartPoint[]>(() => {
    const counts = this.presencesPerSession();
    const buckets = new Map<string, { presences: number; sessions: number }>();
    this.sessions().forEach(date => {
      const key = date.slice(0, 7);
      const bucket = buckets.get(key) ?? { presences: 0, sessions: 0 };
      bucket.presences += counts.get(date) ?? 0;
      bucket.sessions += 1;
      buckets.set(key, bucket);
    });
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([key, bucket]) => {
        const [year, month] = key.split('-');
        return {
          label: `${this.t(`months.${Number(month)}`)} ${year.slice(2)}`,
          value: bucket.sessions ? bucket.presences / bucket.sessions : 0,
          meta: this.t('dashboards.sessionsPresencesMeta', {
            sessions: bucket.sessions,
            presences: bucket.presences,
          }),
        };
      });
  });

  distributionPoints = computed<ChartPoint[]>(() => {
    const active = this.activeStats();
    return RATE_BANDS.map((band, i) => ({
      label: band.label,
      value: active.filter(s => s.rate >= band.min && s.rate < band.max).length,
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
      .filter(s => s.missedInARow >= 2)
      .sort((a, b) => b.missedInARow - a.missedInARow || b.attended - a.attended)
      .slice(0, 12)
  );

  longestStreaks = computed(() =>
    [...this.activeStats()]
      .sort((a, b) => b.longestStreak - a.longestStreak || b.attended - a.attended)
      .slice(0, 5)
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
      count: stat.missedInARow,
      date: this.language.formatDate(stat.lastSeen),
    });
  }

  manualTitle(stat: PersonStat): string {
    return this.t('dashboards.manualFlagTitle', { count: stat.manual });
  }

  selfieUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
