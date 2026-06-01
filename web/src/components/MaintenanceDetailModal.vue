<script setup lang="ts">
import { computed } from 'vue'
import type { MaintenanceWindow, MaintenanceWindowPreview } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { formatDateTime } from '../utils/datetime'
import DetailModal from './ui/DetailModal.vue'
import type { DetailBadge, DetailMetaItem } from './ui/DetailModal.vue'

type MaintenanceData = MaintenanceWindow | MaintenanceWindowPreview

const props = defineProps<{
  maintenance: MaintenanceData
  monitorNames: Map<number, string>
  timeZone: string
}>()

defineEmits<{
  close: []
}>()

const i18n = useI18nStore()
const { locale, t } = i18n

const badges = computed((): DetailBadge[] => {
  const now = Math.floor(Date.now() / 1000)
  let statusText: string
  if (now < props.maintenance.starts_at) statusText = t('common.upcoming')
  else if (now < props.maintenance.ends_at) statusText = t('common.active')
  else statusText = t('common.completed')

  return [{ text: statusText, variant: 'maintenance' }]
})

const meta = computed((): DetailMetaItem[] => {
  const items: DetailMetaItem[] = []

  const ids = props.maintenance.monitor_ids
  if (ids && ids.length > 0) {
    items.push({ label: t('common.affected'), value: ids.map(id => props.monitorNames.get(id) ?? `#${id}`).join(', ') })
  }

  items.push({ label: t('common.started'), value: formatDateTime(props.maintenance.starts_at, props.timeZone, locale) })
  items.push({ label: t('common.ends'), value: formatDateTime(props.maintenance.ends_at, props.timeZone, locale) })

  return items
})
</script>

<template>
  <DetailModal
    :title="maintenance.title"
    :badges="badges"
    :meta="meta"
    @close="$emit('close')"
  >
    <div v-if="maintenance.message" class="maintenance-detail__report">
      <div class="maintenance-detail__report-label">{{ t('status_page.description') }}</div>
      <div class="maintenance-detail__text">{{ maintenance.message }}</div>
    </div>
  </DetailModal>
</template>

<style scoped lang="scss">
.maintenance-detail__report {
  background-color: var(--color-bg);
  border-radius: 0.5rem;
  padding: 1rem;
}

.maintenance-detail__report-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.maintenance-detail__text {
  white-space: pre-wrap;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
}
</style>
