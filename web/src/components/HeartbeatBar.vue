<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CheckStatus, Heartbeat, HomepageHeartbeatStrip } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { statusLabel } from '../i18n/labels'
import { clampLatencyToCeiling, suggestLatencyAxisCeiling } from '../utils/latencyScale'

interface LatencyScale {
  min: number
  span: number
  ceiling: number | null
}

interface DisplayHeartbeat extends Heartbeat {
  from_checked_at: number
  to_checked_at: number
  sample_count: number
}

type DisplaySlot = {
  heartbeat: DisplayHeartbeat | null
}

const props = withDefaults(defineProps<{
  heartbeats?: Heartbeat[] | undefined
  strip?: HomepageHeartbeatStrip | undefined
  maxBars?: number
  visualBars?: number
  density?: 'default' | 'compact'
}>(), {
  maxBars: 60,
  density: 'default',
})

const SVG_NS = 'http://www.w3.org/2000/svg'

const i18n = useI18nStore()
const t = i18n.t

const tooltip = ref<{
  heartbeat: DisplayHeartbeat
  index: number
  position: { x: number; y: number }
} | null>(null)

const compact = computed(() => props.density === 'compact')

function decodeStatusCode(code: string | undefined): CheckStatus {
  switch (code) {
    case 'u': return 'up'
    case 'd': return 'down'
    case 'm': return 'maintenance'
    case 'x':
    default: return 'unknown'
  }
}

function decodeHeartbeatStrip(strip: HomepageHeartbeatStrip | undefined): Heartbeat[] {
  if (!strip) return []
  const out: Heartbeat[] = []
  const count = Math.min(strip.checked_at.length, strip.latency_ms.length, strip.status_codes.length)
  for (let index = 0; index < count; index += 1) {
    out.push({
      checked_at: strip.checked_at[index] ?? 0,
      status: decodeStatusCode(strip.status_codes[index]),
      latency_ms: strip.latency_ms[index] ?? null,
    })
  }
  return out
}

function statusPriority(status: CheckStatus): number {
  switch (status) {
    case 'down': return 4
    case 'unknown': return 3
    case 'maintenance': return 2
    case 'up':
    default: return 1
  }
}

function buildLatencyScale(heartbeats: DisplayHeartbeat[]): LatencyScale | null {
  const latencies: number[] = []
  for (const hb of heartbeats) {
    if (hb.status !== 'up') continue
    if (typeof hb.latency_ms !== 'number' || !Number.isFinite(hb.latency_ms)) continue
    latencies.push(hb.latency_ms)
  }
  if (latencies.length === 0) return null
  const ceiling = suggestLatencyAxisCeiling(latencies)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const latency of latencies) {
    const display = clampLatencyToCeiling(latency, ceiling)
    if (display < min) min = display
    if (display > max) max = display
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, span: Math.max(1, max - min), ceiling }
}

function getBarHeightPct(heartbeat: DisplayHeartbeat, scale: LatencyScale | null, compact: boolean): number {
  if (heartbeat.status === 'down') return 100
  if (heartbeat.status === 'maintenance') return compact ? 62 : 65
  if (heartbeat.status === 'unknown') return compact ? 48 : 52
  if (heartbeat.latency_ms === null || !scale) return compact ? 74 : 78
  const displayLatency = clampLatencyToCeiling(heartbeat.latency_ms, scale.ceiling)
  const normalized = (displayLatency - scale.min) / scale.span
  const clamped = Math.max(0, Math.min(1, normalized))
  const minHeight = compact ? 36 : 38
  return minHeight + clamped * (100 - minHeight)
}

function heartbeatFill(status: CheckStatus): string {
  switch (status) {
    case 'up': return '#10b981'
    case 'down': return '#ef4444'
    case 'maintenance': return '#3b82f6'
    case 'unknown':
    default: return '#cbd5e1'
  }
}

