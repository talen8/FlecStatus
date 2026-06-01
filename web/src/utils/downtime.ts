export type DowntimeInterval = { start: number; end: number }

export function mergeIntervals(intervals: DowntimeInterval[]): DowntimeInterval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: DowntimeInterval[] = []
  for (const it of sorted) {
    const prev = merged[merged.length - 1]
    if (!prev) {
      merged.push({ start: it.start, end: it.end })
      continue
    }
    if (it.start <= prev.end) {
      prev.end = Math.max(prev.end, it.end)
      continue
    }
    merged.push({ start: it.start, end: it.end })
  }
  return merged
}

export function computeDayDowntimeIntervals(
  dayStartAt: number,
  outages: Array<{ started_at: number; ended_at: number | null }>,
  nowSec: number = Math.floor(Date.now() / 1000),
): DowntimeInterval[] {
  const dayEndAt = dayStartAt + 86400
  const capEndAt = dayStartAt <= nowSec && nowSec < dayEndAt ? nowSec : dayEndAt
  const intervals: DowntimeInterval[] = []
  for (const o of outages) {
    const s = Math.max(o.started_at, dayStartAt)
    const e = Math.min(o.ended_at ?? capEndAt, capEndAt)
    if (e > s) intervals.push({ start: s, end: e })
  }
  return mergeIntervals(intervals)
}

export function computeIntervalTotalSeconds(intervals: DowntimeInterval[]): number {
  return intervals.reduce((acc, it) => acc + Math.max(0, it.end - it.start), 0)
}
