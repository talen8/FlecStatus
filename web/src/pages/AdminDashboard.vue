<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18nStore } from '../stores/i18n'
import {
  ApiError,
  fetchAdminMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  pauseMonitor,
  resumeMonitor,
  testMonitor,
  assignMonitorsToGroup,
  fetchNotificationChannels,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
  fetchAdminIncidents,
  createIncident,
  addIncidentUpdate,
  resolveIncident,
  deleteIncident,
  fetchMaintenanceWindows,
  createMaintenanceWindow,
  updateMaintenanceWindow,
  deleteMaintenanceWindow,
  fetchAdminSettings,
  patchAdminSettings,
} from '../api/client'
import type {
  AdminMonitor,
  Incident,
  MaintenanceWindow,
  NotificationChannel,
  AdminSettings,
  CreateMonitorInput,
  PatchMonitorInput,
  CreateNotificationChannelInput,
  PatchNotificationChannelInput,
  CreateIncidentInput,
  CreateIncidentUpdateInput,
  ResolveIncidentInput,
  CreateMaintenanceWindowInput,
  PatchMaintenanceWindowInput,
  StatusResponse,
  SiteNavLink,
  MonitorStatus,
} from '../api/types'
import AppHeader from '../components/ui/AppHeader.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import DetailModal from '../components/ui/DetailModal.vue'
const MonitorForm = defineAsyncComponent(() => import('../components/forms/MonitorForm.vue'))
const MonitorGroupForm = defineAsyncComponent(() => import('../components/forms/MonitorGroupForm.vue'))
const IncidentForm = defineAsyncComponent(() => import('../components/forms/IncidentForm.vue'))
const IncidentUpdateForm = defineAsyncComponent(() => import('../components/forms/IncidentUpdateForm.vue'))
const ResolveIncidentForm = defineAsyncComponent(() => import('../components/forms/ResolveIncidentForm.vue'))
const MaintenanceWindowForm = defineAsyncComponent(() => import('../components/forms/MaintenanceWindowForm.vue'))
const CompleteMaintenanceForm = defineAsyncComponent(() => import('../components/forms/CompleteMaintenanceForm.vue'))
const NotificationChannelForm = defineAsyncComponent(() => import('../components/forms/NotificationChannelForm.vue'))
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import AdminTabLayout from '../components/admin/AdminTabLayout.vue'
import DataTable from '../components/ui/DataTable.vue'
import { incidentImpactLabel, incidentStatusLabel, statusLabel } from '../i18n/labels'
import { formatDateTime } from '../utils/datetime'

// ─── 类型 ───
type Tab = 'monitors' | 'notifications' | 'incidents' | 'maintenance' | 'settings'
type ModalState =
  | { type: 'none' }
  | { type: 'create-monitor' }
  | { type: 'edit-monitor'; monitor: AdminMonitor }
  | { type: 'edit-monitor-group'; groupLabel: string; groupSortOrder: number; monitorCount: number; monitorIds: number[] }
  | { type: 'create-channel' }
  | { type: 'edit-channel'; channel: NotificationChannel }
  | { type: 'create-incident' }
  | { type: 'add-incident-update'; incident: Incident }
  | { type: 'resolve-incident'; incident: Incident }
  | { type: 'create-maintenance' }
  | { type: 'edit-maintenance'; window: MaintenanceWindow }
  | { type: 'complete-maintenance'; window: MaintenanceWindow }

type MonitorTestFeedback = {
  at: number
  monitor: { id: number; name: string }
  result: { status: string; latency_ms: number | null; http_status: number | null; error: string | null; attempts: number }
}
type MonitorTestErrorState = { monitorId: number; at: number; message: string }
type ChannelTestFeedback = {
  at: number
  channelId: number
  eventKey: string
  delivery: { status: string; http_status: number | null; error: string | null; created_at: number } | null
}
type ChannelTestErrorState = { channelId: number; at: number; message: string }

type MonitorGroupMeta = { label: string; count: number; sortOrder: number }

// ─── 常量 ───
const UNGROUPED_LABEL = 'Ungrouped'

const SETTINGS_ICON_PATH = 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z'

// ─── 辅助函数 ───
function formatError(err: unknown): string | undefined {
  if (!err) return undefined
  if (err instanceof ApiError) return `${err.code}: ${err.message}`
  if (err instanceof Error) return err.message
  return String(err)
}

function sanitizeSiteTitle(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Uptimer'
  return trimmed.slice(0, 100)
}

