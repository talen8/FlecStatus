<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

defineProps<{
  isLoading?: boolean
}>()

const emit = defineEmits<{
  submit: [data: { message?: string }]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const message = ref('')
const normalized = computed(() => message.value.trim())

function handleSubmit() {
  emit('submit', normalized.value ? { message: normalized.value } : {})
}
</script>

<template>
  <div class="resolve-form">
    <div class="resolve-form__field">
      <label class="resolve-form__label">{{ t('admin_incidents.resolve_message') }}</label>
      <textarea
        v-model="message"
        class="resolve-form__textarea"
        rows="4"
        :placeholder="t('admin_incidents.resolve_message_placeholder')"
      />
    </div>

    <div class="resolve-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="success" size="sm" :disabled="isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : t('admin_incidents.resolve') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.resolve-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.resolve-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.resolve-form__label {
  @include form-label;
}

.resolve-form__textarea {
  @include form-input;
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.resolve-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
