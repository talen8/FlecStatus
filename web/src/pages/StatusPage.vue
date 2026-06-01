<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useI18nStore } from '../stores/i18n'
import {
  fetchHomepage,
  fetchPublicDayContext,
  fetchPublicIncidentDetail,
  fetchPublicMonitorOutages,
} from '../api/client'
import type {
  Incident,
  IncidentSummary,
  MaintenanceWindowPreview,
  Outage,
  PublicHomepageResponse,
} from '../api/types'
import MonitorCard from '../components/MonitorCard.vue'
import AppHeader from '../components/ui/AppHeader.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import { incidentImpactLabel, incidentStatusLabel } from '../i18n/labels'
import { formatDateTime, getBrowserTimeZone } from '../utils/datetime'
import { defineAsyncComponent } from 'vue'

const MonitorDetailModal = defineAsyncComponent(() => import('../components/MonitorDetailModal.vue'))
const IncidentDetailModal = defineAsyncComponent(() => import('../components/IncidentDetailModal.vue'))
const MaintenanceDetailModal = defineAsyncComponent(() => import('../components/MaintenanceDetailModal.vue'))
const DayDowntimeModal = defineAsyncComponent(() => import('../components/DayDowntimeModal.vue'))

type BannerStatus = PublicHomepageResponse['banner']['status']
type IncidentCardData = IncidentSummary | Incident

const i18n = useI18nStore()
const { locale, t } = i18n

const selectedMonitorId = ref<number | null>(null)
const selectedIncidentRequest = ref<{ incident: IncidentCardData; resolvedOnly: boolean } | null>(null)
const selectedMaintenance = ref<MaintenanceWindowPreview | null>(null)
const selectedDay = ref<{ monitorId: number; dayStartAt: number } | null>(null)

const homepageQuery = useQuery({
  queryKey: ['homepage'],
  queryFn: fetchHomepage,
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchOnMount: (query: { state: { data?: unknown } }) => {
    const data = query.state.data as PublicHomepageResponse | undefined
    if (!data || typeof data.generated_at !== 'number') return true
    return Date.now() - data.generated_at * 1000 > 60_000
  },
})

const data = computed(() => homepageQuery.data.value)
const isLoading = computed(() => homepageQuery.isLoading.value)
const derivedTitle = computed(() => data.value?.site_title || 'Uptimer')
const derivedTimeZone = computed(() => getBrowserTimeZone() || data.value?.site_timezone || 'UTC')
const siteTitle = derivedTitle
const timeZone = derivedTimeZone

watch(derivedTitle, (val) => { document.title = val }, { immediate: true })

function getBannerConfig(status: BannerStatus) {
  const configs = {
    operational: { iconBg: 'bg-emerald-500', text: t('status_page.all_systems_operational'), icon: '✓' },
    partial_outage: { iconBg: 'bg-amber-500', text: t('status_page.partial_system_outage'), icon: '!' },
    major_outage: { iconBg: 'bg-red-500', text: t('status_page.major_system_outage'), icon: '✕' },
    maintenance: { iconBg: 'bg-blue-500', text: t('status_page.scheduled_maintenance'), icon: '⚙' },
    unknown: { iconBg: 'bg-slate-500', text: t('status_page.status_unknown'), icon: '?' },
  }
  return configs[status] || configs.unknown
}

const bannerConfig = computed(() => data.value ? getBannerConfig(data.value.banner.status) : getBannerConfig('unknown'))
const activeIncidents = computed(() => data.value?.active_incidents ?? [])
const resolvedIncidentPreview = computed(() => data.value?.resolved_incident_preview ?? null)
const maintenanceHistoryPreview = computed(() => data.value?.maintenance_history_preview ?? null)

function monitorGroupLabel(groupName: string | null | undefined): string {
  const trimmed = groupName?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : t('status_page.group_ungrouped')
}

const groupedMonitors = computed(() => {
  const groups = new Map<string, PublicHomepageResponse['monitors']>()
  for (const monitor of data.value?.monitors ?? []) {
    const key = monitorGroupLabel(monitor.group_name)
    const list = groups.get(key) ?? []
    list.push(monitor)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([name, monitors]) => ({ name, monitors }))
})