function sanitizeSiteDescription(value: string): string {
  return value.trim().slice(0, 500)
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function monitorGroupLabel(monitor: Pick<AdminMonitor, 'group_name'>): string {
  const trimmed = monitor.group_name?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : UNGROUPED_LABEL
}

function displayGroupLabel(groupLabel: string): string {
  return groupLabel === UNGROUPED_LABEL ? ungroupedLabel.value : groupLabel
}

function formatMonitorDisplayName(monitor: Pick<AdminMonitor, 'id' | 'name'>): string {
  return `${monitor.name} (#${monitor.id})`
}

function formatMonitorDisplayNameById(id: number, nameById: Map<number, string>): string {
  const name = nameById.get(id)
  return name ? `${name} (#${id})` : `#${id}`
}

// ─── Store / Router ───
const i18n = useI18nStore()
const { locale, t } = i18n
const queryClient = useQueryClient()

// ─── 导航链接 ───
const adminNavLinks = computed(() => [
  {
    to: '/admin/analytics',
    label: t('admin_analytics.analytics_title'),
    iconPath: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    to: '/',
    label: t('common.status'),
    iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
])

const ungroupedLabel = computed(() => t('status_page.group_ungrouped'))

// ─── 标签页定义 ───
const tabs = computed(() => [
  { key: 'monitors' as Tab, label: t('admin_dashboard.tab.monitors'), icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { key: 'notifications' as Tab, label: t('admin_dashboard.tab.notifications'), icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { key: 'incidents' as Tab, label: t('admin_dashboard.tab.incidents'), icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { key: 'maintenance' as Tab, label: t('admin_dashboard.tab.maintenance'), icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'settings' as Tab, label: t('admin_dashboard.tab.settings'), icon: SETTINGS_ICON_PATH },
])

// ─── 状态 ───
const tab = ref<Tab>('monitors')
const modal = ref<ModalState>({ type: 'none' })
const editMonitor = ref<AdminMonitor | null>(null)
const editIncident = ref<Incident | null>(null)
const editMaintenance = ref<MaintenanceWindow | null>(null)
const editChannel = ref<NotificationChannel | null>(null)

// 测试反馈
const testingMonitorId = ref<number | null>(null)
const monitorTestFeedback = ref<MonitorTestFeedback | null>(null)
const monitorTestError = ref<MonitorTestErrorState | null>(null)
const testingChannelId = ref<number | null>(null)
const channelTestFeedback = ref<ChannelTestFeedback | null>(null)
const channelTestError = ref<ChannelTestErrorState | null>(null)

const modalTitle = computed(() => {
  switch (modal.value.type) {
    case 'create-monitor': return t('admin_dashboard.create_monitor')
    case 'edit-monitor': return t('admin_dashboard.edit_monitor')
    case 'edit-monitor-group': return t('admin_dashboard.group_edit_title')
    case 'create-channel': return t('admin_dashboard.create_channel')
    case 'edit-channel': return t('admin_dashboard.edit_channel')
    case 'create-incident': return t('admin_dashboard.create_incident')
    case 'add-incident-update': return t('incident_update.post_update')
    case 'resolve-incident': return t('admin_dashboard.resolve_incident')
    case 'create-maintenance': return t('admin_dashboard.create_maintenance')
    case 'edit-maintenance': return t('admin_dashboard.edit_maintenance')
    case 'complete-maintenance': return t('common.complete')
    default: return null
  }
})

function openModal(state: ModalState) { modal.value = state }
function closeModal() {
  modal.value = { type: 'none' }
  editMonitor.value = null
  editIncident.value = null
  editMaintenance.value = null
  editChannel.value = null
}

// ─── 数据查询 ───
const settingsQuery = useQuery({
  queryKey: ['admin-settings'],
  queryFn: fetchAdminSettings,
  staleTime: 60_000,
})

const timeZone = computed(() => settingsQuery.data.value?.settings.site_timezone ?? 'UTC')
const settingsDraft = ref<AdminSettings | null>(null)

watch(
  () => settingsQuery.data.value,
  (data) => {
    if (!data) return
    settingsDraft.value = { ...data.settings }
  },
  { immediate: true },
)

// 监听站点标题变化，更新文档标题
watch(
  () => settingsQuery.data.value,
  (data) => {
    if (data?.settings.site_title) {
      document.title = `${data.settings.site_title}管理`
    }
  },
  { immediate: true },
)

const monitorsQuery = useQuery({
  queryKey: ['admin-monitors'],
  queryFn: () => fetchAdminMonitors(),
})

const monitors = computed(() => monitorsQuery.data.value?.monitors ?? [])
const monitorNameById = computed(() => new Map(monitors.value.map(m => [m.id, m.name] as const)))
const monitorsForForm = computed(() => monitors.value.map(m => ({ id: m.id, name: formatMonitorDisplayName(m) })))

const channelsQuery = useQuery({
  queryKey: ['admin-channels'],
  queryFn: () => fetchNotificationChannels(),
})

const channels = computed(() => channelsQuery.data.value?.notification_channels ?? [])
const channelNameById = computed(() => new Map(channels.value.map(ch => [ch.id, ch.name] as const)))

const incidentsQuery = useQuery({
  queryKey: ['admin-incidents'],
  queryFn: () => fetchAdminIncidents(),
})

const incidents = computed(() => incidentsQuery.data.value?.incidents ?? [])

const maintenanceQuery = useQuery({
  queryKey: ['admin-maintenance-windows'],
  queryFn: () => fetchMaintenanceWindows(),
})

const maintenanceWindows = computed(() => maintenanceQuery.data.value?.maintenance_windows ?? [])

// ─── 监控分组/排序 computed ───
const monitorGroupMetaByLabel = computed(() => {
  const byLabel = new Map<string, MonitorGroupMeta>()
  for (const m of monitors.value) {
    const label = monitorGroupLabel(m)
    const existing = byLabel.get(label)
    if (!existing) {
      byLabel.set(label, { label, count: 1, sortOrder: m.group_sort_order })
    } else {
      existing.count += 1
      if (m.group_sort_order < existing.sortOrder) existing.sortOrder = m.group_sort_order
    }
  }
  return byLabel
})

const orderedMonitorGroups = computed(() => {
  return [...monitorGroupMetaByLabel.value.values()].sort((a, b) => {
    const cmp = a.sortOrder - b.sortOrder
    return cmp !== 0 ? cmp : a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
})

const monitorCountsByGroup = computed(() => new Map(orderedMonitorGroups.value.map(g => [g.label, g.count] as const)))
const editingMonitorGroupModal = computed(() => modal.value.type === 'edit-monitor-group' ? modal.value : null)
const editingMonitorGroupIds = computed(() => editingMonitorGroupModal.value?.monitorIds ?? [])

const sortedMonitors = computed(() => {
  const list = [...monitors.value]
  list.sort((a, b) => {
    const groupA = monitorGroupLabel(a)
    const groupB = monitorGroupLabel(b)
    const orderA = monitorGroupMetaByLabel.value.get(groupA)?.sortOrder ?? 0
    const orderB = monitorGroupMetaByLabel.value.get(groupB)?.sortOrder ?? 0
    const orderCmp = orderA - orderB
    if (orderCmp !== 0) return orderCmp
    const groupCmp = groupA.localeCompare(groupB, undefined, { sensitivity: 'base' })
    if (groupCmp !== 0) return groupCmp
    const configuredCmp = a.sort_order - b.sort_order
    if (configuredCmp !== 0) return configuredCmp
    return a.id - b.id
  })
  return list
})

// ─── 辅助 ───
function statusBadgeVariant(status: string): 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' | 'info' {
  const s = status as MonitorStatus
  switch (s) {
    case 'up': return 'up'
    case 'down': return 'down'
    case 'maintenance': return 'info'
    case 'paused': return 'paused'
    default: return 'paused'
  }
}

function maintenanceState(w: MaintenanceWindow): { variant: 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' | 'info'; label: string } {
  const now = Date.now() / 1000
  if (now < w.starts_at) return { variant: 'info', label: t('common.upcoming') }
  if (now < w.ends_at) return { variant: 'maintenance', label: t('common.active') }
  return { variant: 'unknown', label: t('common.ended') }
}

// ─── Mutations ───

const patchSettingsMut = useMutation({
  mutationFn: (patch: Record<string, unknown>) => patchAdminSettings(patch as Partial<AdminSettings>),
  onMutate: async () => {
    await queryClient.cancelQueries({ queryKey: ['admin-settings'] })
    await queryClient.cancelQueries({ queryKey: ['status'] })
    const prevSettings = queryClient.getQueryData<{ settings: AdminSettings }>(['admin-settings'])
    const prevStatus = queryClient.getQueryData<StatusResponse>(['status'])
    return { prevSettings, prevStatus }
  },
  onError: (err, _patch, ctx) => {
    const ctxObj = ctx as { prevSettings?: { settings: AdminSettings }; prevStatus?: StatusResponse } | undefined
    if (ctxObj?.prevSettings) queryClient.setQueryData(['admin-settings'], ctxObj.prevSettings)
    if (ctxObj?.prevStatus) queryClient.setQueryData(['status'], ctxObj.prevStatus)
  },
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-settings'], data)
    settingsDraft.value = { ...data.settings }
    const title = data.settings.site_title
    queryClient.setQueryData<StatusResponse>(['status'], old =>
      old ? { ...old, site_title: title } : old,
    )
  },
})

/** 更新草稿中的单个字段 */
function updateSettingsDraft(key: keyof AdminSettings, value: AdminSettings[keyof AdminSettings]) {
  if (!settingsDraft.value) return
  settingsDraft.value = { ...settingsDraft.value, [key]: value }
}

/** 清洗值并更新草稿（用于 @blur，纠正非法输入但不触发保存） */
function sanitizeAndApplyDraft(key: keyof AdminSettings, sanitizedValue: AdminSettings[keyof AdminSettings]) {
  if (!settingsDraft.value) return
  settingsDraft.value = { ...settingsDraft.value, [key]: sanitizedValue }
}

/** 比较草稿与服务端数据，判断是否有未保存变更 */
const hasUnsavedSettings = computed(() => {
  const server = settingsQuery.data.value?.settings
  if (!server || !settingsDraft.value) return false
  const draft = settingsDraft.value
  if (draft.site_title !== server.site_title) return true
  if (draft.site_description !== server.site_description) return true
  if (draft.site_timezone !== server.site_timezone) return true
  if (draft.retention_check_results_days !== server.retention_check_results_days) return true
  if (draft.state_failures_to_down_from_up !== server.state_failures_to_down_from_up) return true
  if (draft.state_successes_to_up_from_down !== server.state_successes_to_up_from_down) return true
  if (draft.admin_default_overview_range !== server.admin_default_overview_range) return true
  if (draft.admin_default_monitor_range !== server.admin_default_monitor_range) return true
  const draftLinks = draft.site_nav_links ?? []
  const serverLinks = server.site_nav_links ?? []
  if (draftLinks.length !== serverLinks.length) return true
  for (let i = 0; i < draftLinks.length; i++) {
    const dl = draftLinks[i]!
    const sl = serverLinks[i]
    if (!sl || dl.label !== sl.label || dl.url !== sl.url) return true
  }
  return false
})

/** 未保存变更时，离开页面弹出浏览器确认 */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (hasUnsavedSettings.value) {
    e.preventDefault()
  }
}
window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

/** 收集变更字段并批量保存 */
function saveSettings() {
  const server = settingsQuery.data.value?.settings
  if (!server || !settingsDraft.value) return
  const draft = settingsDraft.value
  const patch: Record<string, unknown> = {}
  if (draft.site_title !== server.site_title) patch.site_title = draft.site_title
  if (draft.site_description !== server.site_description) patch.site_description = draft.site_description
  if (draft.site_timezone !== server.site_timezone) patch.site_timezone = draft.site_timezone
  if (draft.retention_check_results_days !== server.retention_check_results_days) patch.retention_check_results_days = draft.retention_check_results_days
  if (draft.state_failures_to_down_from_up !== server.state_failures_to_down_from_up) patch.state_failures_to_down_from_up = draft.state_failures_to_down_from_up
  if (draft.state_successes_to_up_from_down !== server.state_successes_to_up_from_down) patch.state_successes_to_up_from_down = draft.state_successes_to_up_from_down
  if (draft.admin_default_overview_range !== server.admin_default_overview_range) patch.admin_default_overview_range = draft.admin_default_overview_range
  if (draft.admin_default_monitor_range !== server.admin_default_monitor_range) patch.admin_default_monitor_range = draft.admin_default_monitor_range
  const draftLinks = draft.site_nav_links ?? []
  const serverLinks = server.site_nav_links ?? []
  for (let i = 0; i < 3; i++) {
    const dl = draftLinks[i] ?? { label: '', url: '' }
    const sl = serverLinks[i] ?? { label: '', url: '' }
    if (dl.label !== sl.label) patch[`site_nav_link_${i + 1}_label`] = dl.label
    if (dl.url !== sl.url) patch[`site_nav_link_${i + 1}_url`] = dl.url
  }
  if (Object.keys(patch).length === 0) return
  patchSettingsMut.mutate(patch)
}

function getNavLink(index: number): SiteNavLink | undefined {
  return settingsDraft.value?.site_nav_links?.[index]
}

/** 导航链接失焦时仅更新草稿 */
function onNavLinkBlur(index: number, field: 'label' | 'url', value: string) {
  if (!settingsDraft.value) return
  const current = [...(settingsDraft.value.site_nav_links ?? [])]
  while (current.length <= index) {
    current.push({ label: '', url: '' })
  }
  const trimmed = value.trim()
  const existing = current[index] ?? { label: '', url: '' }
  current[index] = { ...existing, [field]: trimmed } as SiteNavLink
  settingsDraft.value = { ...settingsDraft.value, site_nav_links: current }
}

// 监控项
const createMonitorMut = useMutation({
  mutationFn: createMonitor,
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-monitors'] })
    closeModal()
  },
})

const updateMonitorMut = useMutation({
  mutationFn: ({ id, data }: { id: number; data: PatchMonitorInput }) => updateMonitor(id, data),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-monitors'] })
    closeModal()
  },
})

const assignMonitorGroupMut = useMutation({
  mutationFn: assignMonitorsToGroup,
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-monitors'] })
    closeModal()
  },
})

const deleteMonitorMut = useMutation({
  mutationFn: deleteMonitor,
  onSuccess: (_data, id) => {
    queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
      monitors: (old?.monitors ?? []).filter(m => m.id !== id),
    }))
  },
})

