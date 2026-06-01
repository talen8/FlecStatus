import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import type { App } from 'vue'
import type { PublicHomepageResponse, StatusResponse } from '../api/types'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

const LS_PUBLIC_HOMEPAGE_KEY = 'uptimer_public_homepage_snapshot_v2'
const LS_PUBLIC_STATUS_KEY = 'uptimer_public_status_snapshot_v1'

function toHeartbeatStatusCode(status: StatusResponse['monitors'][number]['heartbeats'][number]['status']) {
  switch (status) {
    case 'up':
      return 'u'
    case 'down':
      return 'd'
    case 'maintenance':
      return 'm'
    case 'unknown':
    default:
      return 'x'
  }
}

function readPersistedHomepageCache(): PublicHomepageResponse | null {
  try {
    const raw = localStorage.getItem(LS_PUBLIC_HOMEPAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const value = (parsed as { value?: unknown }).value
    if (!value || typeof value !== 'object') return null
    if (typeof (value as { generated_at?: unknown }).generated_at !== 'number') return null
    return value as PublicHomepageResponse
  } catch {
    return null
  }
}

function readPersistedStatusCache(): StatusResponse | null {
  try {
    const raw = localStorage.getItem(LS_PUBLIC_STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const value = (parsed as { value?: unknown }).value
    if (!value || typeof value !== 'object') return null
    if (typeof (value as { generated_at?: unknown }).generated_at !== 'number') return null
    return value as StatusResponse
  } catch {
    return null
  }
}

function homepageFromStatus(status: StatusResponse): PublicHomepageResponse {
  return {
    generated_at: status.generated_at,
    bootstrap_mode: 'full',
    monitor_count_total: status.monitors.length,
    site_title: status.site_title,
    site_description: status.site_description,
    site_locale: status.site_locale,
    site_timezone: status.site_timezone,
    site_nav_links: status.site_nav_links,
    overall_status: status.overall_status,
    banner: status.banner,
    summary: status.summary,
    monitors: status.monitors.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      group_name: monitor.group_name,
      status: monitor.status,
      is_stale: monitor.is_stale,
      last_checked_at: monitor.last_checked_at,
      public_access: false,
      target: '',
      heartbeat_strip: {
        checked_at: monitor.heartbeats.map((heartbeat) => heartbeat.checked_at),
        status_codes: monitor.heartbeats
          .map((heartbeat) => toHeartbeatStatusCode(heartbeat.status))
          .join(''),
        latency_ms: monitor.heartbeats.map((heartbeat) => heartbeat.latency_ms),
      },
      uptime_30d: monitor.uptime_30d ? { uptime_pct: monitor.uptime_30d.uptime_pct } : null,
      uptime_day_strip: {
        day_start_at: monitor.uptime_days.map((day) => day.day_start_at),
        downtime_sec: monitor.uptime_days.map((day) => day.downtime_sec),
        unknown_sec: monitor.uptime_days.map((day) => day.unknown_sec),
        uptime_pct_milli: monitor.uptime_days.map((day) =>
          day.uptime_pct === null ? null : Math.round(day.uptime_pct * 1000),
        ),
      },
    })),
    active_incidents: status.active_incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      message: incident.message,
      started_at: incident.started_at,
      resolved_at: incident.resolved_at,
    })),
    maintenance_windows: {
      active: status.maintenance_windows.active.map((window) => ({
        id: window.id,
        title: window.title,
        message: window.message,
        starts_at: window.starts_at,
        ends_at: window.ends_at,
        monitor_ids: window.monitor_ids,
      })),
      upcoming: status.maintenance_windows.upcoming.map((window) => ({
        id: window.id,
        title: window.title,
        message: window.message,
        starts_at: window.starts_at,
        ends_at: window.ends_at,
        monitor_ids: window.monitor_ids,
      })),
    },
    resolved_incident_preview: null,
    maintenance_history_preview: null,
  }
}

export function seedQueryCache() {
  const migratedPersistedStatus = readPersistedStatusCache()
  const persistedHomepage =
    readPersistedHomepageCache() ??
    (migratedPersistedStatus ? homepageFromStatus(migratedPersistedStatus) : null)

  if (persistedHomepage) {
    const updatedAt =
      typeof persistedHomepage.generated_at === 'number'
        ? persistedHomepage.generated_at * 1000
        : Date.now()
    queryClient.setQueryData<PublicHomepageResponse>(['homepage'], persistedHomepage, { updatedAt })
  }
}

export function installVueQuery(app: App) {
  seedQueryCache()
  app.use(VueQueryPlugin, { queryClient })
}
