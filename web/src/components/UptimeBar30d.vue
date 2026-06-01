<script setup lang="ts">
import { computed, ref } from 'vue'
import type { HomepageUptimeDayStrip, UptimeDayPreview } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { formatDate } from '../utils/datetime'
import { formatPct, getUptimeBgClasses, getUptimeTier } from '../utils/uptime'
type DisplaySlot = { day: UptimeDayPreview | null }

const props = withDefaults(defineProps<{
  days?: UptimeDayPreview[] | undefined
  strip?: HomepageUptimeDayStrip | undefined
  maxBars?: number
  timeZone: string
  onDayClick?: (dayStartAt: number) => void
  density?: 'default' | 'compact'
  fillMode?: 'pad' | 'stretch'
}>(), {
  maxBars: 30,
  density: 'default',
  fillMode: 'pad',
})

const SVG_NS = 'http://www.w3.org/2000/svg'

const i18n = useI18nStore()
const { locale, t } = i18n

const tooltip = ref<{
  day: UptimeDayPreview
  index: number
  position: { x: number; y: number }
} | null>(null)

const compact = computed(() => props.density === 'compact')

function decodeUptimeDayStrip(strip: HomepageUptimeDayStrip | undefined): UptimeDayPreview[] {
  if (!strip) return []
  const count = Math.min(strip.day_start_at.length, strip.downtime_sec.length, strip.unknown_sec.length, strip.uptime_pct_milli.length)
  const out: UptimeDayPreview[] = []
  for (let index = 0; index < count; index += 1) {
    const milli = strip.uptime_pct_milli[index]
    out.push({
      day_start_at: strip.day_start_at[index] ?? 0,
      downtime_sec: strip.downtime_sec[index] ?? 0,
      unknown_sec: strip.unknown_sec[index] ?? 0,
      uptime_pct: milli === null || milli === undefined ? null : milli / 1000,
    })
  }
  return out
}