const pauseMonitorMut = useMutation({
  mutationFn: pauseMonitor,
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
      monitors: (old?.monitors ?? []).map(m => m.id === data.monitor.id ? data.monitor : m),
    }))
  },
})

const resumeMonitorMut = useMutation({
  mutationFn: resumeMonitor,
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
      monitors: (old?.monitors ?? []).map(m => m.id === data.monitor.id ? data.monitor : m),
    }))
  },
})

const testMonitorMut = useMutation({
  mutationFn: testMonitor,
  onSuccess: (data) => {
    monitorTestFeedback.value = { at: Math.floor(Date.now() / 1000), monitor: data.monitor, result: data.result }
    monitorTestError.value = null
  },
  onError: (err, monitorId) => {
    monitorTestError.value = { monitorId, at: Math.floor(Date.now() / 1000), message: formatError(err) ?? t('admin_dashboard.monitor_test_failed_default') }
    monitorTestFeedback.value = null
  },
  onSettled: () => { testingMonitorId.value = null },
})

function handleCreateMonitor(data: CreateMonitorInput | PatchMonitorInput) { createMonitorMut.mutate(data as CreateMonitorInput) }
function handleUpdateMonitor(data: PatchMonitorInput) {
  if (editMonitor.value) updateMonitorMut.mutate({ id: editMonitor.value.id, data })
}
function handleAssignMonitorGroup(data: { groupName: string; groupSortOrder: number }) {
  const monitorIds = editingMonitorGroupIds.value
  if (monitorIds.length === 0) return
  assignMonitorGroupMut.mutate({
    monitor_ids: monitorIds,
    group_name: data.groupName,
    group_sort_order: data.groupSortOrder,
  })
}
function handleDeleteMonitor(id: number) {
  const name = monitorNameById.value.get(id) ?? `#${id}`
  if (confirm(t('common.confirm_delete_name', { name }))) deleteMonitorMut.mutate(id)
}
function handleToggleMonitor(m: AdminMonitor) {
  if (m.status === 'paused') {
    resumeMonitorMut.mutate(m.id)
  } else {
    pauseMonitorMut.mutate(m.id)
  }
}
function handleTestMonitor(id: number) {
  testingMonitorId.value = id
  monitorTestFeedback.value = null
  monitorTestError.value = null
  testMonitorMut.mutate(id)
}

// 通知渠道
const createChannelMut = useMutation({
  mutationFn: (data: CreateNotificationChannelInput) => createNotificationChannel(data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
      notification_channels: [...(old?.notification_channels ?? []), data.notification_channel].sort((a, b) => a.id - b.id),
    }))
    closeModal()
  },
})

const updateChannelMut = useMutation({
  mutationFn: ({ id, data }: { id: number; data: PatchNotificationChannelInput }) => updateNotificationChannel(id, data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
      notification_channels: (old?.notification_channels ?? []).map(ch => ch.id === data.notification_channel.id ? data.notification_channel : ch),
    }))
    closeModal()
  },
})

const deleteChannelMut = useMutation({
  mutationFn: deleteNotificationChannel,
  onSuccess: (_data, id) => {
    queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
      notification_channels: (old?.notification_channels ?? []).filter(ch => ch.id !== id),
    }))
  },
})

const testChannelMut = useMutation({
  mutationFn: testNotificationChannel,
  onSuccess: (data, channelId) => {
    channelTestFeedback.value = { at: Math.floor(Date.now() / 1000), channelId, eventKey: data.event_key, delivery: data.delivery }
    channelTestError.value = null
  },
  onError: (err, channelId) => {
    channelTestError.value = { channelId, at: Math.floor(Date.now() / 1000), message: formatError(err) ?? t('admin_dashboard.webhook_test_failed_default') }
    channelTestFeedback.value = null
  },
  onSettled: () => { testingChannelId.value = null },
})