const monitorNames = computed(() => new Map((data.value?.monitors ?? []).map(m => [m.id, m.name] as const)))

const outagesQuery = useQuery({
  queryKey: ['public-monitor-outages', computed(() => selectedDay.value?.monitorId), computed(() => selectedDay.value?.dayStartAt)],
  queryFn: () => fetchPublicMonitorOutages(selectedDay.value!.monitorId, { range: '30d', limit: 200 }),
  enabled: computed(() => selectedDay.value !== null),
})

const dayContextQuery = useQuery({
  queryKey: ['public-day-context', computed(() => selectedDay.value?.monitorId), computed(() => selectedDay.value?.dayStartAt)],
  queryFn: () => fetchPublicDayContext(selectedDay.value!.monitorId, selectedDay.value!.dayStartAt),
  enabled: computed(() => selectedDay.value !== null),
})

const currentDayOutages = computed((): Outage[] => {
  if (!selectedDay.value) return []
  const all = outagesQuery.data.value?.outages ?? []
  const dayStart = selectedDay.value.dayStartAt
  const dayEnd = dayStart + 86400
  return all.filter(o => o.started_at < dayEnd && (o.ended_at ?? dayEnd) > dayStart)
})

const incidentDetailQuery = useQuery({
  queryKey: ['public-incident-detail', computed(() => selectedIncidentRequest.value?.incident.id), computed(() => selectedIncidentRequest.value?.resolvedOnly)],
  queryFn: () => {
    const resolvedOnly = selectedIncidentRequest.value?.resolvedOnly
    return fetchPublicIncidentDetail(selectedIncidentRequest.value!.incident.id, resolvedOnly === undefined ? {} : { resolvedOnly })
  },
  enabled: computed(() => selectedIncidentRequest.value !== null),
})

const selectedIncident = computed(() => {
  if (incidentDetailQuery.data.value) return incidentDetailQuery.data.value
  if (selectedIncidentRequest.value) {
    return { ...selectedIncidentRequest.value.incident, monitor_ids: [], updates: [] }
  }
  return null
})
</script>

