<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query'
import { useI18nStore } from '../stores/i18n'
import {
  fetchAdminAnalyticsOverview,
  fetchAdminMonitorAnalytics,
  fetchAdminMonitorOutages,
  fetchAdminMonitors,
  fetchAdminSettings,
} from '../api/client'
import type { AnalyticsOverviewRange, AnalyticsRange, Outage } from '../api/types'
import AppHeader from '../components/ui/AppHeader.vue'
import LatencyChart from '../components/LatencyChart.vue'
import DailyUptimeChart from '../components/DailyUptimeChart.vue'
import DailyLatencyChart from '../components/DailyLatencyChart.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import { formatDateTime } from '../utils/datetime'


const i18n = useI18nStore()
const { locale, t } = i18n

// ─── 导航链接 ───
const analyticsNavLinks = computed(() => [
  {
    to: '/admin',
    label: t('common.admin'),
    iconPath: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
  },
  {
    to: '/',
    label: t('common.status'),
    iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
])

const overviewRanges: AnalyticsOverviewRange[] = ['24h', '7d']
const monitorRanges: AnalyticsRange[] = ['24h', '7d', '30d', '90d']

const overviewRange = ref<AnalyticsOverviewRange>('24h')
const monitorRange = ref<AnalyticsRange>('24h')
const selectedMonitorId = ref<number | null>(null)
const allOutages = ref<Outage[]>([])
const isLoadingMoreOutages = ref(false)

// 设置
const settingsQuery = useQuery({
  queryKey: ['admin-settings'],
  queryFn: fetchAdminSettings,
  staleTime: 60_000,
})

const timeZone = computed(() => settingsQuery.data.value?.settings.site_timezone ?? 'UTC')
watch(
  () => settingsQuery.data.value,
  (data) => {
    if (data?.settings.site_title) {
      document.title = `${data.settings.site_title}分析`
    }
  },
  { immediate: true },
)

onMounted(() => {
  const settings = settingsQuery.data.value?.settings
  if (settings) {
    overviewRange.value = settings.admin_default_overview_range
    monitorRange.value = settings.admin_default_monitor_range
  }
})

// 概览查询
const overviewQuery = useQuery({
  queryKey: ['admin-analytics-overview', overviewRange],
  queryFn: () => fetchAdminAnalyticsOverview(overviewRange.value),
})

const overview = computed(() => overviewQuery.data.value)

// 监控项列表
const monitorsQuery = useQuery({
  queryKey: ['admin-monitors', 'for-analytics'],
  queryFn: () => fetchAdminMonitors(200),
})

const monitors = computed(() => monitorsQuery.data.value?.monitors ?? [])

// 自动选择第一个监控项
watch(
  monitors,
  (list) => {
    const first = list[0]
    if (first && selectedMonitorId.value === null) {
      selectedMonitorId.value = first.id
    }
    if (selectedMonitorId.value && !list.some(m => m.id === selectedMonitorId.value)) {
      selectedMonitorId.value = list.length > 0 ? list[0]!.id : null
    }
  },
  { immediate: true },
)

// 监控项分析查询
const monitorAnalyticsQuery = useQuery({
  queryKey: ['admin-monitor-analytics', selectedMonitorId, monitorRange],
  queryFn: () => fetchAdminMonitorAnalytics(selectedMonitorId.value!, monitorRange.value),
  enabled: computed(() => selectedMonitorId.value !== null),
})

const monitorAnalytics = computed(() => monitorAnalyticsQuery.data.value)

// 中断分页查询
const outagesQuery = useInfiniteQuery({
  queryKey: ['admin-monitor-outages', selectedMonitorId, monitorRange],
  queryFn: ({ pageParam }) => fetchAdminMonitorOutages(selectedMonitorId.value!, { range: monitorRange.value, limit: 50, ...(pageParam != null ? { cursor: pageParam as number } : {}) }),
  initialPageParam: undefined as number | undefined,
  getNextPageParam: (lastPage) => lastPage.next_cursor,
  enabled: computed(() => selectedMonitorId.value !== null),
})

const hasMoreOutages = computed(() => outagesQuery.hasNextPage.value)

watch(
  () => outagesQuery.data.value,
  (data) => {
    if (!data) return
    allOutages.value = data.pages.flatMap(p => p.outages)
  },
  { immediate: true },
)

// 切换监控项时重置中断列表
watch(selectedMonitorId, () => {
  allOutages.value = []
})

function loadMoreOutages() {
  if (!outagesQuery.hasNextPage.value || isLoadingMoreOutages.value) return
  isLoadingMoreOutages.value = true
  outagesQuery.fetchNextPage().finally(() => { isLoadingMoreOutages.value = false })
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
</script>

<template>
  <div class="analytics">
    <AppHeader
      maxWidth="92rem"
      :title="t('admin_analytics.analytics_title')"
      titleIsHeading
      :navLinks="analyticsNavLinks"
    />

    <main class="analytics__main">
      <!-- 概览卡片 -->
      <UiCard class="analytics__card">
        <h2 class="analytics__card-title">{{ t('admin_analytics.overview_title') }}</h2>
        <p class="analytics__card-desc">{{ t('admin_analytics.overview_desc') }}</p>

        <div class="analytics__range-tabs">
          <button
            v-for="r in overviewRanges"
            :key="r"
            :class="['analytics__range-tab', overviewRange === r && 'analytics__range-tab--active']"
            @click="overviewRange = r"
          >
            {{ r }}
          </button>
        </div>

        <div v-if="overviewQuery.isLoading.value" class="analytics__stat-grid">
          <div v-for="i in 4" :key="i" class="analytics__stat-tile">
            <div class="ui-skeleton" style="height: 0.75rem; width: 4rem; border-radius: 0.25rem; margin-bottom: 0.5rem;" />
            <div class="ui-skeleton" style="height: 1.5rem; width: 5rem; border-radius: 0.25rem;" />
          </div>
        </div>

        <div v-else-if="overviewQuery.isError.value" class="analytics__error">
          {{ t('status_page.failed_load_data') }}
        </div>

        <div v-else-if="overview" class="analytics__stat-grid">
          <div class="analytics__stat-tile">
            <div class="analytics__stat-label">{{ t('admin_analytics.uptime') }}</div>
            <div class="analytics__stat-value">{{ overview.totals.uptime_pct.toFixed(2) }}%</div>
          </div>
          <div class="analytics__stat-tile">
            <div class="analytics__stat-label">{{ t('admin_analytics.alerts') }}</div>
            <div class="analytics__stat-value">{{ overview.alerts.count }}</div>
          </div>
          <div class="analytics__stat-tile">
            <div class="analytics__stat-label">{{ t('admin_analytics.longest_outage') }}</div>
            <div class="analytics__stat-value">
              {{ overview.outages.longest_sec != null ? formatSec(overview.outages.longest_sec) : '-' }}
            </div>
          </div>
          <div class="analytics__stat-tile">
            <div class="analytics__stat-label">{{ t('admin_analytics.mttr') }}</div>
            <div class="analytics__stat-value">
              {{ overview.outages.mttr_sec != null ? formatSec(overview.outages.mttr_sec) : '-' }}
            </div>
          </div>
        </div>
      </UiCard>

      <!-- 监控项分析卡片 -->
      <UiCard class="analytics__card">
        <h2 class="analytics__card-title">{{ t('admin_analytics.monitor_title') }}</h2>
        <p class="analytics__card-desc">{{ t('admin_analytics.monitor_desc') }}</p>

        <div class="analytics__range-tabs">
          <button
            v-for="r in monitorRanges"
            :key="r"
            :class="['analytics__range-tab', monitorRange === r && 'analytics__range-tab--active']"
            @click="monitorRange = r"
          >
            {{ r }}
          </button>
        </div>

        <select
          class="analytics__select"
          :value="selectedMonitorId ?? ''"
          @change="selectedMonitorId = Number(($event.target as HTMLSelectElement).value) || null"
        >
          <option value="" disabled>{{ t('admin_analytics.monitor_label') }}</option>
          <option v-for="m in monitors" :key="m.id" :value="m.id">
            {{ m.name }}
          </option>
        </select>

        <template v-if="selectedMonitorId && monitorAnalytics">
          <div class="analytics__stat-grid">
            <div class="analytics__stat-tile">
              <div class="analytics__stat-label">{{ t('admin_analytics.uptime') }}</div>
              <div class="analytics__stat-value">{{ monitorAnalytics.uptime_pct.toFixed(2) }}%</div>
            </div>
            <div class="analytics__stat-tile">
              <div class="analytics__stat-label">{{ t('admin_analytics.unknown') }}</div>
              <div class="analytics__stat-value">{{ monitorAnalytics.unknown_pct.toFixed(2) }}%</div>
            </div>
            <div class="analytics__stat-tile">
              <div class="analytics__stat-label">{{ t('admin_analytics.downtime') }}</div>
              <div class="analytics__stat-value">{{ formatSec(monitorAnalytics.downtime_sec) }}</div>
            </div>
            <div class="analytics__stat-tile">
              <div class="analytics__stat-label">{{ t('admin_analytics.p95') }}</div>
              <div class="analytics__stat-value">
                {{ monitorAnalytics.p95_latency_ms != null ? `${monitorAnalytics.p95_latency_ms}ms` : '-' }}
              </div>
            </div>
            <div class="analytics__stat-tile">
              <div class="analytics__stat-label">{{ t('admin_analytics.p50') }}</div>
              <div class="analytics__stat-value">
                {{ monitorAnalytics.p50_latency_ms != null ? `${monitorAnalytics.p50_latency_ms}ms` : '-' }}
              </div>
            </div>
          </div>

          <div class="analytics__charts">
            <div v-if="monitorRange !== '24h'" class="analytics__chart-container">
              <DailyUptimeChart :points="monitorAnalytics.daily" />
            </div>
            <div class="analytics__chart-container">
              <LatencyChart v-if="monitorRange === '24h'" :points="monitorAnalytics.points" />
              <DailyLatencyChart v-else :points="monitorAnalytics.daily" />
            </div>
          </div>

          <!-- 中断表格 -->
          <div class="analytics__outages-section">
            <h3 class="analytics__section-title">{{ t('admin_analytics.outages') }}</h3>
            <DataTable>
              <thead>
                <tr>
                  <th>{{ t('admin_analytics.outage_start') }}</th>
                  <th>{{ t('admin_analytics.outage_end') }}</th>
                  <th>{{ t('admin_analytics.initial_error') }}</th>
                  <th>{{ t('admin_analytics.last_error') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in allOutages" :key="o.id" class="data-table__row">
                  <td>{{ formatDateTime(o.started_at, timeZone, locale) }}</td>
                  <td>{{ o.ended_at ? formatDateTime(o.ended_at, timeZone, locale) : t('admin_analytics.ongoing') }}</td>
                  <td class="data-table__td--error">{{ o.initial_error ?? '-' }}</td>
                  <td class="data-table__td--error">{{ o.last_error ?? '-' }}</td>
                </tr>
              </tbody>
            </DataTable>
            <UiButton
              v-if="hasMoreOutages"
              variant="secondary"
              size="sm"
              :disabled="isLoadingMoreOutages"
              style="margin-top: 0.75rem;"
              @click="loadMoreOutages"
            >
              {{ isLoadingMoreOutages ? t('common.loading') : t('common.load_more') }}
            </UiButton>
          </div>
        </template>

        <div v-else-if="selectedMonitorId && monitorAnalyticsQuery.isLoading.value" class="analytics__loading">
          {{ t('common.loading') }}
        </div>

        <div v-else-if="!selectedMonitorId" class="analytics__empty">
          {{ t('admin_analytics.monitor_label') }}
        </div>
      </UiCard>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.analytics {
  min-height: 100vh;
  background-color: var(--color-bg);
}

.analytics__main {
  max-width: 80rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;

  @media (min-width: 640px) {
    padding: 2rem 1.5rem;
  }
}

.analytics__card {
  padding: 1.25rem;

  @media (min-width: 640px) {
    padding: 1.5rem;
  }
}

.analytics__card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.analytics__card-desc {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 1rem;
}

.analytics__range-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  background: var(--color-bg);
  border-radius: 0.5rem;
  padding: 0.25rem;
  width: fit-content;
}

.analytics__range-tab {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;

  &--active {
    background: var(--color-card);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-card);
  }

  &:hover:not(&--active) {
    color: var(--color-text-secondary);
  }
}

.analytics__select {
  width: 100%;
  max-width: 20rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.analytics__stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;

  @media (min-width: 640px) {
    grid-template-columns: repeat(4, 1fr);
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(4, 1fr);
  }
}

.analytics__stat-tile {
  background: var(--color-bg);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
}

.analytics__stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

.analytics__stat-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.analytics__charts {
  margin-bottom: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.analytics__chart-container {
  background: var(--color-bg);
  border-radius: 0.5rem;
  padding: 1rem;
  overflow: visible;
}

.analytics__outages-section {
  margin-top: 1rem;
}

.analytics__section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.analytics__loading,
.analytics__empty {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-muted);
}

.analytics__error {
  text-align: center;
  padding: 1rem;
  color: var(--color-danger);
}
</style>
