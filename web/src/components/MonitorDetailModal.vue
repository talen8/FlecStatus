<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { fetchLatency } from '../api/client'
import { useI18nStore } from '../stores/i18n'
import DetailModal from './ui/DetailModal.vue'
import LatencyChart from './LatencyChart.vue'

const props = defineProps<{
  monitorId: number
}>()

defineEmits<{
  close: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const { data, isLoading } = useQuery({
  queryKey: ['latency', props.monitorId],
  queryFn: () => fetchLatency(props.monitorId),
})
</script>

<template>
  <DetailModal
    :title="data?.monitor.name ?? t('common.loading')"
    @close="$emit('close')"
  >
    <div v-if="isLoading" class="monitor-detail__loading">
      {{ t('status_page.loading_chart') }}
    </div>

    <template v-else-if="data">
      <div class="monitor-detail__stats">
        <div class="monitor-detail__stat">
          <div class="monitor-detail__stat-label">{{ t('status_page.avg_latency') }}</div>
          <div class="monitor-detail__stat-value">{{ data.avg_latency_ms ?? '-' }}ms</div>
        </div>
        <div class="monitor-detail__stat">
          <div class="monitor-detail__stat-label">{{ t('status_page.p95_latency') }}</div>
          <div class="monitor-detail__stat-value">{{ data.p95_latency_ms ?? '-' }}ms</div>
        </div>
      </div>

      <div class="monitor-detail__chart-container">
        <LatencyChart :points="data.points" />
      </div>
    </template>

    <div v-else class="monitor-detail__loading">
      {{ t('status_page.failed_load_data') }}
    </div>
  </DetailModal>
</template>

<style scoped lang="scss">
.monitor-detail__loading {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.monitor-detail__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 1.5rem;

  @media (min-width: 640px) {
    gap: 1.5rem;
  }
}

.monitor-detail__stat {
  background-color: var(--color-bg);
  border-radius: 0.5rem;
  padding: 0.625rem 0.75rem;

  @media (min-width: 640px) {
    padding: 0.625rem 1rem;
  }
}

.monitor-detail__stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

.monitor-detail__stat-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);

  @media (min-width: 640px) {
    font-size: 1.125rem;
  }
}

.monitor-detail__chart-container {
  min-height: 200px;
  margin-top: 1rem;
}
</style>
