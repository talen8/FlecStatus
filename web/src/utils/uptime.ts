import type { UptimeColorTier } from '../api/types';

// ──────── 阈值（固定） ────────

const THRESHOLDS = {
  green: 98.0,
  lime: 95.0,
  yellow: 90.0,
} as const;

// ──────── 等级解析 ────────

export function getUptimeTier(uptimePct: number): UptimeColorTier {
  if (!Number.isFinite(uptimePct)) return 'slate';

  if (uptimePct >= THRESHOLDS.green) return 'green';
  if (uptimePct >= THRESHOLDS.lime) return 'lime';
  if (uptimePct >= THRESHOLDS.yellow) return 'yellow';
  return 'red';
}

// ──────── 等级样式类名 ────────

export function getUptimeBgClasses(tier: UptimeColorTier): string {
  return `bg-tier-${tier}`;
}

export function getUptimePillClasses(tier: UptimeColorTier): string {
  return `pill-tier-${tier}`;
}

// ──────── 格式化 ────────

export function formatPct(v: number): string {
  if (!Number.isFinite(v)) return '-';
  return `${v.toFixed(2)}%`;
}

export function formatLatency(v: number | null): string {
  return v === null ? '-' : `${v}ms`;
}
