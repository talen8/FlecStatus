<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { downsampleLTTB } from '../utils/downsample'

export interface ChartPoint {
  x: number
  y: number
  raw?: unknown
}

const props = withDefaults(defineProps<{
  points: ChartPoint[]
  height?: number | undefined
  lineColor?: string | undefined
  gridColor?: string | undefined
  axisColor?: string | undefined
  textColor?: string | undefined
  unit?: string | undefined
  xFormatter?: ((x: number) => string) | undefined
  yFormatter?: ((y: number) => string) | undefined
  yRange?: [number, number] | undefined
  yTickCount?: number | undefined
}>(), {
  height: 200,
  lineColor: '#22c55e',
  gridColor: 'rgba(226, 232, 240, 0.5)',
  axisColor: '#9ca3af',
  textColor: '#6b7280',
  unit: '',
  xFormatter: (v: number) => String(v),
  yFormatter: (v: number) => String(v),
  yTickCount: 5,
})

const PIXELS_PER_POINT = 2

const safeXFormatter = computed(() => props.xFormatter ?? ((v: number) => String(v)))
const safeYFormatter = computed(() => props.yFormatter ?? ((v: number) => String(v)))

const containerRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref(300)
const hoverIndex = ref<number | null>(null)

const margin = { top: 12, right: 16, bottom: 32, left: 48 }

const plotWidth = computed(() => Math.max(containerWidth.value - margin.left - margin.right, 1))
const plotHeight = computed(() => Math.max((props.height ?? 200) - margin.top - margin.bottom, 1))

const displayPoints = computed(() => {
  const target = Math.max(Math.floor(plotWidth.value / PIXELS_PER_POINT), 3)
  return downsampleLTTB(props.points, target)
})

const Y_HEADROOM = 0.1

const yDomain = computed<[number, number]>(() => {
  if (props.yRange) {
    const [lo, hi] = props.yRange
    const padding = (hi - lo) * Y_HEADROOM
    return [lo, hi + padding]
  }
  const ys = displayPoints.value.map(p => p.y)
  if (ys.length === 0) return [0, 1]
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  if (min === max) return [min - 1, max + 1]
  const padding = (max - min) * Y_HEADROOM
  return [min, max + padding]
})

const yTicks = computed(() => {
  const [lo, hi] = yDomain.value
  const count = props.yTickCount ?? 5
  if (count <= 1) return [hi]
  const step = (hi - lo) / (count - 1)
  return Array.from({ length: count }, (_, i) => lo + step * i)
})

const xDomain = computed<[number, number]>(() => {
  if (displayPoints.value.length === 0) return [0, 1]
  const xs = displayPoints.value.map(p => p.x)
  return [Math.min(...xs), Math.max(...xs)]
})

const xTicks = computed(() => {
  const [lo, hi] = xDomain.value
  const count = Math.min(displayPoints.value.length, 8)
  if (count <= 1) return [lo]
  const step = (hi - lo) / (count - 1)
  return Array.from({ length: count }, (_, i) => lo + step * i)
})

function scaleX(x: number): number {
  const [lo, hi] = xDomain.value
  if (hi === lo) return plotWidth.value / 2
  return ((x - lo) / (hi - lo)) * plotWidth.value
}

function scaleY(y: number): number {
  const [lo, hi] = yDomain.value
  if (hi === lo) return plotHeight.value / 2
  return plotHeight.value - ((y - lo) / (hi - lo)) * plotHeight.value
}

const polylinePoints = computed(() =>
  displayPoints.value.map(p => `${scaleX(p.x)},${scaleY(p.y)}`).join(' ')
)

const hoverX = computed(() => {
  const idx = hoverIndex.value
  if (idx === null || !displayPoints.value[idx]) return null
  return scaleX(displayPoints.value[idx].x)
})

const hoverY = computed(() => {
  const idx = hoverIndex.value
  if (idx === null || !displayPoints.value[idx]) return null
  return scaleY(displayPoints.value[idx].y)
})

const hoverLabel = computed(() => {
  const idx = hoverIndex.value
  if (idx === null || !displayPoints.value[idx]) return ''
  const p = displayPoints.value[idx]
  return safeYFormatter.value(p.y)
})

