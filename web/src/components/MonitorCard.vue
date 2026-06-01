<script setup lang="ts">
import { computed } from 'vue'
import type {
  HomepageHeartbeatStrip,
  HomepageMonitorCard,
  PublicMonitor,
} from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { statusLabel } from '../i18n/labels'
import HeartbeatBar from './HeartbeatBar.vue'
import UptimeBar30d from './UptimeBar30d.vue'
import UiCard from './ui/UiCard.vue'
import UiBadge from './ui/UiBadge.vue'
import { formatTime } from '../utils/datetime'
import {
  formatLatency,
  formatPct,
  getUptimeBgClasses,
  getUptimePillClasses,
  getUptimeTier,
} from '../utils/uptime'

const props = defineProps<{
  monitor: MonitorLike
  timeZone: string
  onSelect: () => void
  onDayClick: (dayStartAt: number) => void
}>()
const HEARTBEAT_BARS = 60
const AVAILABILITY_BARS = 60

type PublicMonitorLike = Pick<
  PublicMonitor,
  'id' | 'name' | 'type' | 'status' | 'is_stale' | 'last_checked_at' | 'heartbeats' | 'uptime_30d' | 'uptime_days'
>

type HomepageMonitorLike = Pick<
  HomepageMonitorCard,
  'id' | 'name' | 'type' | 'status' | 'is_stale' | 'last_checked_at' | 'heartbeat_strip' | 'uptime_30d' | 'uptime_day_strip' | 'public_access' | 'target'
>

type MonitorLike = PublicMonitorLike | HomepageMonitorLike

const i18n = useI18nStore()
const { t } = i18n

function hasHomepageStrips(monitor: MonitorLike): monitor is HomepageMonitorLike {
  return 'heartbeat_strip' in monitor && 'uptime_day_strip' in monitor
}

const isPublicLink = computed(() => {
  if (!hasHomepageStrips(props.monitor)) return false
  return props.monitor.public_access && !!props.monitor.target
})

const publicLinkTarget = computed(() => {
  if (!hasHomepageStrips(props.monitor)) return ''
  return props.monitor.target ?? ''
})

function hasPublicTimeseries(monitor: MonitorLike): monitor is PublicMonitorLike {
  return 'heartbeats' in monitor && 'uptime_days' in monitor
}

function getHeartbeatLatencyStats(
  heartbeats: PublicMonitor['heartbeats'] | undefined,
  heartbeatStrip: HomepageHeartbeatStrip | undefined,
): { fastestMs: number | null; avgMs: number | null; slowestMs: number | null } {
  let fastestMs = Number.POSITIVE_INFINITY
  let slowestMs = Number.NEGATIVE_INFINITY
  let latencySum = 0
  let latencyCount = 0

  if (Array.isArray(heartbeats)) {
    for (const hb of heartbeats) {
      if (hb.status !== 'up') continue
      if (typeof hb.latency_ms !== 'number' || !Number.isFinite(hb.latency_ms)) continue
      if (hb.latency_ms < fastestMs) fastestMs = hb.latency_ms
      if (hb.latency_ms > slowestMs) slowestMs = hb.latency_ms
      latencySum += hb.latency_ms
      latencyCount++
    }
  } else if (heartbeatStrip) {
    for (let index = 0; index < heartbeatStrip.status_codes.length; index += 1) {
      if (heartbeatStrip.status_codes[index] !== 'u') continue
      const latency = heartbeatStrip.latency_ms[index]
      if (typeof latency !== 'number' || !Number.isFinite(latency)) continue
      if (latency < fastestMs) fastestMs = latency
      if (latency > slowestMs) slowestMs = latency
      latencySum += latency
      latencyCount++
    }
  }

  if (latencyCount === 0) return { fastestMs: null, avgMs: null, slowestMs: null }
  return { fastestMs, avgMs: Math.round(latencySum / latencyCount), slowestMs }
}

const uptime30d = computed(() => props.monitor.uptime_30d)
const heartbeatStrip = computed(() => hasHomepageStrips(props.monitor) ? props.monitor.heartbeat_strip : undefined)
const uptimeDayStrip = computed(() => hasHomepageStrips(props.monitor) ? props.monitor.uptime_day_strip : undefined)
const heartbeats = computed(() => hasPublicTimeseries(props.monitor) ? props.monitor.heartbeats : undefined)
const uptimeDays = computed(() => hasPublicTimeseries(props.monitor) ? props.monitor.uptime_days : undefined)
const latencyStats = computed(() => getHeartbeatLatencyStats(heartbeats.value, heartbeatStrip.value))
const tier = computed(() => uptime30d.value ? getUptimeTier(uptime30d.value.uptime_pct) : null)

const checkedAt = computed(() =>
  props.monitor.last_checked_at
    ? props.timeZone
      ? formatTime(props.monitor.last_checked_at, { timeZone: props.timeZone, locale: i18n.locale })
      : formatTime(props.monitor.last_checked_at, { locale: i18n.locale })
    : t('monitor_card.never_checked')
)
</script>