<template>
  <div class="status-page">
    <!-- 加载骨架屏 -->
    <template v-if="isLoading && !data">
      <header class="status-page__header">
        <div class="status-page__header-inner">
          <div class="ui-skeleton" style="height: 1.5rem; width: 7rem; border-radius: 0.25rem;" />
          <div class="ui-skeleton" style="height: 2rem; width: 5rem; border-radius: 9999px;" />
        </div>
      </header>
      <main class="status-page__main">
        <div class="ui-skeleton" style="height: 4rem; border-radius: 1rem; margin-bottom: 1.5rem;" />
        <div class="status-page__skeleton-grid">
          <UiCard v-for="i in 6" :key="i" class="status-page__skeleton-card">
            <div class="status-page__skeleton-header">
              <div style="height: 0.75rem; width: 0.75rem; border-radius: 9999px; background: var(--color-border);" />
              <div>
                <div style="height: 1rem; width: 8rem; border-radius: 0.25rem; background: var(--color-border); margin-bottom: 0.375rem;" />
                <div style="height: 0.75rem; width: 3rem; border-radius: 0.25rem; background: var(--color-border);" />
              </div>
            </div>
            <div style="height: 1.25rem; border-radius: 0.25rem; background: var(--color-border); margin-bottom: 0.625rem;" />
            <div style="display: flex; justify-content: space-between;">
              <div style="height: 0.875rem; width: 5rem; border-radius: 0.25rem; background: var(--color-border);" />
              <div style="height: 0.875rem; width: 6rem; border-radius: 0.25rem; background: var(--color-border);" />
            </div>
          </UiCard>
        </div>
      </main>
    </template>

    <!-- 错误状态 -->
    <template v-else-if="!data">
      <div class="status-page__error">
        <h2>{{ t('status_page.unable_to_load_status') }}</h2>
        <p>{{ t('status_page.check_connection') }}</p>
      </div>
    </template>

    <!-- 正常内容 -->
    <template v-else>
      <!-- 头部导航 -->
      <AppHeader :external-links="data.site_nav_links ?? []">
        <template #left>
          <router-link to="/" class="status-page__logo">
            <span class="status-page__site-title">{{ siteTitle }}</span>
            <span v-if="data.site_description" class="status-page__site-desc">
              {{ data.site_description }}
            </span>
          </router-link>
        </template>
      </AppHeader>

      <!-- 状态横幅 -->
      <div class="status-page__banner-section">
        <div class="status-page__banner-inner">
          <div :class="['status-page__banner-icon', bannerConfig.iconBg]">
            {{ bannerConfig.icon }}
          </div>
          <h2 class="status-page__banner-text">{{ bannerConfig.text }}</h2>
          <p v-if="data.banner.source === 'incident' && data.banner.incident" class="status-page__banner-detail">
            {{ t('status_page.incident_prefix', { value: data.banner.incident.title }) }}
          </p>
          <p v-if="data.banner.source === 'maintenance' && data.banner.maintenance_window" class="status-page__banner-detail">
            {{ t('status_page.maintenance_prefix', { value: data.banner.maintenance_window.title }) }}
          </p>
          <p class="status-page__last-updated">
            {{ t('common.last_updated', { value: formatDateTime(data.generated_at, timeZone, locale) }) }}
          </p>
        </div>
      </div>

      <main class="status-page__main">
        <!-- 维护窗口 -->
        <section v-if="data.maintenance_windows.active.length > 0 || data.maintenance_windows.upcoming.length > 0" class="status-page__section">
          <h3 class="status-page__section-title">
            <svg class="status-page__section-icon status-page__section-icon--blue" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {{ t('status_page.scheduled_maintenance') }}
          </h3>

          <!-- 活跃维护 -->
          <div v-if="data.maintenance_windows.active.length > 0" class="status-page__subsection">
            <div class="status-page__subsection-label">{{ t('common.active') }}</div>
            <div class="status-page__card-stack">
              <UiCard v-for="w in data.maintenance_windows.active" :key="w.id" hover class="status-page__incident-card" :onClick="() => selectedMaintenance = w">
                <div class="status-page__incident-header">
                  <h4 class="status-page__incident-title">{{ w.title }}</h4>
                  <span class="status-page__maintenance-time">
                    {{ formatDateTime(w.starts_at, timeZone, locale) }} – {{ formatDateTime(w.ends_at, timeZone, locale) }}
                  </span>
                </div>
                <div class="status-page__incident-meta">
                  <span>{{ t('common.affected') }}: {{ w.monitor_ids.map(id => monitorNames.get(id) ?? `#${id}`).join(', ') }}</span>
                </div>
                <p v-if="w.message" class="status-page__incident-message">{{ w.message }}</p>
              </UiCard>
            </div>
          </div>

          <!-- 即将到来的维护 -->
          <div v-if="data.maintenance_windows.upcoming.length > 0">
            <div class="status-page__subsection-label">{{ t('common.upcoming') }}</div>
            <div class="status-page__card-stack">
              <UiCard v-for="w in data.maintenance_windows.upcoming" :key="w.id" hover class="status-page__incident-card" :onClick="() => selectedMaintenance = w">
                <div class="status-page__incident-header">
                  <h4 class="status-page__incident-title">{{ w.title }}</h4>
                  <span class="status-page__maintenance-time">
                    {{ formatDateTime(w.starts_at, timeZone, locale) }} – {{ formatDateTime(w.ends_at, timeZone, locale) }}
                  </span>
                </div>
                <div class="status-page__incident-meta">
                  <span>{{ t('common.affected') }}: {{ w.monitor_ids.map(id => monitorNames.get(id) ?? `#${id}`).join(', ') }}</span>
                </div>
              </UiCard>
            </div>
          </div>
        </section>

        <!-- 活跃事件 -->
        <section v-if="activeIncidents.length > 0" class="status-page__section">
          <h3 class="status-page__section-title">
            <svg class="status-page__section-icon status-page__section-icon--amber" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {{ t('status_page.active_incidents') }}
          </h3>
          <div class="status-page__card-stack">
            <UiCard
              v-for="it in activeIncidents"
              :key="it.id"
              hover
              class="status-page__incident-card"
              :onClick="() => selectedIncidentRequest = { incident: it, resolvedOnly: false }"
            >
              <div class="status-page__incident-header">
                <h4 class="status-page__incident-title">{{ it.title }}</h4>
                <UiBadge :variant="it.impact === 'critical' || it.impact === 'major' ? 'down' : 'paused'">
                  {{ incidentImpactLabel(it.impact, t) }}
                </UiBadge>
              </div>
              <div class="status-page__incident-meta">
                <UiBadge variant="info">{{ incidentStatusLabel(it.status, t) }}</UiBadge>
                <span>{{ formatDateTime(it.started_at, timeZone, locale) }}</span>
              </div>
              <p v-if="it.message" class="status-page__incident-message">{{ it.message }}</p>
            </UiCard>
          </div>
        </section>

        <!-- 监控项 -->
        <section class="status-page__section">
          <h3 class="status-page__section-title">{{ t('status_page.services') }}</h3>
          <div class="status-page__groups">
            <div v-for="group in groupedMonitors" :key="group.name">
              <div class="status-page__group-header">
                <h4 class="status-page__group-name">{{ group.name }}</h4>
                <span class="status-page__group-count">{{ group.monitors.length }}</span>
              </div>
              <div class="status-page__monitor-grid">
                <MonitorCard
                  v-for="monitor in group.monitors"
                  :key="monitor.id"
                  :monitor="monitor"
                  :time-zone="timeZone"
                  :on-select="() => selectedMonitorId = monitor.id"
                  :on-day-click="(dayStartAt) => selectedDay = { monitorId: monitor.id, dayStartAt }"
                />
              </div>
            </div>
          </div>
          <UiCard v-if="data.monitors.length === 0" class="status-page__empty-card">
            <p>{{ t('status_page.no_monitors') }}</p>
          </UiCard>
        </section>

        <!-- 历史记录 -->
        <section class="status-page__history-section">
          <!-- 事件历史 -->
          <div>
            <div class="status-page__history-header">
              <h3 class="status-page__section-title">{{ t('status_page.incident_history') }}</h3>
              <router-link to="/history/incidents" class="status-page__view-more">{{ t('common.view_more') }}</router-link>
            </div>
            <UiCard
              v-if="resolvedIncidentPreview"
              hover
              class="status-page__incident-card"
              :onClick="() => selectedIncidentRequest = { incident: resolvedIncidentPreview!, resolvedOnly: true }"
            >
              <div class="status-page__incident-header">
                <h4 class="status-page__incident-title">{{ resolvedIncidentPreview.title }}</h4>
                <UiBadge :variant="resolvedIncidentPreview.impact === 'critical' || resolvedIncidentPreview.impact === 'major' ? 'down' : 'paused'">
                  {{ incidentImpactLabel(resolvedIncidentPreview.impact, t) }}
                </UiBadge>
              </div>
              <div class="status-page__incident-meta">
                <UiBadge variant="info">{{ incidentStatusLabel(resolvedIncidentPreview.status, t) }}</UiBadge>
                <span>{{ formatDateTime(resolvedIncidentPreview.started_at, timeZone, locale) }}</span>
              </div>
              <p v-if="resolvedIncidentPreview.message" class="status-page__incident-message">{{ resolvedIncidentPreview.message }}</p>
            </UiCard>
            <UiCard v-else class="status-page__empty-card">
              <p>{{ t('status_page.no_past_incidents') }}</p>
            </UiCard>
          </div>

          <!-- 维护历史 -->
          <div>
            <div class="status-page__history-header">
              <h3 class="status-page__section-title">{{ t('status_page.maintenance_history') }}</h3>
              <router-link to="/history/maintenance" class="status-page__view-more">{{ t('common.view_more') }}</router-link>
            </div>
            <UiCard v-if="maintenanceHistoryPreview" hover class="status-page__incident-card" :onClick="() => selectedMaintenance = maintenanceHistoryPreview">
              <div class="status-page__incident-header">
                <h4 class="status-page__incident-title">{{ maintenanceHistoryPreview.title }}</h4>
                <span class="status-page__maintenance-time">
                  {{ formatDateTime(maintenanceHistoryPreview.starts_at, timeZone, locale) }} – {{ formatDateTime(maintenanceHistoryPreview.ends_at, timeZone, locale) }}
                </span>
              </div>
              <div class="status-page__incident-meta">
                <span>{{ t('common.affected') }}: {{ maintenanceHistoryPreview.monitor_ids.map(id => monitorNames.get(id) ?? `#${id}`).join(', ') }}</span>
              </div>
              <p v-if="maintenanceHistoryPreview.message" class="status-page__incident-message">{{ maintenanceHistoryPreview.message }}</p>
            </UiCard>
            <UiCard v-else class="status-page__empty-card">
              <p>{{ t('status_page.no_past_maintenance') }}</p>
            </UiCard>
          </div>
        </section>
      </main>

      <!-- 页脚 -->
      <footer class="status-page__footer">
        <div class="status-page__footer-inner">
          <span>原项目：<a href="https://github.com/VrianCao/Uptimer" target="_blank" rel="noopener noreferrer">Uptimer</a></span>
          <span class="status-page__footer-sep">·</span>
          <span>二开：<a href="https://github.com/talen8/FlecStatus" target="_blank" rel="noopener noreferrer">FlecStatus</a></span>
        </div>
      </footer>

      <!-- 弹窗 -->
      <MonitorDetailModal
        v-if="selectedMonitorId !== null"
        :monitor-id="selectedMonitorId"
        @close="selectedMonitorId = null"
      />

      <IncidentDetailModal
        v-if="selectedIncident"
        :incident="selectedIncident"
        :monitor-names="monitorNames"
        :time-zone="timeZone"
        :is-loading-details="incidentDetailQuery.isLoading.value"
        :has-details-error="incidentDetailQuery.isError.value"
        @close="selectedIncidentRequest = null"
      />

      <MaintenanceDetailModal
        v-if="selectedMaintenance"
        :maintenance="selectedMaintenance"
        :monitor-names="monitorNames"
        :time-zone="timeZone"
        @close="selectedMaintenance = null"
      />

      <DayDowntimeModal
        v-if="selectedDay"
        :day-start-at="selectedDay.dayStartAt"
        :outages="currentDayOutages"
        :maintenance-windows="dayContextQuery.data.value?.maintenance_windows ?? []"
        :incidents="dayContextQuery.data.value?.incidents ?? []"
        :time-zone="timeZone"
        @close="selectedDay = null"
      />

      <!-- 加载提示 -->
      <div v-if="selectedDay && outagesQuery.isLoading.value" class="status-page__loading-toast">
        {{ t('status_page.loading_outages') }}
      </div>
      <div v-if="selectedDay && outagesQuery.isError.value" class="status-page__error-toast">
        {{ t('status_page.failed_load_outages') }}
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.status-page {
  min-height: 100vh;
  background-color: var(--color-bg);
}