const hoverTime = computed(() => {
  const idx = hoverIndex.value
  if (idx === null || !displayPoints.value[idx]) return ''
  return safeXFormatter.value(displayPoints.value[idx].x)
})

function handleMouseMove(e: MouseEvent) {
  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect || displayPoints.value.length === 0) {
    hoverIndex.value = null
    return
  }
  const mouseX = e.clientX - rect.left - margin.left
  if (mouseX < 0 || mouseX > plotWidth.value) {
    hoverIndex.value = null
    return
  }
  const [lo, hi] = xDomain.value
  const xValue = lo + (mouseX / plotWidth.value) * (hi - lo)
  let closest = 0
  let minDist = Infinity
  for (let i = 0; i < displayPoints.value.length; i++) {
    const pt = displayPoints.value[i]
    if (!pt) continue
    const dist = Math.abs(pt.x - xValue)
    if (dist < minDist) {
      minDist = dist
      closest = i
    }
  }
  hoverIndex.value = closest
}

function handleMouseLeave() {
  hoverIndex.value = null
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) containerWidth.value = Math.floor(entry.contentRect.width)
    })
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="containerRef"
    class="svg-line-chart"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <svg
      v-if="points.length > 0"
      :width="containerWidth"
      :height="height ?? 200"
      :viewBox="`0 0 ${containerWidth} ${height ?? 200}`"
      style="overflow: visible"
    >
      <g :transform="`translate(${margin.left}, ${margin.top})`">
        <!-- grid lines -->
        <line
          v-for="tick in yTicks"
          :key="`gy-${tick}`"
          :x1="0"
          :y1="scaleY(tick)"
          :x2="plotWidth"
          :y2="scaleY(tick)"
          :stroke="gridColor"
          stroke-width="1"
        />

        <!-- X axis labels -->
        <text
          v-for="tick in xTicks"
          :key="`xl-${tick}`"
          :x="scaleX(tick)"
          :y="plotHeight + 20"
          text-anchor="middle"
          :fill="textColor"
          font-size="11"
        >
          {{ safeXFormatter(tick) }}
        </text>

        <!-- Y axis labels -->
        <text
          v-for="tick in yTicks"
          :key="`yl-${tick}`"
          :x="-8"
          :y="scaleY(tick)"
          text-anchor="end"
          dominant-baseline="central"
          :fill="textColor"
          font-size="11"
        >
          {{ safeYFormatter(tick) }}
        </text>

        <!-- line -->
        <polyline
          :points="polylinePoints"
          fill="none"
          :stroke="lineColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- hover indicator -->
        <template v-if="hoverIndex !== null && hoverX !== null && hoverY !== null">
          <line
            :x1="hoverX"
            :y1="0"
            :x2="hoverX"
            :y2="plotHeight"
            :stroke="gridColor"
            stroke-width="1"
            stroke-dasharray="4,3"
          />
          <circle
            :cx="hoverX"
            :cy="hoverY"
            r="4"
            :fill="lineColor"
            stroke="#fff"
            stroke-width="2"
          />
          <!-- tooltip background -->
          <rect
            v-if="hoverLabel"
            :x="hoverX - 40"
            :y="-36"
            width="80"
            height="36"
            rx="4"
            fill="var(--color-bg-elevated, #fff)"
            stroke="var(--color-border, #e2e8f0)"
            stroke-width="1"
          />
          <!-- tooltip: 延迟值 -->
          <text
            v-if="hoverLabel"
            :x="hoverX"
            :y="-22"
            text-anchor="middle"
            :fill="lineColor"
            font-size="12"
            font-weight="600"
          >
            {{ hoverLabel }}
          </text>
          <!-- tooltip: 时间 -->
          <text
            v-if="hoverTime"
            :x="hoverX"
            :y="-7"
            text-anchor="middle"
            :fill="textColor"
            font-size="10"
          >
            {{ hoverTime }}
          </text>
        </template>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.svg-line-chart {
  width: 100%;
  cursor: crosshair;
}
</style>
