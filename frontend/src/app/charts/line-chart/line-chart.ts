import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CHART_COLORS, ChartPoint, formatNumber, niceTicks } from '../chart-utils';

interface Dot {
  index: number;
  x: number;
  y: number;
  point: ChartPoint;
}

const PAD = { top: 18, right: 16, bottom: 34, left: 40 };

@Component({
  selector: 'app-line-chart',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.scss',
})
export class LineChart implements OnDestroy {
  points = input.required<ChartPoint[]>();
  title = input('');
  subtitle = input('');
  categoryLabel = input('');
  valueLabel = input('');
  suffix = input('');
  height = input(240);

  private host = inject(ElementRef<HTMLElement>);
  private observer?: ResizeObserver;

  width = signal(640);
  hovered = signal<number | null>(null);
  showTable = signal(false);

  readonly pad = PAD;
  readonly colors = CHART_COLORS;

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w > 0) this.width.set(Math.round(w));
      });
      this.observer.observe(this.host.nativeElement);
    }
    effect(() => { this.points(); this.hovered.set(null); });
  }

  ngOnDestroy() { this.observer?.disconnect(); }

  plotHeight = computed(() => Math.max(10, this.height() - PAD.top - PAD.bottom));

  ticks = computed(() => niceTicks(Math.max(...this.points().map(p => p.value), 0)));

  private axisMax = computed(() => {
    const ticks = this.ticks();
    return ticks[ticks.length - 1] || 1;
  });

  yFor(value: number): number {
    return PAD.top + this.plotHeight() * (1 - value / this.axisMax());
  }

  dots = computed<Dot[]>(() => {
    const points = this.points();
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
    return points.map((point, index) => ({
      index,
      x: points.length > 1 ? PAD.left + index * step : PAD.left + plotWidth / 2,
      y: this.yFor(Math.max(0, point.value)),
      point,
    }));
  });

  linePath = computed(() =>
    this.dots().map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ')
  );

  areaPath = computed(() => {
    const dots = this.dots();
    if (dots.length === 0) return '';
    const baseline = PAD.top + this.plotHeight();
    const first = dots[0];
    const last = dots[dots.length - 1];
    return `${this.linePath()} L${last.x.toFixed(1)},${baseline} L${first.x.toFixed(1)},${baseline} Z`;
  });

  /** Show every point only when they are far enough apart to stay legible. */
  markedDots = computed(() => {
    const dots = this.dots();
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    if (dots.length <= 1) return dots;
    if (plotWidth / (dots.length - 1) >= 14) return dots;
    // Too dense for a dot on every point: keep the extremes and the last one.
    const max = dots.reduce((a, b) => (b.point.value > a.point.value ? b : a));
    const min = dots.reduce((a, b) => (b.point.value < a.point.value ? b : a));
    return [...new Set([dots[0], min, max, dots[dots.length - 1]])];
  });

  lastDot = computed(() => this.dots()[this.dots().length - 1] ?? null);

  hoveredDot = computed(() => {
    const index = this.hovered();
    return index === null ? null : this.dots()[index] ?? null;
  });

  hitWidth = computed(() => {
    const dots = this.dots();
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    return dots.length > 1 ? Math.max(24, plotWidth / (dots.length - 1)) : plotWidth;
  });

  private labelStep = computed(() => {
    const count = this.points().length;
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    const perLabel = 64;
    return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / perLabel))));
  });

  showLabel(index: number): boolean {
    return index % this.labelStep() === 0 || index === this.points().length - 1;
  }

  axisLabel(point: ChartPoint): string {
    return point.axisLabel ?? point.label;
  }

  tooltipX(dot: Dot): number {
    const margin = 60;
    return Math.min(Math.max(dot.x, margin), this.width() - margin);
  }

  format = formatNumber;
}