.status-page__header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-card);
  backdrop-filter: blur(12px);
}

.status-page__header-inner {
  max-width: 64rem;
  margin: 0 auto;
  padding: 0.75rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;

  @media (min-width: 640px) {
    padding: 1rem 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 1rem 2rem;
  }
}

.status-page__logo {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  min-height: 2.25rem;
  text-decoration: none;
}

.status-page__site-title {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (min-width: 640px) {
    font-size: 1.5rem;
  }
}

.status-page__site-desc {
  margin-top: 0.125rem;
  font-size: 0.875rem;
  line-height: 1.25;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-page__banner-section {
  padding-top: 1.75rem;
  padding-bottom: 0.75rem;

  @media (min-width: 640px) {
    padding-top: 3rem;
    padding-bottom: 1.25rem;
  }
}

.status-page__banner-inner {
  max-width: 64rem;
  margin: 0 auto;
  padding: 0 1rem;
  text-align: center;

  @media (min-width: 640px) {
    padding: 0 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 0 2rem;
  }
}

.status-page__banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 9999px;
  color: white;
  font-size: 1.125rem;
  margin-bottom: 0.5rem;

  @media (min-width: 640px) {
    width: 3rem;
    height: 3rem;
    font-size: 1.5rem;
    margin-bottom: 0.75rem;
  }
}

