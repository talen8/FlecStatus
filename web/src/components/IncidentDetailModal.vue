<script setup lang="ts">
import { computed } from 'vue'
import type { Incident, IncidentSummary } from '../api/types'
import { useI18nStore } from '../stores/i18n'
import { incidentImpactLabel, incidentStatusLabel } from '../i18n/labels'
import { formatDateTime } from '../utils/datetime'
import DetailModal from './ui/DetailModal.vue'
import type { DetailBadge, DetailMetaItem } from './ui/DetailModal.vue'
import UiBadge from './ui/UiBadge.vue'

type IncidentCardData = IncidentSummary | Incident

const props = defineProps<{
  incident: IncidentCardData
  monitorNames: Map<number, string>
  timeZone: string
  isLoadingDetails: boolean
  hasDetailsError: boolean
}>()

defineEmits<{
  close: []
}>()

const i18n = useI18nStore()
const { locale, t } = i18n

const badges = computed((): DetailBadge[] => [
  {
    text: incidentImpactLabel(props.incident.impact, t),
    variant: props.incident.impact === 'critical' || props.incident.impact === 'major' ? 'down' : 'paused',
  },
  {
    text: incidentStatusLabel(props.incident.status, t),
    variant: 'info',
  },
])

const meta = computed((): DetailMetaItem[] => {
  const items: DetailMetaItem[] = []

  const ids = 'monitor_ids' in props.incident ? props.incident.monitor_ids : undefined
  if (ids && ids.length > 0) {
    items.push({ label: t('common.affected'), value: ids.map(id => props.monitorNames.get(id) ?? `#${id}`).join(', ') })
  } else if (props.isLoadingDetails) {
    items.push({ label: t('common.affected'), value: t('common.loading') })
  } else if (props.hasDetailsError) {
    items.push({ label: t('common.affected'), value: t('status_page.failed_load_data') })
  }

  items.push({ label: t('common.started'), value: formatDateTime(props.incident.started_at, props.timeZone, locale) })

  if (props.incident.resolved_at) {
    items.push({ label: t('common.resolved'), value: formatDateTime(props.incident.resolved_at, props.timeZone, locale) })
  }

  return items
})
</script>

<template>
  <DetailModal
    :title="incident.title"
    :badges="badges"
    :meta="meta"
    @close="$emit('close')"
  >
    <div v-if="incident.message" class="incident-detail__report">
      <div class="incident-detail__report-label">{{ t('status_page.initial_report') }}</div>
      <div class="incident-detail__text">{{ incident.message }}</div>
    </div>

    <template v-if="'updates' in incident">
      <div v-for="update in incident.updates" :key="update.id" class="incident-detail__update">
        <div class="incident-detail__update-header">
          <UiBadge v-if="update.status" variant="info">
            {{ incidentStatusLabel(update.status, t) }}
          </UiBadge>
          <span class="incident-detail__update-time">
            {{ formatDateTime(update.created_at, timeZone, locale) }}
          </span>
        </div>
        <div class="incident-detail__text">{{ update.message }}</div>
      </div>

      <div v-if="incident.updates.length === 0 && isLoadingDetails" class="incident-detail__status-msg">
        {{ t('common.loading') }}
      </div>

      <div v-if="incident.updates.length === 0 && hasDetailsError" class="incident-detail__status-msg incident-detail__status-msg--error">
        {{ t('status_page.failed_load_data') }}
      </div>
    </template>
  </DetailModal>
</template>

<style scoped lang="scss">
.incident-detail__report {
  background-color: var(--color-bg);
  border-radius: 0.5rem;
  padding: 1rem;
}

.incident-detail__report-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.incident-detail__update {
  border-left: 2px solid var(--color-border);
  padding-left: 1rem;
}

.incident-detail__update-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.incident-detail__update-time {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.incident-detail__status-msg {
  font-size: 0.875rem;
  color: var(--color-text-muted);

  &--error {
    color: var(--color-danger);
  }
}

.incident-detail__text {
  white-space: pre-wrap;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
}
</style>