function tooltipDotClass(status: CheckStatus): string {
  switch (status) {
    case 'up': return 'tooltip-dot tooltip-dot--up'
    case 'down': return 'tooltip-dot tooltip-dot--down'
    case 'maintenance': return 'tooltip-dot tooltip-dot--maintenance'
    case 'unknown':
    default: return 'tooltip-dot tooltip-dot--unknown'
  }
}

function buildSvgDataUri(slots: DisplaySlot[], compact: boolean, scale: LatencyScale | null): string {
  const height = compact ? 20 : 24
  const barWidth = compact ? 4 : 6
  const gap = compact ? 2 : 3
  const width = slots.length === 0 ? barWidth : slots.length * barWidth + (slots.length - 1) * gap
  const rects = slots.map((slot, index) => {
    const x = index * (barWidth + gap)
    if (!slot.heartbeat) {
      const emptyHeight = compact ? height * 0.46 : height * 0.48
      const y = height - emptyHeight
      return `<rect x="${x}" y="${y.toFixed(2)}" width="${barWidth}" height="${emptyHeight.toFixed(2)}" rx="1" fill="transparent"/>`
    }
    const barHeight = (height * getBarHeightPct(slot.heartbeat, scale, compact)) / 100
    const y = height - barHeight
    return `<rect x="${x}" y="${y.toFixed(2)}" width="${barWidth}" height="${barHeight.toFixed(2)}" rx="1" fill="${heartbeatFill(slot.heartbeat.status)}"/>`
  }).join('')
  const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${rects}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function formatTime(timestamp: number, locale: string): string {
  return new Date(timestamp * 1000).toLocaleString(locale)
}

function aggregateHeartbeats(heartbeats: Heartbeat[], slots: number): DisplayHeartbeat[] {
  if (heartbeats.length === 0) return []
  const chronological = [...heartbeats].reverse()
  if (slots >= chronological.length) {
    return chronological.map((hb) => ({
      ...hb,
      from_checked_at: hb.checked_at,
      to_checked_at: hb.checked_at,
      sample_count: 1,
    }))
  }
  const groupSize = Math.ceil(chronological.length / slots)
  const groups: DisplayHeartbeat[] = []
  for (let start = 0; start < chronological.length; start += groupSize) {
    const endExclusive = Math.min(chronological.length, start + groupSize)
    const first = chronological[start]
    const last = chronological[endExclusive - 1]
    if (!first || !last) continue
    let worst = first
    let latencySum = 0
    let latencyCount = 0
    for (let index = start; index < endExclusive; index += 1) {
      const hb = chronological[index]
      if (!hb) continue
      if (statusPriority(hb.status) > statusPriority(worst.status)) worst = hb
      if (hb.status === 'up' && typeof hb.latency_ms === 'number' && Number.isFinite(hb.latency_ms)) {
        latencySum += hb.latency_ms
        latencyCount++
      }
    }
    groups.push({
      checked_at: last.checked_at,
      status: worst.status,
      latency_ms: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
      from_checked_at: first.checked_at,
      to_checked_at: last.checked_at,
      sample_count: endExclusive - start,
    })
  }
  return groups
}

const sourceHeartbeats = computed(() => {
  const decoded = props.heartbeats ?? decodeHeartbeatStrip(props.strip)
  return decoded.slice(0, props.maxBars)
})

const slotCount = computed(() => {
  if (!props.visualBars || props.visualBars < 1) return props.maxBars
  return Math.min(props.maxBars, props.visualBars)
})

const displayHeartbeats = computed(() => aggregateHeartbeats(sourceHeartbeats.value, slotCount.value))
const latencyScale = computed(() => buildLatencyScale(displayHeartbeats.value))

const slots = computed<DisplaySlot[]>(() => [
  ...displayHeartbeats.value.map((heartbeat) => ({ heartbeat })),
  ...Array.from({ length: Math.max(0, slotCount.value - displayHeartbeats.value.length) }, () => ({ heartbeat: null })),
])

const backgroundImage = computed(() => buildSvgDataUri(slots.value, compact.value, latencyScale.value))

const containerClass = computed(() => compact.value ? 'heartbeat-bar heartbeat-bar--compact' : 'heartbeat-bar')
const barClass = computed(() => 'heartbeat-bar__chart')
const barStyle = computed(() => ({
  backgroundImage: backgroundImage.value,
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 100%',
}))

const ariaLabel = computed(() => t('monitor_card.last_checks', { count: Math.min(sourceHeartbeats.value.length, slotCount.value) }))

const overlayKey = computed(() => {
  if (!tooltip.value) return ''
  return `heartbeat-overlay-${tooltip.value.index}-${tooltip.value.heartbeat.from_checked_at}-${tooltip.value.heartbeat.to_checked_at}`
})

const highlightStyle = computed(() => {
  if (!tooltip.value) return {}
  return {
    left: `${(tooltip.value.index / slotCount.value) * 100}%`,
    width: `${100 / slotCount.value}%`,
  }
})

const tooltipTitle = computed(() => {
  if (!tooltip.value) return ''
  const hb = tooltip.value.heartbeat
  const hasWindow = hb.sample_count > 1 && hb.from_checked_at !== hb.to_checked_at
  return hasWindow
    ? `${formatTime(hb.from_checked_at, i18n.locale)} ${t('heartbeat.to')} ${formatTime(hb.to_checked_at, i18n.locale)}`
    : formatTime(hb.checked_at, i18n.locale)
})

const tooltipPositionStyle = computed(() => {
  if (!tooltip.value) return {}
  return {
    left: `${tooltip.value.position.x}px`,
    top: `${tooltip.value.position.y}px`,
    transform: 'translate(-50%, -100%) translateY(-8px)',
  }
})

function handleMouseMove(event: MouseEvent) {
  if (slotCount.value === 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width))
  const index = Math.floor(ratio * slotCount.value)
  const slot = slots.value[index]
  if (!slot?.heartbeat) {
    if (tooltip.value) tooltip.value = null
    return
  }
  tooltip.value = {
    heartbeat: slot.heartbeat,
    index,
    position: {
      x: rect.left + ((index + 0.5) / slotCount.value) * rect.width,
      y: rect.top,
    },
  }
}
</script>

