<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MaintenanceWindow } from '../../api/types'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  monitors: Array<{ id: number; name: string }>
  maintenance?: MaintenanceWindow
  isLoading?: boolean
}>()

const emit = defineEmits<{
  submit: [data: { title: string; starts_at: number; ends_at: number; monitor_ids: number[]; message?: string | null }]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

function toDatetimeLocal(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): number | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000)
}

const title = ref(props.maintenance?.title ?? '')
const message = ref(props.maintenance?.message ?? '')
const startsAt = ref(props.maintenance ? toDatetimeLocal(props.maintenance.starts_at) : '')
const endsAt = ref(props.maintenance ? toDatetimeLocal(props.maintenance.ends_at) : '')
const selectedMonitorIds = ref<number[]>(props.maintenance?.monitor_ids ?? [])
const monitorsError = ref(false)

const normalizedMessage = computed(() => message.value.trim())

const parsedStartsAt = computed(() => fromDatetimeLocal(startsAt.value))
const parsedEndsAt = computed(() => fromDatetimeLocal(endsAt.value))

const timeError = computed(() => {
  if (!parsedStartsAt.value || !parsedEndsAt.value) return null
  if (parsedStartsAt.value >= parsedEndsAt.value) return t('admin_maintenance.time_error')
  return null
})

const canSubmit = computed(() =>
  title.value.trim().length > 0 &&
  parsedStartsAt.value !== null &&
  parsedEndsAt.value !== null &&
  !timeError.value &&
  selectedMonitorIds.value.length > 0
)

function toggleMonitor(id: number) {
  const idx = selectedMonitorIds.value.indexOf(id)
  if (idx >= 0) {
    selectedMonitorIds.value = selectedMonitorIds.value.filter(x => x !== id)
  } else {
    selectedMonitorIds.value = [...selectedMonitorIds.value, id]
  }
  monitorsError.value = selectedMonitorIds.value.length === 0
}

function handleSubmit() {
  if (selectedMonitorIds.value.length === 0) {
    monitorsError.value = true
    return
  }
  if (!canSubmit.value) return

  const data: { title: string; starts_at: number; ends_at: number; monitor_ids: number[]; message?: string | null } = {
    title: title.value.trim(),
    starts_at: parsedStartsAt.value!,
    ends_at: parsedEndsAt.value!,
    monitor_ids: selectedMonitorIds.value,
  }

  if (props.maintenance) {
    data.message = normalizedMessage.value || null
  } else if (normalizedMessage.value) {
    data.message = normalizedMessage.value
  }

  emit('submit', data)
}
</script>

<template>
  <div class="maintenance-form">
    <div class="maintenance-form__field">
      <label class="maintenance-form__label">{{ t('admin_maintenance.select_monitors') }}</label>
      <div v-if="monitors.length === 0" class="maintenance-form__hint">{{ t('admin_monitors.empty') }}</div>
      <div v-else class="maintenance-form__checkbox-list">
        <label
          v-for="m in monitors"
          :key="m.id"
          class="maintenance-form__checkbox-item"
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
      <div v-if="monitorsError" class="maintenance-form__error">{{ t('admin_maintenance.monitors_required') }}</div>
    </div>

    <div class="maintenance-form__field">
      <label class="maintenance-form__label">{{ t('admin_maintenance.title') }}</label>
      <input
        v-model="title"
        class="maintenance-form__input"
        required
        :placeholder="t('admin_maintenance.title_placeholder')"
      />
    </div>

    <div class="maintenance-form__row">
      <div class="maintenance-form__field">
        <label class="maintenance-form__label">{{ t('admin_maintenance.starts_at') }}</label>
        <input
          v-model="startsAt"
          type="datetime-local"
          class="maintenance-form__input"
        />
      </div>
      <div class="maintenance-form__field">
        <label class="maintenance-form__label">{{ t('admin_maintenance.ends_at') }}</label>
        <input
          v-model="endsAt"
          type="datetime-local"
          class="maintenance-form__input"
        />
      </div>
    </div>
    <div v-if="timeError" class="maintenance-form__error">{{ timeError }}</div>

    <div class="maintenance-form__field">
      <label class="maintenance-form__label">{{ t('admin_maintenance.message') }}</label>
      <textarea
        v-model="message"
        class="maintenance-form__textarea"
        rows="4"
        :placeholder="t('admin_maintenance.message_placeholder')"
      />
    </div>

    <div class="maintenance-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!canSubmit || isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : (maintenance ? t('common.save') : t('common.create')) }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.maintenance-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.maintenance-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.maintenance-form__label {
  @include form-label;
}

.maintenance-form__input,
.maintenance-form__textarea {
  @include form-input;
}

.maintenance-form__textarea {
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.maintenance-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.maintenance-form__checkbox-list {
  max-height: 10rem;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg);
}

.maintenance-form__checkbox-item {
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

.maintenance-form__hint {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.maintenance-form__error {
  font-size: 0.75rem;
  color: var(--color-danger);
}

.maintenance-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
