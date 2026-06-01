<script setup lang="ts">
import { computed } from 'vue'
import SvgLineChart from './SvgLineChart.vue'
import type { ChartPoint } from './SvgLineChart.vue'
import type { MonitorAnalyticsDayPoint } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { useThemeStore } from '../stores/theme'

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

function formatPct(v: number): string {
  return `${v.toFixed(0)}%`
}

const chartPoints = computed<ChartPoint[]>(() =>
  props.points.map(p => ({
    x: p.day_start_at,
    y: Number(p.uptime_pct.toFixed(3)),
  }))
)
</script>

<template>
  <div v-if="chartPoints.length === 0" class="daily-uptime-chart__empty">
    {{ t('common.no_data') }}
  </div>
  <SvgLineChart
    v-else
    :points="chartPoints"
    :height="height"
    :line-color="isDark ? '#34d399' : '#22c55e'"
    :grid-color="isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.5)'"
    :axis-color="isDark ? '#64748b' : '#9ca3af'"
    :text-color="isDark ? '#94a3b8' : '#6b7280'"
    unit="%"
    :x-formatter="formatDay"
    :y-formatter="formatPct"
    :y-range="[0, 100]"
    :y-tick-count="5"
  />
</template>

<style scoped lang="scss">
.daily-uptime-chart__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  color: var(--color-text-muted);
}
</style>
