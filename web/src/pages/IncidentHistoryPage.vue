<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useI18nStore } from '../stores/i18n'
import { fetchPublicIncidents, fetchStatus } from '../api/client'
import type { Incident } from '../api/types'
import AppHeader from '../components/ui/AppHeader.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import IncidentDetailModal from '../components/IncidentDetailModal.vue'
import UiButton from '../components/ui/UiButton.vue'
import { incidentImpactLabel, incidentStatusLabel } from '../i18n/labels'
import { formatDateTime, getBrowserTimeZone } from '../utils/datetime'

const i18n = useI18nStore()
const { locale, t } = i18n

document.title = t('status_page.incident_history')

const cursor = ref<number | undefined>(undefined)
const all = ref<Incident[]>([])
const nextCursor = ref<number | null>(null)
const selectedIncident = ref<Incident | null>(null)
const isLoadingMore = ref(false)

const statusQuery = useQuery({
  queryKey: ['status'],
  queryFn: fetchStatus,
  staleTime: 60_000,
})

const timeZone = computed(() => getBrowserTimeZone() || 'UTC')

const monitorNames = computed(() => {
  const monitors = statusQuery.data.value?.monitors ?? []
  return new Map(monitors.map(m => [m.id, m.name] as const))
})

const incidentsQuery = useQuery({
  queryKey: ['public-incidents', 'resolved', cursor],
  queryFn: () => fetchPublicIncidents(20, cursor.value, { resolvedOnly: true }),
})

const isError = computed(() => incidentsQuery.isError.value)
const errorMessage = computed(() => {
  const err = incidentsQuery.error.value as { error?: { message?: string } } | null
  if (!err) return ''
  return err?.error?.message ?? String(err)
})

const isInitialLoading = computed(() => incidentsQuery.isLoading.value && all.value.length === 0)

watch(
  () => incidentsQuery.data.value,
  (page) => {
    if (!page) return
    const existingIds = new Set(all.value.map(i => i.id))
    const newIncidents = page.incidents.filter(i => !existingIds.has(i.id))
    all.value = [...all.value, ...newIncidents]
    nextCursor.value = page.next_cursor
    isLoadingMore.value = false
  },
  { immediate: true },
)

function loadMore() {
  if (nextCursor.value === null || isLoadingMore.value) return
  isLoadingMore.value = true
  cursor.value = nextCursor.value
}
</script>

<template>
  <div class="incidents">
    <AppHeader backTo="/" :title="t('status_page.incident_history')" />

    <main class="incidents__main">
      <template v-if="isInitialLoading">
        <UiCard v-for="i in 3" :key="i" class="incidents__skeleton">
          <div class="ui-skeleton" style="height: 1.25rem; width: 12rem; border-radius: 0.25rem; margin-bottom: 0.5rem;" />
          <div class="ui-skeleton" style="height: 0.875rem; width: 8rem; border-radius: 0.25rem; margin-bottom: 0.75rem;" />
          <div class="ui-skeleton" style="height: 0.875rem; width: 100%; border-radius: 0.25rem;" />
        </UiCard>
      </template>

      <UiCard v-else-if="isError" class="incidents__empty-card">
        <p>{{ errorMessage }}</p>
      </UiCard>

      <template v-else-if="all.length > 0">
        <UiCard
          v-for="incident in all"
          :key="incident.id"
          hover
          class="incidents__card"
          :onClick="() => selectedIncident = incident"
        >
          <div class="incidents__card-header">
            <h4 class="incidents__card-title">{{ incident.title }}</h4>
            <UiBadge :variant="incident.impact === 'critical' || incident.impact === 'major' ? 'down' : 'paused'">
              {{ incidentImpactLabel(incident.impact, t) }}
            </UiBadge>
          </div>
          <div class="incidents__card-meta">
            <UiBadge variant="info">{{ incidentStatusLabel(incident.status, t) }}</UiBadge>
            <span>{{ formatDateTime(incident.started_at, timeZone, locale) }}</span>
          </div>
          <p v-if="incident.message" class="incidents__card-message">{{ incident.message }}</p>
        </UiCard>

        <UiButton
          v-if="nextCursor !== null"
          variant="secondary"
          size="sm"
          :disabled="isLoadingMore"
          style="align-self: center; margin-top: 0.5rem;"
          @click="loadMore"
        >
          {{ isLoadingMore ? t('common.loading') : t('common.load_more') }}
        </UiButton>
      </template>

      <UiCard v-else class="incidents__empty-card">
        <p>{{ t('status_page.no_past_incidents') }}</p>
      </UiCard>
    </main>

    <IncidentDetailModal
      v-if="selectedIncident"
      :incident="selectedIncident"
      :monitor-names="monitorNames"
      :time-zone="timeZone"
      :is-loading-details="false"
      :has-details-error="false"
      @close="selectedIncident = null"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.incidents {
  min-height: 100vh;
  background-color: var(--color-bg);
}

.incidents__main {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  @media (min-width: 640px) {
    padding: 2rem 1.5rem;
  }
}

.incidents__skeleton {
  padding: 1.25rem;
}

.incidents__empty-card {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.incidents__card {
  width: 100%;
  text-align: left;
  padding: 0.875rem;

  @media (min-width: 640px) {
    padding: 1.25rem;
  }
}

.incidents__card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.incidents__card-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.incidents__card-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 0.75rem;
}

.incidents__card-message {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
