/** One value on a chart's category (or time) axis. */
export interface ChartPoint {
  label: string;
  value: number;
  /** Shorter form for the x axis; `label` is used when absent. */
  axisLabel?: string;
  /** Extra line shown in the tooltip / table, e.g. "3 sessions". */
  meta?: string;
  /** Overrides the mark colour — used by ordinal ramps. */
  color?: string;
}

/** Chart palette (light surface). One hue for magnitude; status hues stay reserved. */
export const CHART_COLORS = {
  series: '#2a78d6',
  seriesSoft: 'rgba(42, 120, 214, 0.10)',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  surface: '#ffffff',
} as const;

/** Ordinal ramp — one hue, light→dark, validated against a white surface. */
export const ORDINAL_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];

/** Round an axis maximum up to a readable number, and return its ticks. */
export function niceTicks(max: number, desired = 4): number[] {
  if (!isFinite(max) || max <= 0) return [0, 1];
  const rawStep = max / desired;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * magnitude);
  const step = candidates.find(c => c >= rawStep) ?? candidates[candidates.length - 1];
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

/** Path for a bar with its data-end rounded and its baseline end square. */
export function topRoundedBar(x: number, y: number, w: number, h: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const bottom = y + h;
  return `M${x},${bottom} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${bottom} Z`;
}

export function formatNumber(value: number): string {
  if (!isFinite(value)) return '–';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(1);
}
