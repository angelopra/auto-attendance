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
import { CHART_COLORS, ChartPoint, formatNumber, niceTicks, topRoundedBar } from '../chart-utils';

interface Bar {
  index: number;
  path: string;
  bandX: number;
  bandWidth: number;
  centerX: number;
  topY: number;
  color: string;
  point: ChartPoint;
}

const PAD = { top: 14, right: 12, bottom: 34, left: 40 };
const MAX_BAR_WIDTH = 24;

@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './bar-chart.html',
  styleUrl: './bar-chart.scss',
})
export class BarChart implements OnDestroy {
  points = input.required<ChartPoint[]>();
  title = input('');
  subtitle = input('');
  categoryLabel = input('');
  valueLabel = input('');
  suffix = input('');
  height = input(220);

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
    // Any change to the data invalidates whatever the pointer was over.
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

  bars = computed<Bar[]>(() => {
    const points = this.points();
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    const band = plotWidth / Math.max(1, points.length);
    const barWidth = Math.max(3, Math.min(MAX_BAR_WIDTH, band - 2));
    const baseline = PAD.top + this.plotHeight();

    return points.map((point, index) => {
      const bandX = PAD.left + index * band;
      const centerX = bandX + band / 2;
      const y = this.yFor(Math.max(0, point.value));
      const h = Math.max(point.value > 0 ? 2 : 0, baseline - y);
      return {
        index,
        path: topRoundedBar(centerX - barWidth / 2, baseline - h, barWidth, h),
        bandX,
        bandWidth: band,
        centerX,
        topY: baseline - h,
        color: point.color ?? CHART_COLORS.series,
        point,
      };
    });
  });

  hoveredBar = computed(() => {
    const index = this.hovered();
    return index === null ? null : this.bars()[index] ?? null;
  });

  /** Thin out x labels so they never collide. */
  private labelStep = computed(() => {
    const count = this.points().length;
    const plotWidth = Math.max(10, this.width() - PAD.left - PAD.right);
    const perLabel = 52;
    return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / perLabel))));
  });

  showLabel(index: number): boolean {
    const step = this.labelStep();
    return index % step === 0 || index === this.points().length - 1;
  }

  axisLabel(point: ChartPoint): string {
    const label = point.axisLabel ?? point.label;
    return label.length > 10 ? `${label.slice(0, 9)}…` : label;
  }

  tooltipX(bar: Bar): number {
    const margin = 60;
    return Math.min(Math.max(bar.centerX, margin), this.width() - margin);
  }

  format = formatNumber;
}