function handleCreateChannel(data: CreateNotificationChannelInput) { createChannelMut.mutate(data) }
function handleUpdateChannel(data: PatchNotificationChannelInput) {
  if (editChannel.value) updateChannelMut.mutate({ id: editChannel.value.id, data })
}
function handleDeleteChannel(id: number) {
  const name = channelNameById.value.get(id) ?? `#${id}`
  if (confirm(t('common.confirm_delete_name', { name }))) deleteChannelMut.mutate(id)
}
function handleTestChannel(id: number) {
  testingChannelId.value = id
  channelTestFeedback.value = null
  channelTestError.value = null
  testChannelMut.mutate(id)
}

// 事件
const createIncidentMut = useMutation({
  mutationFn: (data: CreateIncidentInput) => createIncident(data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
      incidents: [data.incident, ...(old?.incidents ?? [])],
    }))
    closeModal()
  },
})

const addIncidentUpdateMut = useMutation({
  mutationFn: ({ id, data }: { id: number; data: CreateIncidentUpdateInput }) => addIncidentUpdate(id, data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
      incidents: (old?.incidents ?? []).map(it => it.id === data.incident.id ? data.incident : it),
    }))
    closeModal()
  },
})

const resolveIncidentMut = useMutation({
  mutationFn: ({ id, data }: { id: number; data: ResolveIncidentInput }) => resolveIncident(id, data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
      incidents: (old?.incidents ?? []).map(it => it.id === data.incident.id ? data.incident : it),
    }))
    closeModal()
  },
})

const deleteIncidentMut = useMutation({
  mutationFn: deleteIncident,
  onSuccess: (_data, id) => {
    queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
      incidents: (old?.incidents ?? []).filter(it => it.id !== id),
    }))
  },
})

function handleCreateIncident(data: CreateIncidentInput) { createIncidentMut.mutate(data) }
function handleAddIncidentUpdate(data: CreateIncidentUpdateInput) {
  if (editIncident.value) addIncidentUpdateMut.mutate({ id: editIncident.value.id, data })
}
function handleResolveIncident(data: ResolveIncidentInput) {
  if (editIncident.value) resolveIncidentMut.mutate({ id: editIncident.value.id, data })
}
function handleDeleteIncident(id: number) {
  const title = incidents.value.find(inc => inc.id === id)?.title ?? `#${id}`
  if (confirm(t('common.confirm_delete_name', { name: title }))) deleteIncidentMut.mutate(id)
}

// 维护窗口
const createMaintenanceMut = useMutation({
  mutationFn: (data: CreateMaintenanceWindowInput) => createMaintenanceWindow(data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
      maintenance_windows: [data.maintenance_window, ...(old?.maintenance_windows ?? [])],
    }))
    closeModal()
  },
})

const updateMaintenanceMut = useMutation({
  mutationFn: ({ id, data }: { id: number; data: PatchMaintenanceWindowInput }) => updateMaintenanceWindow(id, data),
  onSuccess: (data) => {
    queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
      maintenance_windows: (old?.maintenance_windows ?? []).map(w => w.id === data.maintenance_window.id ? data.maintenance_window : w),
    }))
    closeModal()
  },
})

const deleteMaintenanceMut = useMutation({
  mutationFn: deleteMaintenanceWindow,
  onSuccess: (_data, id) => {
    queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
      maintenance_windows: (old?.maintenance_windows ?? []).filter(w => w.id !== id),
    }))
  },
})

function handleCreateMaintenance(data: { title: string; starts_at: number; ends_at: number; monitor_ids: number[]; message?: string | null }) {
  const { message, ...rest } = data
  const input: CreateMaintenanceWindowInput = { ...rest, ...(message != null ? { message } : {}) }
  createMaintenanceMut.mutate(input)
}
function handleUpdateMaintenance(data: PatchMaintenanceWindowInput) {
  if (editMaintenance.value) updateMaintenanceMut.mutate({ id: editMaintenance.value.id, data })
}
function handleDeleteMaintenance(id: number) {
  const title = maintenanceWindows.value.find(w => w.id === id)?.title ?? `#${id}`
  if (confirm(t('common.confirm_delete_name', { name: title }))) deleteMaintenanceMut.mutate(id)
}
function handleCompleteMaintenanceInModal() {
  if (!editMaintenance.value) return
  const now = Math.floor(Date.now() / 1000)
  updateMaintenanceMut.mutate({ id: editMaintenance.value.id, data: { ends_at: now } })
}
</script>