<template>
  <div :class="containerClass">
    <div
      data-bar-chart
      role="img"
      :aria-label="ariaLabel"
      :class="barClass"
      :style="barStyle"
      @mousemove="handleMouseMove"
      @mouseleave="tooltip = null"
    />
    <div
      v-if="tooltip"
      :key="overlayKey"
      class="highlight-overlay"
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
        {{ tooltipTitle }}
      </div>
      <div class="tooltip-content">
        <span :class="tooltipDotClass(tooltip.heartbeat.status)" />
        <span>{{ statusLabel(tooltip.heartbeat.status, t) }}</span>
        <span v-if="tooltip.heartbeat.latency_ms !== null" class="tooltip-latency">
          &bull; {{ tooltip.heartbeat.latency_ms }}ms
        </span>
      </div>
      <div v-if="tooltip.heartbeat.sample_count > 1" class="tooltip-samples">
        {{ t('heartbeat.sample_checks', { count: tooltip.heartbeat.sample_count }) }}
      </div>
      <div class="tooltip-arrow" />
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.heartbeat-bar {
  @include bar-chart-base;
}

.heartbeat-bar--compact {
  @include bar-chart-compact;
}

.heartbeat-bar__chart {
  @include bar-chart-canvas;
}

.highlight-overlay {
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

.tooltip-latency {
  @include tooltip-sub-text;
}

.tooltip-samples {
  @include tooltip-sub-text;
}

.tooltip-arrow {
  @include tooltip-arrow;
}

.tooltip-dot {
  @include tooltip-dot;

  &--up { background-color: var(--color-up); }
  &--down { background-color: var(--color-down); }
  &--maintenance { background-color: var(--color-maintenance); }
  &--unknown { background-color: var(--color-unknown); }
}
</style>
