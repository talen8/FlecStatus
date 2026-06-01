<script setup lang="ts">
import { computed } from 'vue'
import type { Incident, MaintenanceWindow, Outage } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { formatDate, formatTime } from '../utils/datetime'
import { computeDayDowntimeIntervals, computeIntervalTotalSeconds } from '../utils/downtime'
import DetailModal from './ui/DetailModal.vue'
import type { DetailMetaItem } from './ui/DetailModal.vue'

const props = defineProps<{
  dayStartAt: number
  outages: Outage[]
  maintenanceWindows: MaintenanceWindow[]
  incidents: Incident[]
  timeZone?: string
}>()

defineEmits<{
  close: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const nowSec = Math.floor(Date.now() / 1000)

// 类型定义
type DayInterval = { start: number; end: number }
type ContextInterval = {
  start: number
  end: number
  kind: 'maintenance' | 'incident'
  label: string
}
type ContextGroup = {
  start: number
  end: number
  kind: 'maintenance' | 'incident'
  label: string
  downtime: DayInterval[]
}
type SortedEntry =
  | { kind: 'group'; group: ContextGroup }
  | { kind: 'outside'; interval: DayInterval }

// 格式化函数
function formatDay(ts: number): string {
  return formatDate(ts, props.timeZone, i18n.locale)
}

function formatClock(ts: number): string {
  return props.timeZone
    ? formatTime(ts, { timeZone: props.timeZone, hour12: false, locale: i18n.locale })
    : formatTime(ts, { hour12: false, locale: i18n.locale })
}

function formatSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// 区间操作辅助函数
function mergeIntervals(intervals: DayInterval[]): DayInterval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: DayInterval[] = []
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

function clipInterval(interval: DayInterval, range: DayInterval): DayInterval | null {
  const start = Math.max(interval.start, range.start)
  const end = Math.min(interval.end, range.end)
  return end > start ? { start, end } : null
}

function buildContextIntervals(): ContextInterval[] {
  const dayEndAt = props.dayStartAt + 86400
  const capEndAt = props.dayStartAt <= nowSec && nowSec < dayEndAt ? nowSec : dayEndAt
  const out: ContextInterval[] = []

  for (const mw of props.maintenanceWindows) {
    const clipped = clipInterval(
      { start: mw.starts_at, end: mw.ends_at },
      { start: props.dayStartAt, end: capEndAt },
    )
    if (!clipped) continue
    out.push({ start: clipped.start, end: clipped.end, kind: 'maintenance', label: mw.title })
  }

  for (const it of props.incidents) {
    const clipped = clipInterval(
      { start: it.started_at, end: it.resolved_at ?? capEndAt },
      { start: props.dayStartAt, end: capEndAt },
    )
    if (!clipped) continue
    out.push({ start: clipped.start, end: clipped.end, kind: 'incident', label: it.title })
  }

  return out.sort(
    (a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'maintenance' ? -1 : 1),
  )
}

function groupDowntimeByContext(
  downtime: DayInterval[],
  contexts: ContextInterval[],
): { groups: ContextGroup[]; outside: DayInterval[] } {
  if (downtime.length === 0) return { groups: [], outside: [] }

  const mergedDowntime = mergeIntervals(downtime)
  const mergedContexts = contexts
    .map((c) => ({ ...c }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const groups: ContextGroup[] = []
  for (const ctx of mergedContexts) {
    const overlappedDowntime = mergedDowntime
      .map((d) => clipInterval(d, ctx))
      .filter((x): x is DayInterval => x !== null)
    if (overlappedDowntime.length === 0) continue
    groups.push({
      start: ctx.start,
      end: ctx.end,
      kind: ctx.kind,
      label: ctx.label,
      downtime: overlappedDowntime,
    })
  }

  const outside: DayInterval[] = []
  for (const d of mergedDowntime) {
    let cursor = d.start
    for (const ctx of mergedContexts) {
      if (ctx.end <= cursor) continue
      if (ctx.start >= d.end) break
      if (ctx.start > cursor) {
        outside.push({ start: cursor, end: Math.min(ctx.start, d.end) })
      }
      cursor = Math.max(cursor, ctx.end)
      if (cursor >= d.end) break
    }
    if (cursor < d.end) {
      outside.push({ start: cursor, end: d.end })
    }
  }

  return { groups, outside }
}

// 计算属性
const intervals = computed(() =>
  computeDayDowntimeIntervals(props.dayStartAt, props.outages, nowSec),
)

const totalDowntimeSec = computed(() =>
  computeIntervalTotalSeconds(intervals.value),
)

const meta = computed((): DetailMetaItem[] => [
  { label: t('day_downtime.title'), value: '' },
  { label: t('common.total'), value: formatSec(totalDowntimeSec.value) },
])

const contextIntervals = computed(() => buildContextIntervals())

const allGrouped = computed(() =>
  groupDowntimeByContext(intervals.value, contextIntervals.value),
)

const sortedEntries = computed((): SortedEntry[] => {
  const entries: SortedEntry[] = []
  for (const g of allGrouped.value.groups) entries.push({ kind: 'group', group: g })
  for (const it of allGrouped.value.outside) entries.push({ kind: 'outside', interval: it })
  return entries.sort((a, b) => {
    const aStart = a.kind === 'group' ? a.group.start : a.interval.start
    const bStart = b.kind === 'group' ? b.group.start : b.interval.start
    return aStart - bStart
  })
})
</script>

<template>
  <DetailModal
    :title="formatDay(dayStartAt)"
    :meta="meta"
    @close="$emit('close')"
  >
    <div v-if="intervals.length === 0" class="day-downtime__empty">
      {{ t('day_downtime.no_downtime') }}
    </div>

    <div v-else class="day-downtime__list">
      <template v-for="(entry, idx) in sortedEntries" :key="idx">
        <!-- 独立停机区间（不在维护/事件范围内） -->
        <div v-if="entry.kind === 'outside'" class="day-downtime__item">
          <div class="day-downtime__item-time">
            {{ formatClock(entry.interval.start) }} – {{ formatClock(entry.interval.end) }}
          </div>
          <div class="day-downtime__item-duration">
            {{ formatSec(entry.interval.end - entry.interval.start) }}
          </div>
        </div>

        <!-- 维护/事件分组 -->
        <div
          v-else
          :class="[
            'day-downtime__group',
            entry.group.kind === 'maintenance'
              ? 'day-downtime__group--maintenance'
              : 'day-downtime__group--incident',
          ]"
        >
          <div class="day-downtime__group-header">
            <div
              :class="[
                'day-downtime__group-kind',
                entry.group.kind === 'maintenance'
                  ? 'day-downtime__group-kind--maintenance'
                  : 'day-downtime__group-kind--incident',
              ]"
            >
              {{ entry.group.kind === 'maintenance' ? t('day_downtime.kind_maintenance') : t('day_downtime.kind_incident') }}
            </div>
            <div
              :class="[
                'day-downtime__group-time',
                entry.group.kind === 'maintenance'
                  ? 'day-downtime__group-time--maintenance'
                  : 'day-downtime__group-time--incident',
              ]"
            >
              {{ formatClock(entry.group.start) }} – {{ formatClock(entry.group.end) }}
            </div>
          </div>

          <div class="day-downtime__group-tags">
            <span
              :class="[
                'day-downtime__tag',
                entry.group.kind === 'maintenance'
                  ? 'day-downtime__tag--maintenance'
                  : 'day-downtime__tag--incident',
              ]"
            >
              {{ entry.group.label }}
            </span>
          </div>

          <div class="day-downtime__group-items">
            <div
              v-for="(it, didx) in entry.group.downtime"
              :key="didx"
              class="day-downtime__subitem"
            >
              <div class="day-downtime__item-time">
                {{ formatClock(it.start) }} – {{ formatClock(it.end) }}
              </div>
              <div class="day-downtime__item-duration">
                {{ formatSec(it.end - it.start) }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </DetailModal>
</template>

<style scoped lang="scss">
.day-downtime__empty {
  color: var(--color-text-muted);
}

.day-downtime__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.day-downtime__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: var(--color-bg);
}

.day-downtime__item-time {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.day-downtime__item-duration {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.day-downtime__group {
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);

  &--maintenance {
    border-color: rgba(59, 130, 246, 0.3);
    background-color: rgba(59, 130, 246, 0.05);
  }

  &--incident {
    border-color: rgba(245, 158, 11, 0.3);
    background-color: rgba(245, 158, 11, 0.05);
  }
}

.day-downtime__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.day-downtime__group-kind {
  font-size: 0.875rem;
  font-weight: 500;

  &--maintenance {
    color: #2563eb;
  }

  &--incident {
    color: #d97706;
  }
}

.day-downtime__group-time {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;

  &--maintenance {
    color: rgba(37, 99, 235, 0.8);
  }

  &--incident {
    color: rgba(217, 119, 6, 0.8);
  }
}

.day-downtime__group-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.day-downtime__tag {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;

  &--maintenance {
    background-color: rgba(59, 130, 246, 0.15);
    color: #2563eb;
  }

  &--incident {
    background-color: rgba(245, 158, 11, 0.15);
    color: #92400e;
  }
}

.day-downtime__group-items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.day-downtime__subitem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: var(--color-card);
  border: 1px solid var(--color-border);
}
</style>
