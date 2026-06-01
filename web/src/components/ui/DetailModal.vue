<script setup lang="ts">
import UiModal from './UiModal.vue'
import UiBadge from './UiBadge.vue'

export interface DetailBadge {
  text: string
  variant: 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' | 'info'
}

export interface DetailMetaItem {
  label: string
  value: string
}

defineProps<{
  title: string
  badges?: DetailBadge[]
  meta?: DetailMetaItem[]
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <UiModal :visible="true" @close="$emit('close')">
    <div class="detail-modal">
      <div class="detail-modal__header">
        <div>
          <h2 class="detail-modal__title">{{ title }}</h2>
          <div v-if="badges && badges.length > 0" class="detail-modal__badges">
            <UiBadge v-for="(badge, i) in badges" :key="i" :variant="badge.variant">
              {{ badge.text }}
            </UiBadge>
          </div>
        </div>
        <button class="detail-modal__close" @click="$emit('close')">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div v-if="meta && meta.length > 0" class="detail-modal__meta">
        <div v-for="(item, i) in meta" :key="i" class="detail-modal__meta-row">
          <span class="detail-modal__meta-label">{{ item.label }}:</span>
          <span class="detail-modal__meta-value">{{ item.value }}</span>
        </div>
      </div>

      <div class="detail-modal__content">
        <slot />
      </div>
    </div>
  </UiModal>
</template>

<style scoped lang="scss">
.detail-modal {
  padding: 1.25rem;

  @media (min-width: 640px) {
    padding: 1.5rem;
  }
}

.detail-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;

  @media (min-width: 640px) {
    margin-bottom: 1.5rem;
  }
}

.detail-modal__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;

  @media (min-width: 640px) {
    font-size: 1.25rem;
  }
}

.detail-modal__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.detail-modal__close {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--color-text-muted);
  flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--color-border);
    color: var(--color-text-secondary);
  }
}

.detail-modal__meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);

  @media (min-width: 640px) {
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1.5rem;
  }
}

.detail-modal__meta-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  @media (min-width: 640px) {
    flex-direction: row;
    gap: 0.5rem;
  }
}

.detail-modal__meta-label {
  color: var(--color-text-muted);
  font-size: 0.75rem;

  @media (min-width: 640px) {
    width: 5rem;
    font-size: 0.875rem;
  }
}

.detail-modal__meta-value {
  font-size: 0.875rem;
}

.detail-modal__content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
