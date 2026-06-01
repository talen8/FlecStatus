<script setup lang="ts">
import { computed } from 'vue'
import SvgLineChart from './SvgLineChart.vue'
import type { ChartPoint } from './SvgLineChart.vue'
import type { MonitorAnalyticsDayPoint } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { useThemeStore } from '../stores/theme'
import { suggestLatencyAxisCeiling } from '../utils/latencyScale'

const props = withDefaults(defineProps<{
  points: MonitorAnalyticsDayPoint[]
  height?: number
}>(), {
  height: 220,
})

const i18n = useI18nStore()
const { t } = i18n
const theme = useThemeStore()
const isDark = computed(() => theme.isDark)

function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

function formatMs(v: number): string {
  return `${Math.round(v)}ms`
}

const rawData = computed(() =>
  props.points
    .filter((p): p is MonitorAnalyticsDayPoint & { p95_latency_ms: number } =>
      typeof p.p95_latency_ms === 'number',
    )
    .map(p => ({
      day: p.day_start_at,
      p95_latency_ms: p.p95_latency_ms,
    }))
)

const axisCeiling = computed(() =>
  suggestLatencyAxisCeiling(
    rawData.value
      .map(p => p.p95_latency_ms)
      .filter((v): v is number => typeof v === 'number'),
  )
)

const chartPoints = computed<ChartPoint[]>(() =>
  rawData.value.map(p => ({
    x: p.day,
    y: axisCeiling.value !== null && p.p95_latency_ms > axisCeiling.value
      ? axisCeiling.value
      : p.p95_latency_ms,
  }))
)

const yRange = computed<[number, number] | undefined>(() =>
  axisCeiling.value !== null ? [0, axisCeiling.value] : undefined
)
</script>

<template>
  <div v-if="chartPoints.length === 0" class="daily-latency-chart__empty">
    {{ t('common.no_latency_data') }}
  </div>
  <SvgLineChart
    v-else
    :points="chartPoints"
    :height="height"
    :line-color="isDark ? '#38bdf8' : '#0ea5e9'"
    :grid-color="isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.5)'"
    :axis-color="isDark ? '#64748b' : '#9ca3af'"
    :text-color="isDark ? '#94a3b8' : '#6b7280'"
    unit="ms"
    :x-formatter="formatDay"
    :y-formatter="formatMs"
    :y-range="yRange"
    :y-tick-count="5"
  />
</template>

<style scoped lang="scss">
.daily-latency-chart__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  color: var(--color-text-muted);
}
</style>