.bg-emerald-500 { background-color: var(--color-up); }
.bg-amber-500 { background-color: var(--color-paused); }
.bg-red-500 { background-color: var(--color-down); }
.bg-blue-500 { background-color: var(--color-maintenance); }
.bg-slate-500 { background-color: var(--color-unknown); }

.status-page__banner-text {
  font-size: 1.125rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
  color: var(--color-text-primary);

  @media (min-width: 640px) {
    font-size: 1.5rem;
  }
}

.status-page__banner-detail {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  padding: 0 1rem;
}

.status-page__last-updated {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.status-page__main {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem;

  @media (min-width: 640px) {
    padding: 1.75rem 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 1.75rem 2rem;
  }
}

.status-page__section {
  margin-bottom: 1.5rem;

  @media (min-width: 640px) {
    margin-bottom: 2rem;
  }
}

.status-page__section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.625rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  @media (min-width: 640px) {
    font-size: 1.125rem;
    margin-bottom: 0.75rem;
  }
}

.status-page__section-icon {
  width: 1rem;
  height: 1rem;

  @media (min-width: 640px) {
    width: 1.25rem;
    height: 1.25rem;
  }
}

.status-page__section-icon--blue { color: var(--color-maintenance); }
.status-page__section-icon--amber { color: var(--color-paused); }

