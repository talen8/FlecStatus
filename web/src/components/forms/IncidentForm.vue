<script setup lang="ts">
import { ref, computed } from 'vue'
import type { IncidentImpact, IncidentStatus } from '../../api/types'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

defineProps<{
  monitors: Array<{ id: number; name: string }>
  isLoading?: boolean
}>()

const emit = defineEmits<{
  submit: [data: { title: string; impact: IncidentImpact; status: Exclude<IncidentStatus, 'resolved'>; monitor_ids: number[]; message?: string }]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const title = ref('')
const impact = ref<IncidentImpact>('minor')
const status = ref<Exclude<IncidentStatus, 'resolved'>>('investigating')
const message = ref('')
const selectedMonitorIds = ref<number[]>([])
const showMonitorError = ref(false)

const normalizedMessage = computed(() => message.value.trim())

const canSubmit = computed(() =>
  title.value.trim().length > 0 && selectedMonitorIds.value.length > 0
)

function toggleMonitor(id: number) {
  const idx = selectedMonitorIds.value.indexOf(id)
  if (idx >= 0) {
    selectedMonitorIds.value = selectedMonitorIds.value.filter(x => x !== id)
  } else {
    selectedMonitorIds.value = [...selectedMonitorIds.value, id]
  }
  showMonitorError.value = selectedMonitorIds.value.length === 0
}

function handleSubmit() {
  if (selectedMonitorIds.value.length === 0) {
    showMonitorError.value = true
    return
  }
  if (!title.value.trim()) return

  emit('submit', {
    title: title.value.trim(),
    impact: impact.value,
    status: status.value,
    monitor_ids: selectedMonitorIds.value,
    ...(normalizedMessage.value ? { message: normalizedMessage.value } : {}),
  })
}
</script>

<template>
  <div class="incident-form">
    <div class="incident-form__field">
      <label class="incident-form__label">{{ t('admin_incidents.select_monitors') }}</label>
      <div v-if="monitors.length === 0" class="incident-form__hint">{{ t('admin_monitors.empty') }}</div>
      <div v-else class="incident-form__checkbox-list">
        <label
          v-for="m in monitors"
          :key="m.id"
          class="incident-form__checkbox-item"
        >
          <input
            type="checkbox"
            :value="m.id"
            :checked="selectedMonitorIds.includes(m.id)"
            @change="toggleMonitor(m.id)"
          />
          <span>{{ m.name }}</span>
        </label>
      </div>
      <div v-if="showMonitorError" class="incident-form__error">{{ t('admin_incidents.monitors_required') }}</div>
    </div>

    <div class="incident-form__field">
      <label class="incident-form__label">{{ t('admin_incidents.title') }}</label>
      <input
        v-model="title"
        class="incident-form__input"
        required
        :placeholder="t('admin_incidents.title_placeholder')"
      />
    </div>

    <div class="incident-form__row">
      <div class="incident-form__field">
        <label class="incident-form__label">{{ t('admin_incidents.impact') }}</label>
        <select v-model="impact" class="incident-form__select">
          <option value="none">{{ t('incident_impact.none') }}</option>
          <option value="minor">{{ t('incident_impact.minor') }}</option>
          <option value="major">{{ t('incident_impact.major') }}</option>
          <option value="critical">{{ t('incident_impact.critical') }}</option>
        </select>
      </div>
      <div class="incident-form__field">
        <label class="incident-form__label">{{ t('admin_incidents.status') }}</label>
        <select v-model="status" class="incident-form__select">
          <option value="investigating">{{ t('incident_status.investigating') }}</option>
          <option value="identified">{{ t('incident_status.identified') }}</option>
          <option value="monitoring">{{ t('incident_status.monitoring') }}</option>
        </select>
      </div>
    </div>

    <div class="incident-form__field">
      <label class="incident-form__label">{{ t('admin_incidents.message') }}</label>
      <textarea
        v-model="message"
        class="incident-form__textarea"
        rows="4"
        :placeholder="t('admin_incidents.message_placeholder')"
      />
    </div>

    <div class="incident-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!canSubmit || isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : t('common.create') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.incident-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.incident-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.incident-form__label {
  @include form-label;
}

.incident-form__input,
.incident-form__select {
  @include form-input;
}

.incident-form__textarea {
  @include form-input;
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.incident-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.incident-form__checkbox-list {
  max-height: 10rem;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg);
}

.incident-form__checkbox-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  cursor: pointer;

  &:hover {
    background: var(--color-border);
  }

  input[type="checkbox"] {
    flex-shrink: 0;
  }
}

.incident-form__hint {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.incident-form__error {
  font-size: 0.75rem;
  color: var(--color-danger);
}

.incident-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