<template>
  <UiCard hover :on-click="onSelect" class="monitor-card">
    <!-- 头部 -->
    <div class="monitor-card__header">
      <div class="monitor-card__title-group">
        <span class="status-dot status-dot--sm">
          <span v-if="monitor.status === 'down'" :class="['status-dot__ping', `status-dot--${monitor.status}`]" />
          <span :class="['status-dot__dot', `status-dot--${monitor.status}`]" />
        </span>
        <div class="monitor-card__name-wrapper">
          <div class="monitor-card__title-row">
            <a
              v-if="isPublicLink"
              :href="publicLinkTarget"
              target="_blank"
              rel="noopener noreferrer"
              class="monitor-card__name-link"
              @click.stop
            >
              <span class="monitor-card__name">{{ monitor.name }}</span>
              <svg
                class="monitor-card__external-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
            <h3 v-else class="monitor-card__name">{{ monitor.name }}</h3>
          </div>
          <div class="monitor-card__meta">
            <span>{{ monitor.type }}</span>
            <span v-if="monitor.is_stale" class="monitor-card__stale-badge">
              {{ t('monitor_card.stale') }}
            </span>
          </div>
        </div>
      </div>

      <div class="monitor-card__badges">
        <span
          v-if="uptime30d && tier"
          :class="['monitor-card__uptime-pill', getUptimePillClasses(tier)]"
          :title="t('monitor_card.uptime_title')"
        >
          <span :class="['monitor-card__uptime-dot', getUptimeBgClasses(tier)]" />
          {{ formatPct(uptime30d.uptime_pct) }}
        </span>
        <span v-else class="monitor-card__no-data">-</span>
        <UiBadge :variant="monitor.status">{{ statusLabel(monitor.status, t) }}</UiBadge>
      </div>
    </div>

    <!-- 可用性（30天） -->
    <div>
      <div class="monitor-card__section-title">
        {{ t('monitor_card.availability_30d') }}
      </div>
      <UptimeBar30d
        :days="uptimeDays"
        :strip="uptimeDayStrip"
        :max-bars="AVAILABILITY_BARS"
        :time-zone="timeZone"
        :on-day-click="onDayClick"
        density="compact"
      />
    </div>

    <!-- 心跳检测 -->
    <div class="monitor-card__heartbeat-section">
      <div class="monitor-card__section-title">
        {{ t('monitor_card.last_checks', { count: HEARTBEAT_BARS }) }}
      </div>
      <HeartbeatBar
        :heartbeats="heartbeats"
        :strip="heartbeatStrip"
        :max-bars="HEARTBEAT_BARS"
        density="compact"
      />
    </div>

    <!-- 延迟 + 时间戳底部栏 -->
    <div class="monitor-card__footer">
      <div class="monitor-card__latency-stats">
        <span>
          <span class="monitor-card__latency-label">{{ t('monitor_card.fast') }}</span>
          {{ formatLatency(latencyStats.fastestMs) }}
        </span>
        <span>
          <span class="monitor-card__latency-label">{{ t('monitor_card.avg') }}</span>
          {{ formatLatency(latencyStats.avgMs) }}
        </span>
        <span>
          <span class="monitor-card__latency-label">{{ t('monitor_card.slow') }}</span>
          {{ formatLatency(latencyStats.slowestMs) }}
        </span>
      </div>
      <span class="monitor-card__timestamp">
        {{ monitor.last_checked_at ? checkedAt : t('monitor_card.never_checked') }}
      </span>
    </div>
  </UiCard>
</template>

<style scoped lang="scss">
.monitor-card {
  padding: 0.75rem;

  @media (min-width: 640px) {
    padding: 1rem;
  }
}

.monitor-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.625rem;

  @media (min-width: 640px) {
    margin-bottom: 0.75rem;
  }
}

.monitor-card__title-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.monitor-card__name-wrapper {
  min-width: 0;
}

.monitor-card__title-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.monitor-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-primary);
  margin: 0;
}

.monitor-card__name-link {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  min-width: 0;
  text-decoration: none;
  cursor: pointer;
  color: var(--color-text-primary);
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-primary);
    text-decoration: underline;
  }
}

.monitor-card__external-icon {
  flex-shrink: 0;
  width: 0.75rem;
  height: 0.75rem;
}

.monitor-card__meta {
  margin-top: 0.125rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.monitor-card__stale-badge {
  border-radius: 0.25rem;
  background-color: rgba(245, 158, 11, 0.15);
  padding: 0 0.375rem;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-paused);
}

.monitor-card__badges {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
}

.monitor-card__uptime-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 9999px;
  border: 1px solid;
  padding: 0.125rem 0.5rem;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.monitor-card__uptime-dot {
  height: 0.375rem;
  width: 0.375rem;
  border-radius: 9999px;
}

.monitor-card__no-data {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.monitor-card__section-title {
  margin-bottom: 0.5rem;
  font-size: 11px;
  color: var(--color-text-muted);
}

.monitor-card__heartbeat-section {
  margin-top: 0.5rem;
}

.monitor-card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);

  @media (min-width: 640px) {
    margin-top: 0.625rem;
  }
}

.monitor-card__latency-stats {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-variant-numeric: tabular-nums;

  @media (min-width: 640px) {
    gap: 0.75rem;
  }
}

.monitor-card__latency-label {
  color: var(--color-text-muted);
}

.monitor-card__timestamp {
  font-size: 11px;
  color: var(--color-text-muted);
}

// ─── Status Dot (inlined from StatusDot.vue) ───
.status-dot {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.status-dot--sm {
  height: 0.5rem;
  width: 0.5rem;
}

.status-dot__ping {
  position: absolute;
  display: inline-flex;
  height: 100%;
  width: 100%;
  border-radius: 9999px;
  opacity: 0.75;
  animation: status-dot-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
}

.status-dot__dot {
  position: relative;
  display: inline-flex;
  height: 100%;
  width: 100%;
  border-radius: 9999px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);

  :global(.dark) & {
    box-shadow: none;
  }
}

.status-dot--up {
  background-color: var(--color-up);
}

.status-dot--down {
  background-color: var(--color-down);
}

.status-dot--maintenance {
  background-color: var(--color-maintenance);
}

.status-dot--paused {
  background-color: var(--color-paused);
}

.status-dot--unknown {
  background-color: var(--color-unknown);
}

@keyframes status-dot-ping {
  75%,
  100% {
    transform: scale(2);
    opacity: 0;
  }
}
</style>