<template>
  <div class="dashboard">
    <AppHeader
      maxWidth="92rem"
      :title="t('common.admin')"
      titleIsHeading
      :navLinks="adminNavLinks"
    >
      <template #after-title>
        <div class="dashboard__tabs">
          <button
            v-for="item in tabs"
            :key="item.key"
            :class="['dashboard__tab', tab === item.key && 'dashboard__tab--active']"
            @click="tab = item.key"
          >
            <svg class="dashboard__tab-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.icon" />
            </svg>
            <span class="dashboard__tab-label">{{ item.label }}</span>
          </button>
        </div>
      </template>
    </AppHeader>

    <main class="dashboard__main">
      <!-- ==================== 监控项标签页 ==================== -->
      <AdminTabLayout
        v-if="tab === 'monitors'"
        :loading="monitorsQuery.isLoading.value"
        :loading-text="t('common.loading')"
        :title="t('admin_dashboard.tab.monitors')"
      >
        <template #feedback>
          <div v-if="testingMonitorId !== null" class="dashboard__feedback dashboard__feedback--info">
            {{ t('admin_dashboard.monitor_test_running', { name: formatMonitorDisplayNameById(testingMonitorId, monitorNameById) }) }}
          </div>
          <div v-if="monitorTestFeedback" class="dashboard__feedback dashboard__feedback--neutral">
            <button class="dashboard__feedback-close" @click="monitorTestFeedback = null">&times;</button>
            <div class="dashboard__feedback-header">
              <span class="dashboard__feedback-title">
                {{ t('admin_dashboard.monitor_test_last', { name: formatMonitorDisplayName(monitorTestFeedback.monitor) }) }}
              </span>
              <div class="dashboard__feedback-meta">
                <UiBadge :variant="statusBadgeVariant(monitorTestFeedback.result.status as MonitorStatus)">
                  {{ statusLabel(monitorTestFeedback.result.status as MonitorStatus, t) }}
                </UiBadge>
                <span class="dashboard__feedback-time">{{ formatDateTime(monitorTestFeedback.at, timeZone, locale) }}</span>
              </div>
            </div>
            <div class="dashboard__feedback-body">
              <span class="dashboard__feedback-details">
                <span>{{ t('admin_dashboard.monitor_test_attempts', { value: monitorTestFeedback.result.attempts }) }}</span>
                <span>{{ t('admin_dashboard.monitor_test_http', { value: monitorTestFeedback.result.http_status ?? '-' }) }}</span>
                <span>{{ t('admin_dashboard.monitor_test_latency', { value: monitorTestFeedback.result.latency_ms !== null ? `${monitorTestFeedback.result.latency_ms}ms` : '-' }) }}</span>
              </span>
              <span :class="['dashboard__feedback-message', monitorTestFeedback.result.error ? 'dashboard__feedback-message--error' : 'dashboard__feedback-message--success']">
                {{ monitorTestFeedback.result.error ?? t('admin_dashboard.monitor_test_no_error') }}
              </span>
            </div>
          </div>
          <div v-if="monitorTestError" class="dashboard__feedback dashboard__feedback--error">
            <button class="dashboard__feedback-close" @click="monitorTestError = null">&times;</button>
            <div class="dashboard__feedback-title">
              {{ t('admin_dashboard.monitor_test_failed', { name: formatMonitorDisplayNameById(monitorTestError.monitorId, monitorNameById) }) }}
            </div>
            <div class="dashboard__feedback-time">{{ formatDateTime(monitorTestError.at, timeZone, locale) }}</div>
            <div class="dashboard__feedback-message">{{ monitorTestError.message }}</div>
          </div>
        </template>
        <template #actions>
          <UiButton variant="primary" @click="openModal({ type: 'create-monitor' })">
            {{ t('admin_dashboard.create_monitor') }}
          </UiButton>
        </template>

        <UiCard v-if="monitors.length === 0" class="dashboard__empty">
          {{ t('admin_dashboard.no_monitors_yet') }}
        </UiCard>

        <!-- 监控项表格 -->
        <div v-else class="dashboard__table-area">
          <DataTable min-width="860px">
            <thead>
              <tr>
                <th>{{ t('common.name') }}</th>
                <th class="data-table__th--hidden-lg">{{ t('admin_dashboard.monitor_table_monitor_order') }}</th>
                <th>{{ t('common.type') }}</th>
                <th>{{ t('common.target') }}</th>
                <th>{{ t('common.state') }}</th>
                <th>{{ t('admin_dashboard.monitor_table_last_check') }}</th>
                <th class="data-table__th--hidden-xl">{{ t('admin_dashboard.monitor_table_last_error') }}</th>
                <th class="data-table__th--actions">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(m, index) in sortedMonitors" :key="m.id">
                <!-- 分组标题行 -->
                <tr
                  v-if="monitorGroupLabel(m) !== (index > 0 ? monitorGroupLabel(sortedMonitors[index - 1]!) : null)"
                  class="dashboard__group-header-row"
                >
                  <td colspan="8" class="dashboard__group-header-cell">
                    <span>
                      {{ t('admin_dashboard.monitor_group_header', {
                        group: displayGroupLabel(monitorGroupLabel(m)),
                        count: monitorCountsByGroup.get(monitorGroupLabel(m)) ?? 0,
                        order: monitorGroupMetaByLabel.get(monitorGroupLabel(m))?.sortOrder ?? 0,
                      }) }}
                    </span>
                    <button
                      v-if="monitorGroupLabel(m) !== UNGROUPED_LABEL"
                      type="button"
                      class="dashboard__group-edit-btn"
                      @click="openModal({
                        type: 'edit-monitor-group',
                        groupLabel: monitorGroupLabel(m),
                        groupSortOrder: monitorGroupMetaByLabel.get(monitorGroupLabel(m))?.sortOrder ?? 0,
                        monitorCount: monitorCountsByGroup.get(monitorGroupLabel(m)) ?? 0,
                        monitorIds: monitors.filter(item => monitorGroupLabel(item) === monitorGroupLabel(m)).map(item => item.id),
                      })"
                    >
                      {{ t('common.edit') }}
                    </button>
                  </td>
                </tr>
                <!-- 监控行 -->
                <tr class="data-table__row">
                  <td class="data-table__td--name">
                    <div class="dashboard__name-cell">
                      <span class="dashboard__name-text">{{ m.name }}</span>
                      <span class="dashboard__name-id">#{{ m.id }}</span>
                      <UiBadge v-if="!m.show_on_status_page" variant="unknown" size="sm">
                        {{ t('admin_dashboard.monitor_visibility_hidden') }}
                      </UiBadge>
                    </div>
                  </td>
                  <td class="data-table__td--hidden-lg data-table__td--mono">{{ m.sort_order }}</td>
                  <td><UiBadge variant="info">{{ m.type }}</UiBadge></td>
                  <td class="data-table__td--target">{{ m.target }}</td>
                  <td>
                    <div class="dashboard__status-cell">
                      <UiBadge :variant="statusBadgeVariant(m.status)">{{ statusLabel(m.status, t) }}</UiBadge>
                      <UiBadge v-if="!m.is_active" variant="unknown">{{ t('common.inactive') }}</UiBadge>
                    </div>
                  </td>
                  <td class="data-table__td--nowrap">
                    <template v-if="m.last_checked_at">
                      {{ formatDateTime(m.last_checked_at, timeZone, locale) }}
                      <template v-if="m.last_latency_ms !== null"> ({{ m.last_latency_ms }}ms)</template>
                    </template>
                    <template v-else>-</template>
                  </td>
                  <td class="data-table__td--hidden-xl data-table__td--error" :title="m.last_error ?? undefined">
                    {{ m.last_error ?? '-' }}
                  </td>
                  <td class="data-table__td--actions">
                    <UiButton
                      variant="ghost"
                      size="xs"
                      :disabled="testMonitorMut.isPending.value"
                      @click="handleTestMonitor(m.id)"
                    >{{ testingMonitorId === m.id ? t('common.testing') : t('common.test') }}</UiButton>
                    <UiButton
                      variant="ghost"
                      size="xs"
                      :disabled="pauseMonitorMut.isPending.value || resumeMonitorMut.isPending.value || testingMonitorId === m.id"
                      @click="handleToggleMonitor(m)"
                    >{{ m.status === 'paused' ? t('common.resume') : t('common.pause') }}</UiButton>
                    <UiButton
                      variant="ghost"
                      size="xs"
                      @click="createMonitorMut.reset(); updateMonitorMut.reset(); editMonitor = m; openModal({ type: 'edit-monitor', monitor: m })"
                    >{{ t('common.edit') }}</UiButton>
                    <UiButton
                      variant="ghost"
                      size="xs"
                      @click="handleDeleteMonitor(m.id)"
                    >{{ t('common.delete') }}</UiButton>
                  </td>
                </tr>
              </template>
            </tbody>
          </DataTable>
        </div>
      </AdminTabLayout>

      <!-- ==================== 通知渠道标签页 ==================== -->
      <AdminTabLayout
        v-if="tab === 'notifications'"
        :loading="channelsQuery.isLoading.value"
        :loading-text="t('common.loading')"
        :title="t('admin_dashboard.notification_channels_title')"
      >
        <template #feedback>
          <div v-if="testingChannelId !== null" class="dashboard__feedback dashboard__feedback--info">
            {{ t('admin_dashboard.webhook_test_running', { name: channelNameById.get(testingChannelId) ?? `#${testingChannelId}` }) }}
          </div>
          <div v-if="channelTestFeedback" class="dashboard__feedback dashboard__feedback--neutral">
            <button class="dashboard__feedback-close" @click="channelTestFeedback = null">&times;</button>
            <div class="dashboard__feedback-header">
              <span class="dashboard__feedback-title">
                {{ t('admin_dashboard.webhook_test_last', { name: channelNameById.get(channelTestFeedback.channelId) ?? `#${channelTestFeedback.channelId}` }) }}
              </span>
              <div class="dashboard__feedback-meta">
                <UiBadge :variant="channelTestFeedback.delivery?.status === 'success' ? 'up' : channelTestFeedback.delivery?.status === 'failed' ? 'down' : 'unknown'">
                  {{ channelTestFeedback.delivery?.status === 'success' ? t('admin_dashboard.webhook_test_status_success') : channelTestFeedback.delivery?.status === 'failed' ? t('admin_dashboard.webhook_test_status_failed') : t('admin_dashboard.webhook_test_unknown') }}
                </UiBadge>
                <span class="dashboard__feedback-time">{{ formatDateTime(channelTestFeedback.at, timeZone, locale) }}</span>
              </div>
            </div>
            <div class="dashboard__feedback-body">
              <span class="dashboard__feedback-details">
                <span>{{ t('admin_dashboard.webhook_test_http', { value: channelTestFeedback.delivery?.http_status ?? '-' }) }}</span>
                <span class="dashboard__feedback-eventkey" :title="channelTestFeedback.eventKey">{{ t('admin_dashboard.webhook_test_event_key', { value: channelTestFeedback.eventKey }) }}</span>
              </span>
              <span :class="['dashboard__feedback-message', channelTestFeedback.delivery?.status === 'success' ? 'dashboard__feedback-message--success' : 'dashboard__feedback-message--error']">
                {{ channelTestFeedback.delivery?.error ?? (channelTestFeedback.delivery ? t('admin_dashboard.webhook_delivery_success') : t('admin_dashboard.webhook_delivery_missing')) }}
              </span>
            </div>
          </div>
          <div v-if="channelTestError" class="dashboard__feedback dashboard__feedback--error">
            <button class="dashboard__feedback-close" @click="channelTestError = null">&times;</button>
            <div class="dashboard__feedback-title">
              {{ t('admin_dashboard.webhook_test_failed', { name: channelNameById.get(channelTestError.channelId) ?? `#${channelTestError.channelId}` }) }}
            </div>
            <div class="dashboard__feedback-time">{{ formatDateTime(channelTestError.at, timeZone, locale) }}</div>
            <div class="dashboard__feedback-message">{{ channelTestError.message }}</div>
          </div>
        </template>
        <template #actions>
          <UiButton variant="primary" @click="openModal({ type: 'create-channel' })">
            {{ t('admin_dashboard.create_channel') }}
          </UiButton>
        </template>

        <UiCard v-if="channels.length === 0" class="dashboard__empty">
          {{ t('admin_dashboard.no_channels_yet') }}
        </UiCard>
        <DataTable v-else>
          <thead>
            <tr>
              <th>{{ t('common.name') }}</th>
              <th>{{ t('common.type') }}</th>
              <th>{{ t('common.target') }}</th>
              <th class="data-table__th--actions">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ch in channels" :key="ch.id" class="data-table__row">
              <td class="data-table__td--name">{{ ch.name }}</td>
              <td>
                <UiBadge variant="info">
                  {{ ch.type }}
                </UiBadge>
              </td>
              <td class="data-table__td--target">
                {{ ch.config_json?.url }}
              </td>
              <td class="data-table__td--actions">
                <UiButton
                  variant="ghost"
                  size="xs"
                  :disabled="testChannelMut.isPending.value"
                  @click="handleTestChannel(ch.id)"
                >{{ testingChannelId === ch.id ? t('common.testing') : t('common.test') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  @click="editChannel = ch; openModal({ type: 'edit-channel', channel: ch })"
                >{{ t('common.edit') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  @click="handleDeleteChannel(ch.id)"
                >{{ t('common.delete') }}</UiButton>
              </td>
            </tr>
          </tbody>
        </DataTable>
      </AdminTabLayout>

      <!-- ==================== 事件标签页 ==================== -->
      <AdminTabLayout
        v-if="tab === 'incidents'"
        :loading="incidentsQuery.isLoading.value"
        :loading-text="t('common.loading')"
        :title="t('admin_dashboard.tab.incidents')"
      >
        <template #actions>
          <UiButton variant="primary" @click="openModal({ type: 'create-incident' })">
            {{ t('admin_dashboard.create_incident') }}
          </UiButton>
        </template>

        <UiCard v-if="incidents.length === 0" class="dashboard__empty">
          {{ t('admin_dashboard.no_incidents_yet') }}
        </UiCard>
        <DataTable v-else>
          <thead>
            <tr>
              <th>{{ t('common.title_label') }}</th>
              <th>{{ t('common.monitors') }}</th>
              <th>{{ t('common.state') }}</th>
              <th>{{ t('common.impact') }}</th>
              <th class="data-table__th--actions">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inc in incidents" :key="inc.id" class="data-table__row">
              <td class="data-table__td--name">{{ inc.title }}</td>
              <td class="data-table__td--target">
                {{ inc.monitor_ids.map(id => formatMonitorDisplayNameById(id, monitorNameById)).join(', ') }}
              </td>
              <td>
                <UiBadge :variant="inc.status === 'resolved' ? 'up' : 'paused'">
                  {{ inc.status === 'resolved' ? t('incident_status.resolved') : incidentStatusLabel(inc.status, t) }}
                </UiBadge>
              </td>
              <td>
                <UiBadge :variant="inc.impact === 'critical' || inc.impact === 'major' ? 'down' : 'paused'">
                  {{ incidentImpactLabel(inc.impact, t) }}
                </UiBadge>
              </td>
              <td class="data-table__td--actions">
                <UiButton
                  variant="ghost"
                  size="xs"
                  :disabled="inc.status === 'resolved'"
                  @click="editIncident = inc; openModal({ type: 'add-incident-update', incident: inc })"
                >{{ t('common.update') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  :disabled="inc.status === 'resolved'"
                  @click="editIncident = inc; openModal({ type: 'resolve-incident', incident: inc })"
                >{{ t('resolve_incident.resolve') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  @click="handleDeleteIncident(inc.id)"
                >{{ t('common.delete') }}</UiButton>
              </td>
            </tr>
          </tbody>
        </DataTable>
      </AdminTabLayout>

      <!-- ==================== 维护窗口标签页 ==================== -->
      <AdminTabLayout
        v-if="tab === 'maintenance'"
        :loading="maintenanceQuery.isLoading.value"
        :loading-text="t('common.loading')"
        :title="t('admin_dashboard.maintenance_windows_title')"
      >
        <template #actions>
          <UiButton variant="primary" @click="openModal({ type: 'create-maintenance' })">
            {{ t('admin_dashboard.create_maintenance') }}
          </UiButton>
        </template>

        <UiCard v-if="maintenanceWindows.length === 0" class="dashboard__empty">
          {{ t('admin_dashboard.no_maintenance_yet') }}
        </UiCard>
        <DataTable v-else>
          <thead>
            <tr>
              <th>{{ t('common.title_label') }}</th>
              <th>{{ t('common.monitors') }}</th>
              <th>{{ t('common.schedule') }}</th>
              <th>{{ t('common.state') }}</th>
              <th class="data-table__th--actions">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in maintenanceWindows" :key="w.id" class="data-table__row">
              <td class="data-table__td--name">{{ w.title }}</td>
              <td class="data-table__td--target">
                {{ w.monitor_ids.map(id => formatMonitorDisplayNameById(id, monitorNameById)).join(', ') }}
              </td>
              <td class="data-table__td--nowrap">
                {{ formatDateTime(w.starts_at, timeZone, locale) }} &ndash; {{ formatDateTime(w.ends_at, timeZone, locale) }}
              </td>
              <td>
                <UiBadge :variant="maintenanceState(w).variant">{{ maintenanceState(w).label }}</UiBadge>
              </td>
              <td class="data-table__td--actions">
                <UiButton
                  variant="ghost"
                  size="xs"
                  :disabled="maintenanceState(w).variant !== 'maintenance'"
                  @click="editMaintenance = w; openModal({ type: 'complete-maintenance', window: w })"
                >{{ t('common.complete') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  @click="editMaintenance = w; openModal({ type: 'edit-maintenance', window: w })"
                >{{ t('common.edit') }}</UiButton>
                <UiButton
                  variant="ghost"
                  size="xs"
                  @click="handleDeleteMaintenance(w.id)"
                >{{ t('common.delete') }}</UiButton>
              </td>
            </tr>
          </tbody>
        </DataTable>
      </AdminTabLayout>

      <!-- ==================== 设置标签页 ==================== -->
      <AdminTabLayout
        v-if="tab === 'settings'"
        :loading="settingsQuery.isLoading.value"
        :loading-text="t('common.loading')"
        :title="t('admin_dashboard.tab.settings')"
      >
        <template #actions>
          <UiButton
            variant="primary"
            :disabled="!hasUnsavedSettings || patchSettingsMut.isPending.value"
            @click="saveSettings"
          >
            {{ patchSettingsMut.isPending.value ? t('common.saving') : t('common.save') }}
          </UiButton>
        </template>
        <template v-if="settingsDraft">


          <!-- Branding -->
          <UiCard class="dashboard__settings-card">
            <div class="dashboard__settings-block">
              <div>
                <div class="dashboard__settings-label">{{ t('admin_settings.branding.title') }}</div>
                <div class="dashboard__settings-help">{{ t('admin_settings.branding.help') }}</div>
              </div>
              <div class="dashboard__settings-field">
                <label class="dashboard__settings-field-label">{{ t('admin_settings.branding.site_title') }}</label>
                <input
                  :value="settingsDraft.site_title"
                  class="dashboard__input"
                  :disabled="settingsQuery.isLoading.value"
                  @input="updateSettingsDraft('site_title', ($event.target as HTMLInputElement).value.slice(0, 100))"
                  @blur="sanitizeAndApplyDraft('site_title', sanitizeSiteTitle(($event.target as HTMLInputElement).value))"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
              <div class="dashboard__settings-field">
                <label class="dashboard__settings-field-label">{{ t('admin_settings.branding.site_description') }}</label>
                <textarea
                  :value="settingsDraft.site_description"
                  rows="3"
                  class="dashboard__textarea"
                  :disabled="settingsQuery.isLoading.value"
                  @input="updateSettingsDraft('site_description', ($event.target as HTMLTextAreaElement).value.slice(0, 500))"
                  @blur="sanitizeAndApplyDraft('site_description', sanitizeSiteDescription(($event.target as HTMLTextAreaElement).value))"
                />
              </div>
            </div>
          </UiCard>

          <!-- Navigation Links -->
          <UiCard class="dashboard__settings-card">
            <div class="dashboard__settings-block">
              <div>
                <div class="dashboard__settings-label">{{ t('admin_settings.nav_links.title') }}</div>
                <div class="dashboard__settings-help">{{ t('admin_settings.nav_links.help') }}</div>
              </div>
              <div class="dashboard__nav-links-list">
                <div
                  v-for="index in 3"
                  :key="index"
                  class="dashboard__nav-link-row"
                >
                  <input
                    :value="getNavLink(index - 1)?.label ?? ''"
                    class="dashboard__input"
                    :placeholder="t('admin_settings.nav_links.label_placeholder')"
                    maxlength="20"
                    :disabled="settingsQuery.isLoading.value"
                    @blur="onNavLinkBlur(index - 1, 'label', ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                  <input
                    :value="getNavLink(index - 1)?.url ?? ''"
                    class="dashboard__input dashboard__input--flex"
                    :placeholder="t('admin_settings.nav_links.url_placeholder')"
                    :disabled="settingsQuery.isLoading.value"
                    @blur="onNavLinkBlur(index - 1, 'url', ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
              </div>
            </div>
          </UiCard>

          <!-- Retention -->
          <UiCard class="dashboard__settings-card">
            <div class="dashboard__settings-row">
              <div>
                <div class="dashboard__settings-label">{{ t('admin_settings.retention.title') }}</div>
                <div class="dashboard__settings-help">{{ t('admin_settings.retention.help') }}</div>
              </div>
              <input
                type="number"
                :value="settingsDraft.retention_check_results_days ?? 7"
                min="1"
                max="365"
                class="dashboard__input dashboard__input--sm"
                :disabled="settingsQuery.isLoading.value"
                @input="updateSettingsDraft('retention_check_results_days', Number(($event.target as HTMLInputElement).value))"
                @blur="sanitizeAndApplyDraft('retention_check_results_days', clampInt(Number(($event.target as HTMLInputElement).value), 1, 365))"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
            </div>
          </UiCard>

          <!-- State Machine -->
          <UiCard class="dashboard__settings-card">
            <div class="dashboard__settings-block">
              <div>
                <div class="dashboard__settings-label">{{ t('admin_settings.state_machine.title') }}</div>
                <div class="dashboard__settings-help">{{ t('admin_settings.state_machine.help') }}</div>
              </div>
              <div class="dashboard__settings-grid">
                <div class="dashboard__settings-field">
                  <label class="dashboard__settings-field-label">{{ t('admin_settings.state_machine.failures_to_down') }}</label>
                  <input
                    type="number"
                    :value="settingsDraft.state_failures_to_down_from_up ?? 2"
                    min="1"
                    max="10"
                    class="dashboard__input"
                    :disabled="settingsQuery.isLoading.value"
                    @input="updateSettingsDraft('state_failures_to_down_from_up', Number(($event.target as HTMLInputElement).value))"
                    @blur="sanitizeAndApplyDraft('state_failures_to_down_from_up', clampInt(Number(($event.target as HTMLInputElement).value), 1, 10))"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
                <div class="dashboard__settings-field">
                  <label class="dashboard__settings-field-label">{{ t('admin_settings.state_machine.successes_to_up') }}</label>
                  <input
                    type="number"
                    :value="settingsDraft.state_successes_to_up_from_down ?? 2"
                    min="1"
                    max="10"
                    class="dashboard__input"
                    :disabled="settingsQuery.isLoading.value"
                    @input="updateSettingsDraft('state_successes_to_up_from_down', Number(($event.target as HTMLInputElement).value))"
                    @blur="sanitizeAndApplyDraft('state_successes_to_up_from_down', clampInt(Number(($event.target as HTMLInputElement).value), 1, 10))"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
              </div>
            </div>
          </UiCard>

          <!-- Defaults -->
          <UiCard class="dashboard__settings-card">
            <div class="dashboard__settings-block">
              <div>
                <div class="dashboard__settings-label">{{ t('admin_settings.defaults.title') }}</div>
                <div class="dashboard__settings-help">{{ t('admin_settings.defaults.help') }}</div>
              </div>
              <div class="dashboard__settings-grid">
                <div class="dashboard__settings-field">
                  <label class="dashboard__settings-field-label">{{ t('admin_settings.defaults.overview_range') }}</label>
                  <select
                    :value="settingsDraft.admin_default_overview_range ?? '24h'"
                    :disabled="settingsQuery.isLoading.value"
                    class="dashboard__select"
                    @change="updateSettingsDraft('admin_default_overview_range', ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="24h">{{ t('admin_settings.range_24h') }}</option>
                    <option value="7d">{{ t('admin_settings.range_7d') }}</option>
                  </select>
                </div>
                <div class="dashboard__settings-field">
                  <label class="dashboard__settings-field-label">{{ t('admin_settings.defaults.monitor_range') }}</label>
                  <select
                    :value="settingsDraft.admin_default_monitor_range ?? '24h'"
                    :disabled="settingsQuery.isLoading.value"
                    class="dashboard__select"
                    @change="updateSettingsDraft('admin_default_monitor_range', ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="24h">{{ t('admin_settings.range_24h') }}</option>
                    <option value="7d">{{ t('admin_settings.range_7d') }}</option>
                    <option value="30d">{{ t('admin_settings.range_30d') }}</option>
                    <option value="90d">{{ t('admin_settings.range_90d') }}</option>
                  </select>
                </div>
              </div>
            </div>
          </UiCard>
        </template>
      </AdminTabLayout>
    </main>

    <!-- 模态框 -->
    <DetailModal v-if="modalTitle" :title="modalTitle" @close="closeModal">
      <MonitorForm
        v-if="modal.type === 'create-monitor'"
        :is-loading="createMonitorMut.isPending.value"
        :error="formatError(createMonitorMut.error.value)"
        @submit="handleCreateMonitor"
        @cancel="closeModal"
      />
      <MonitorForm
        v-if="modal.type === 'edit-monitor' && editMonitor"
        :monitor="editMonitor"
        :is-loading="updateMonitorMut.isPending.value"
        :error="formatError(updateMonitorMut.error.value)"
        @submit="handleUpdateMonitor"
        @cancel="closeModal"
      />
      <MonitorGroupForm
        v-if="editingMonitorGroupModal"
        :group-name="editingMonitorGroupModal.groupLabel"
        :group-sort-order="editingMonitorGroupModal.groupSortOrder"
        :monitor-count="editingMonitorGroupModal.monitorCount"
        :is-loading="assignMonitorGroupMut.isPending.value"
        :error="formatError(assignMonitorGroupMut.error.value)"
        @submit="handleAssignMonitorGroup"
        @cancel="closeModal"
      />
      <IncidentForm
        v-if="modal.type === 'create-incident'"
        :monitors="monitorsForForm"
        :is-loading="createIncidentMut.isPending.value"
        @submit="handleCreateIncident"
        @cancel="closeModal"
      />
      <IncidentUpdateForm
        v-if="modal.type === 'add-incident-update' && editIncident"
        :is-loading="addIncidentUpdateMut.isPending.value"
        @submit="handleAddIncidentUpdate"
        @cancel="closeModal"
      />
      <ResolveIncidentForm
        v-if="modal.type === 'resolve-incident' && editIncident"
        :is-loading="resolveIncidentMut.isPending.value"
        @submit="handleResolveIncident"
        @cancel="closeModal"
      />
      <MaintenanceWindowForm
        v-if="modal.type === 'create-maintenance'"
        :monitors="monitorsForForm"
        :is-loading="createMaintenanceMut.isPending.value"
        @submit="handleCreateMaintenance"
        @cancel="closeModal"
      />
      <MaintenanceWindowForm
        v-if="modal.type === 'edit-maintenance' && editMaintenance"
        :maintenance="editMaintenance"
        :monitors="monitorsForForm"
        :is-loading="updateMaintenanceMut.isPending.value"
        @submit="handleUpdateMaintenance"
        @cancel="closeModal"
      />
      <CompleteMaintenanceForm
        v-if="modal.type === 'complete-maintenance'"
        :is-loading="updateMaintenanceMut.isPending.value"
        @submit="handleCompleteMaintenanceInModal"
        @cancel="closeModal"
      />
      <NotificationChannelForm
        v-if="modal.type === 'create-channel'"
        :is-loading="createChannelMut.isPending.value"
        :error="formatError(createChannelMut.error.value)"
        @submit="handleCreateChannel"
        @cancel="closeModal"
      />
      <NotificationChannelForm
        v-if="modal.type === 'edit-channel' && editChannel"
        :channel="editChannel"
        :is-loading="updateChannelMut.isPending.value"
        :error="formatError(updateChannelMut.error.value)"
        @submit="handleUpdateChannel"
        @cancel="closeModal"
      />
    </DetailModal>
  </div>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.dashboard {
  min-height: 100vh;
  background-color: var(--color-bg);
}

// ─── Pill 标签栏 ───
.dashboard__tabs {
  display: flex;
  gap: 0.125rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg);
  padding: 0.125rem;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 1;
  min-width: 0;

  &::-webkit-scrollbar {
    display: none;
  }
}

.dashboard__tab {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text-muted);
  border: none;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;

  @media (min-width: 640px) {
    padding: 0.375rem 0.75rem;
    gap: 0.375rem;
  }

  &--active {
    background-color: var(--color-text-primary);
    color: var(--color-bg);
    box-shadow: var(--shadow-card);
  }

  &:hover:not(&--active) {
    color: var(--color-text-primary);
  }
}

.dashboard__tab-icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.dashboard__tab-label {
  display: none;
  @media (min-width: 768px) {
    display: inline;
  }
}

// ─── 主内容 ───
.dashboard__main {
  max-width: 92rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;

  @media (min-width: 640px) {
    padding: 1.5rem;
  }
}

// ─── 监控表格容器 ───
.dashboard__table-area {
  min-width: 0;
}

// ─── 反馈卡片 ───
.dashboard__feedback {
  position: relative;
  padding: 0.75rem 2rem 0.75rem 0.75rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  margin-bottom: 1rem;
  font-size: 0.875rem;

  &--info {
    background: rgba(59, 130, 246, 0.07);
    border-color: rgba(59, 130, 246, 0.3);
    color: var(--color-text-secondary);
  }

  &--neutral {
    background: var(--color-card);
    border-color: var(--color-border);
  }

  &--error {
    background: rgba(239, 68, 68, 0.07);
    border-color: rgba(239, 68, 68, 0.3);
    color: var(--color-danger);
  }
}

.dashboard__feedback-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--color-border);
    color: var(--color-text-primary);
  }
}

.dashboard__feedback-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.dashboard__feedback-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.dashboard__feedback-title {
  font-weight: 500;
  color: var(--color-text-primary);
}

.dashboard__feedback-time {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.dashboard__feedback-body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-top: 0.375rem;
}

.dashboard__feedback-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.dashboard__feedback-eventkey {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.dashboard__feedback-message {
  font-size: 0.875rem;

  &--success {
    color: var(--color-up);
  }
  &--error {
    color: var(--color-danger);
  }
}

// ─── 表格 ───

.dashboard__name-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.dashboard__name-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard__name-id {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--color-text-muted);
}

.dashboard__status-cell {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.dashboard__group-header-row {
  background-color: var(--color-bg);
}

.dashboard__group-header-cell {
  text-align: left!important;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  padding: 0.5rem 0.75rem;
}

.dashboard__group-edit-btn {
  margin-left: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.125rem 0.5rem;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--color-card);
    color: var(--color-text-primary);
    border-color: var(--color-text-muted);
  }
}

.dashboard__actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}

// ─── 空状态 ───
.dashboard__empty {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-muted);
}

.dashboard__select {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;

  &:focus {
    outline: none;
    border-color: var(--color-accent, #3b82f6);
  }

  &--wide {
    width: 100%;
    @media (min-width: 640px) {
      width: 21rem;
    }
  }
}

.dashboard__input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  transition: border-color 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--color-accent, #3b82f6);
  }

  &--sm {
    width: 100%;
    @media (min-width: 640px) {
      width: 10rem;
    }
  }
}

.dashboard__textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  resize: vertical;
  transition: border-color 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--color-accent, #3b82f6);
  }
}

// ─── 设置页面 ───
.dashboard__settings-card {
  padding: 1rem;
  margin-bottom: 1rem;

  @media (min-width: 640px) {
    padding: 1.25rem;
  }
}

.dashboard__settings-row {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  @media (min-width: 640px) {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.dashboard__settings-block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dashboard__settings-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.dashboard__settings-help {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.dashboard__settings-grid {
  display: grid;
  gap: 0.75rem;

  @media (min-width: 640px) {
    grid-template-columns: 1fr 1fr;
  }
}

.dashboard__settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.dashboard__settings-field-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.dashboard__settings-hint {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.dashboard__settings-error {
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-danger);
}

.dashboard__settings-warn {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-paused);
}

.dashboard__nav-links-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dashboard__nav-link-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;

  .dashboard__input:first-child {
    flex: 0 0 140px;
  }

  .dashboard__input--flex {
    flex: 1;
  }
}

// ─── 模态框 ───
</style>