function formatDay(ts: number, timeZone: string, locale: string): string {
  return formatDate(ts, timeZone, locale)
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

function tooltipDotClass(uptimePct: number | null): string {
  if (uptimePct === null) return 'tooltip-dot tooltip-dot--unknown'
  return `tooltip-dot ${getUptimeBgClasses(getUptimeTier(uptimePct))}`
}

function uptimeFill(uptimePct: number | null): string {
  if (uptimePct === null) return '#cbd5e1'
  const tier = getUptimeTier(uptimePct)
  switch (tier) {
    case 'green': return '#22c55e'
    case 'lime': return '#84cc16'
    case 'yellow': return '#eab308'
    case 'red': return '#ef4444'
    case 'slate':
    default: return '#cbd5e1'
  }
}

function buildSvgDataUri(slots: DisplaySlot[], compact: boolean): string {
  const height = compact ? 20 : 24
  const barWidth = compact ? 4 : 6
  const gap = compact ? 2 : 3
  const width = slots.length === 0 ? barWidth : slots.length * barWidth + (slots.length - 1) * gap
  const rects = slots.map((slot, index) => {
    const x = index * (barWidth + gap)
    const fill = slot.day ? uptimeFill(slot.day.uptime_pct) : 'transparent'
    return `<rect x="${x}" y="0" width="${barWidth}" height="${height}" rx="1" fill="${fill}"/>`
  }).join('')
  const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${rects}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const sourceDays = computed(() => {
  const decoded = props.days ?? decodeUptimeDayStrip(props.strip)
  return decoded.slice(-props.maxBars)
})

const displayBars = computed(() => {
  if (sourceDays.value.length === 0) return []
  if (props.fillMode === 'stretch' && sourceDays.value.length < props.maxBars) {
    return Array.from({ length: props.maxBars }, (_, slot) => {
      const mappedIndex = Math.min(sourceDays.value.length - 1, Math.floor((slot * sourceDays.value.length) / props.maxBars))
      return sourceDays.value[mappedIndex] ?? null
    })
  }
  return sourceDays.value
})

const slots = computed<DisplaySlot[]>(() => {
  if (props.fillMode === 'stretch') {
    return displayBars.value.map((day) => ({ day }))
  }
  const emptyCount = Math.max(0, props.maxBars - displayBars.value.length)
  return [
    ...Array.from({ length: emptyCount }, () => ({ day: null })),
    ...displayBars.value.map((day) => ({ day })),
  ]
})

const slotCount = computed(() => slots.value.length)
const backgroundImage = computed(() => buildSvgDataUri(slots.value, compact.value))

const containerClass = computed(() => compact.value ? 'uptime-bar uptime-bar--compact' : 'uptime-bar')
const barClass = computed(() => 'uptime-bar__chart')
const barStyle = computed(() => ({
  backgroundImage: backgroundImage.value,
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 100%',
}))

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${slotCount.value}, minmax(0, 1fr))`,
}))

const highlightStyle = computed(() => {
  if (!tooltip.value) return {}
  return {
    left: `${(tooltip.value.index / slotCount.value) * 100}%`,
    width: `${100 / slotCount.value}%`,
  }
})

const tooltipPositionStyle = computed(() => {
  if (!tooltip.value) return {}
  return {
    left: `${tooltip.value.position.x}px`,
    top: `${tooltip.value.position.y}px`,
    transform: 'translate(-50%, -100%) translateY(-8px)',
  }
})

function showTooltip(day: UptimeDayPreview, index: number, event: MouseEvent | FocusEvent) {
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  tooltip.value = {
    day,
    index,
    position: {
      x: rect.left + rect.width / 2,
      y: rect.top,
    },
  }
}

function clearTooltip(index: number) {
  if (tooltip.value?.index === index) {
    tooltip.value = null
  }
}

function handleDayClick(day: UptimeDayPreview, event: MouseEvent) {
  if (!props.onDayClick) return
  event.stopPropagation()
  props.onDayClick(day.day_start_at)
}
</script>

<template>
  <div :class="containerClass">
    <div
      data-bar-chart
      :class="barClass"
      :style="barStyle"
    />
    <div
      v-if="slotCount > 0"
      class="uptime-bar__grid"
      :style="gridStyle"
    >
      <template v-for="(slot, index) in slots" :key="index">
        <button
          v-if="slot.day"
          type="button"
          :aria-label="`${t('uptime.aria_prefix' as any)}: ${formatDay(slot.day.day_start_at, timeZone, locale)}`"
          class="uptime-bar__cell"
          @mouseenter="showTooltip(slot.day, index, $event)"
          @focus="showTooltip(slot.day, index, $event)"
          @blur="clearTooltip(index)"
          @mouseleave="clearTooltip(index)"
          @click="handleDayClick(slot.day, $event)"
        />
        <span v-else aria-hidden="true" />
      </template>
    </div>
    <div
      v-if="tooltip"
      class="uptime-bar__highlight"
      :style="highlightStyle"
    />
  </div>
  <Teleport to="body">
    <div
      v-if="tooltip"
      class="tooltip"
      :style="tooltipPositionStyle"
    >
      <div class="tooltip-title">
        {{ formatDay(tooltip.day.day_start_at, timeZone, locale) }}
      </div>
      <div class="tooltip-content">
        <span :class="tooltipDotClass(tooltip.day.uptime_pct)" />
        <span>
          {{ tooltip.day.uptime_pct === null ? t('uptime.no_data' as any) : formatPct(tooltip.day.uptime_pct) }}
          {{ t('uptime.uptime' as any) }}
        </span>
      </div>
      <div class="tooltip-downtime">
        {{ t('uptime.downtime' as any) }}: {{ formatSec(tooltip.day.downtime_sec) }}
      </div>
      <div v-if="tooltip.day.unknown_sec > 0" class="tooltip-unknown">
        {{ t('uptime.unknown' as any) }}: {{ formatSec(tooltip.day.unknown_sec) }}
      </div>
      <div class="tooltip-arrow" />
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.uptime-bar {
  @include bar-chart-base;
}

.uptime-bar--compact {
  @include bar-chart-compact;
}

.uptime-bar__chart {
  @include bar-chart-canvas;
}

.uptime-bar__grid {
  position: absolute;
  inset: 0;
  display: grid;
}

.uptime-bar__cell {
  height: 100%;
  width: 100%;
  background: transparent;
  outline: none;
  cursor: pointer;
}

.uptime-bar__highlight {
  @include highlight-overlay;
}

.tooltip {
  @include tooltip-base;
}

.tooltip-title {
  @include tooltip-title;
}

.tooltip-content {
  @include tooltip-content;
}

.tooltip-downtime {
  @include tooltip-sub-text;
}

.tooltip-unknown {
  color: var(--color-bg-secondary);
}

.tooltip-arrow {
  @include tooltip-arrow;
}

.tooltip-dot {
  @include tooltip-dot;

  &--unknown { background-color: var(--color-unknown); }
}
</style>
