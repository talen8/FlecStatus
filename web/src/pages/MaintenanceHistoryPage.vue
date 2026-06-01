<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useI18nStore } from '../stores/i18n'
import { fetchPublicMaintenanceWindows, fetchStatus } from '../api/client'
import type { MaintenanceWindow } from '../api/types'
import AppHeader from '../components/ui/AppHeader.vue'
import UiCard from '../components/ui/UiCard.vue'
import MaintenanceDetailModal from '../components/MaintenanceDetailModal.vue'
import UiButton from '../components/ui/UiButton.vue'
import { formatDateTime, getBrowserTimeZone } from '../utils/datetime'

const i18n = useI18nStore()
const { locale, t } = i18n

document.title = t('status_page.maintenance_history')

const cursor = ref<number | undefined>(undefined)
const all = ref<MaintenanceWindow[]>([])
const nextCursor = ref<number | null>(null)
const selectedMaintenance = ref<MaintenanceWindow | null>(null)
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

const maintenanceQuery = useQuery({
  queryKey: ['public-maintenance-windows', 'history', cursor],
  queryFn: () => fetchPublicMaintenanceWindows(20, cursor.value),
})

const isError = computed(() => maintenanceQuery.isError.value)
const errorMessage = computed(() => {
  const err = maintenanceQuery.error.value as { error?: { message?: string } } | null
  if (!err) return ''
  return err?.error?.message ?? String(err)
})

const isInitialLoading = computed(() => maintenanceQuery.isLoading.value && all.value.length === 0)

watch(
  () => maintenanceQuery.data.value,
  (page) => {
    if (!page) return
    const existingIds = new Set(all.value.map(w => w.id))
    const newWindows = page.maintenance_windows.filter(w => !existingIds.has(w.id))
    all.value = [...all.value, ...newWindows]
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
  <div class="maintenance">
    <AppHeader backTo="/" :title="t('status_page.maintenance_history')" />

    <main class="maintenance__main">
      <template v-if="isInitialLoading">
        <UiCard v-for="i in 3" :key="i" class="maintenance__skeleton">
          <div class="ui-skeleton" style="height: 1.25rem; width: 12rem; border-radius: 0.25rem; margin-bottom: 0.5rem;" />
          <div class="ui-skeleton" style="height: 0.875rem; width: 8rem; border-radius: 0.25rem; margin-bottom: 0.75rem;" />
          <div class="ui-skeleton" style="height: 0.875rem; width: 100%; border-radius: 0.25rem;" />
        </UiCard>
      </template>

      <UiCard v-else-if="isError" class="maintenance__empty-card">
        <p>{{ errorMessage }}</p>
      </UiCard>

      <template v-else-if="all.length > 0">
        <UiCard
          v-for="w in all"
          :key="w.id"
          hover
          class="maintenance__card"
          :onClick="() => selectedMaintenance = w"
        >
          <div class="maintenance__card-header">
            <h4 class="maintenance__card-title">{{ w.title }}</h4>
            <span class="maintenance__card-time">
              {{ formatDateTime(w.starts_at, timeZone, locale) }} – {{ formatDateTime(w.ends_at, timeZone, locale) }}
            </span>
          </div>
          <div class="maintenance__card-affected">
            {{ t('common.affected') }}: {{ w.monitor_ids.map(id => monitorNames.get(id) ?? `#${id}`).join(', ') }}
          </div>
          <p v-if="w.message" class="maintenance__card-message">{{ w.message }}</p>
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

      <UiCard v-else class="maintenance__empty-card">
        <p>{{ t('status_page.no_past_maintenance') }}</p>
      </UiCard>
    </main>

    <MaintenanceDetailModal
      v-if="selectedMaintenance"
      :maintenance="selectedMaintenance"
      :monitor-names="monitorNames"
      :time-zone="timeZone"
      @close="selectedMaintenance = null"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../styles/mixins' as *;

.maintenance {
  min-height: 100vh;
  background-color: var(--color-bg);
}

.maintenance__main {
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

.maintenance__skeleton {
  padding: 1.25rem;
}

.maintenance__empty-card {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.maintenance__card {
  width: 100%;
  text-align: left;
  padding: 0.875rem;

  @media (min-width: 640px) {
    padding: 1.25rem;
  }
}

.maintenance__card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.maintenance__card-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.maintenance__card-time {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.maintenance__card-affected {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.maintenance__card-message {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
