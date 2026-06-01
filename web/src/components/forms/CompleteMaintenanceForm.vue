<script setup lang="ts">
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

defineProps<{
  isLoading?: boolean
}>()

defineEmits<{
  submit: []
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n
</script>

<template>
  <div class="complete-form">
    <p class="complete-form__confirm">
      {{ t('admin_maintenance.complete_confirm') }}
    </p>

    <div class="complete-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="success" size="sm" :disabled="isLoading" @click="$emit('submit')">
        {{ isLoading ? t('common.submitting') : t('common.complete') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.complete-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.complete-form__confirm {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0;
}

.complete-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
