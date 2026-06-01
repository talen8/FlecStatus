<script setup lang="ts">
import UiCard from '../ui/UiCard.vue'

withDefaults(defineProps<{
  loading?: boolean
  loadingText?: string
  title?: string
}>(), {
  loading: false,
  loadingText: '',
  title: '',
})
</script>

<template>
  <div class="admin-tab">
    <UiCard v-if="loading" class="admin-tab__loading">{{ loadingText }}</UiCard>
    <slot name="feedback" />
    <div v-if="title || $slots.actions" class="admin-tab__toolbar">
      <h2 v-if="title" class="admin-tab__title">{{ title }}</h2>
      <slot name="actions" />
    </div>
    <slot />
  </div>
</template>

<style scoped lang="scss">
.admin-tab__loading {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-muted);
}

.admin-tab__toolbar {
  margin-bottom: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.admin-tab__title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
</style>
