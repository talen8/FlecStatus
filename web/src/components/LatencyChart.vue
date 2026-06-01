<script setup lang="ts">
import { computed } from 'vue'
import SvgLineChart from './SvgLineChart.vue'
import type { ChartPoint } from './SvgLineChart.vue'
import type { LatencyPoint } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { useThemeStore } from '../stores/theme'
import { suggestLatencyAxisCeiling } from '../utils/latencyScale'

const props = withDefaults(defineProps<{
  points: LatencyPoint[]
  height?: number
}>(), {
  height: 200,
})

const i18n = useI18nStore()
const { t } = i18n
const theme = useThemeStore()
const isDark = computed(() => theme.isDark)

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatMs(v: number): string {
  return `${Math.round(v)}ms`
}

const rawData = computed(() =>
  props.points
    .filter((p) => p.status === 'up' && p.latency_ms !== null)
    .map((p) => ({
      time: p.checked_at,
      latency: p.latency_ms as number,
    }))
)

const axisCeiling = computed(() =>
  suggestLatencyAxisCeiling(rawData.value.map((point) => point.latency))
)

const chartPoints = computed<ChartPoint[]>(() =>
  rawData.value.map(p => ({
    x: p.time,
    y: axisCeiling.value !== null && p.latency > axisCeiling.value
      ? axisCeiling.value
      : p.latency,
  }))
)

const yRange = computed<[number, number] | undefined>(() =>
  axisCeiling.value !== null ? [0, axisCeiling.value] : undefined
)
</script>

<template>
  <div v-if="rawData.length === 0" class="no-data">
    {{ t('common.no_latency_data') }}
  </div>
  <SvgLineChart
    v-else
    :points="chartPoints"
    :height="height"
    :line-color="isDark ? '#34d399' : '#22c55e'"
    :grid-color="isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.5)'"
    :axis-color="isDark ? '#64748b' : '#9ca3af'"
    :text-color="isDark ? '#94a3b8' : '#6b7280'"
    unit="ms"
    :x-formatter="formatTime"
    :y-formatter="formatMs"
    :y-range="yRange"
    :y-tick-count="5"
  />
</template>

<style scoped lang="scss">
.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-text-muted);
}
</style>
