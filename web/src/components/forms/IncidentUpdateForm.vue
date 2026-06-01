<script setup lang="ts">
import { ref, computed } from 'vue'
import type { IncidentStatus } from '../../api/types'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

defineProps<{
  isLoading?: boolean
}>()

const emit = defineEmits<{
  submit: [data: { message: string; status?: Exclude<IncidentStatus, 'resolved'> }]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const status = ref<Exclude<IncidentStatus, 'resolved'> | ''>('')
const message = ref('')
const normalized = computed(() => message.value.trim())

function handleSubmit() {
  if (!normalized.value) return
  const data: { message: string; status?: Exclude<IncidentStatus, 'resolved'> } = { message: normalized.value }
  if (status.value) data.status = status.value
  emit('submit', data)
}
</script>

<template>
  <div class="incident-update-form">
    <div class="incident-update-form__field">
      <label class="incident-update-form__label">{{ t('admin_incidents.update_status') }}</label>
      <select v-model="status" class="incident-update-form__select">
        <option value="">{{ t('admin_incidents.no_status_change') }}</option>
        <option value="investigating">{{ t('incident_status.investigating') }}</option>
        <option value="identified">{{ t('incident_status.identified') }}</option>
        <option value="monitoring">{{ t('incident_status.monitoring') }}</option>
      </select>
    </div>

    <div class="incident-update-form__field">
      <label class="incident-update-form__label">{{ t('admin_incidents.update_message') }}</label>
      <textarea
        v-model="message"
        class="incident-update-form__textarea"
        rows="4"
        required
        :placeholder="t('admin_incidents.update_message_placeholder')"
      />
    </div>

    <div class="incident-update-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!normalized || isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : t('admin_incidents.post_update') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.incident-update-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.incident-update-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.incident-update-form__label {
  @include form-label;
}

.incident-update-form__select {
  @include form-input;
}

.incident-update-form__textarea {
  @include form-input;
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.incident-update-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