.status-page__subsection {
  margin-bottom: 1rem;
}

.status-page__subsection-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.status-page__card-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.status-page__maintenance-time {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.status-page__incident-card {
  width: 100%;
  text-align: left;
  padding: 0.875rem;

  @media (min-width: 640px) {
    padding: 1.25rem;
  }

  > :last-child {
    margin-bottom: 0;
  }
}

.status-page__incident-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.status-page__incident-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.status-page__incident-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 0.75rem;
}

.status-page__incident-message {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.status-page__groups {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.status-page__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.status-page__group-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.status-page__group-count {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.status-page__monitor-grid {
  display: grid;
  gap: 0.625rem;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
}

.status-page__empty-card {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.status-page__history-section {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;

  @media (min-width: 640px) {
    margin-top: 2rem;
    padding-top: 1.5rem;
    gap: 2rem;
  }
}

.status-page__history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.625rem;

  @media (min-width: 640px) {
    margin-bottom: 0.75rem;
  }
}

.status-page__view-more {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  text-decoration: none;

  &:hover {
    color: var(--color-text-primary);
  }
}

.status-page__footer {
  border-top: 1px solid var(--color-border);
  background-color: var(--color-card);
}

.status-page__footer-inner {
  max-width: 64rem;
  margin: 0 auto;
  padding: 0.75rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;

  a {
    color: var(--color-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover {
      color: var(--color-text-primary);
    }
  }

  @media (min-width: 640px) {
    padding: 1rem 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 1rem 2rem;
  }
}

.status-page__error {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg);

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }

  p {
    color: var(--color-text-muted);
  }
}

.status-page__loading-toast,
.status-page__error-toast {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.status-page__loading-toast > div,
.status-page__error-toast > div {
  background-color: rgba(15, 23, 42, 0.8);
  color: white;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
}

.status-page__error-toast > div {
  background-color: rgba(220, 38, 38, 0.9);
}

.status-page__skeleton-grid {
  display: grid;
  gap: 0.625rem;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
}

.status-page__skeleton-card {
  padding: 1rem;
}

.status-page__skeleton-header {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin-bottom: 0.625rem;
}
</style>
