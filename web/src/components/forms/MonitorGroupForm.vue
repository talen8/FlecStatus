<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  groupName: string
  groupSortOrder: number
  monitorCount: number
  isLoading?: boolean
  error?: string | undefined
}>()

const emit = defineEmits<{
  submit: [data: { groupName: string; groupSortOrder: number }]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const groupName = ref(props.groupName)
const groupSortOrderInput = ref(String(props.groupSortOrder))

function normalizeInputValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

const normalizedGroupName = computed(() => groupName.value.trim())

const parsedGroupSortOrder = computed(() => {
  const raw = normalizeInputValue(groupSortOrderInput.value).trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) ? n : null
})

const groupSortOrderError = computed(() => {
  const raw = normalizeInputValue(groupSortOrderInput.value).trim()
  if (!raw) return t('admin_dashboard.group_edit_sort_order_required')
  const n = parsedGroupSortOrder.value
  if (n === null || n < -100000 || n > 100000) return t('admin_monitors.sort_order_range')
  return null
})

const canSubmit = computed(() => normalizedGroupName.value.length > 0 && groupSortOrderError.value === null)

function handleSubmit() {
  if (!canSubmit.value || parsedGroupSortOrder.value === null) return
  emit('submit', {
    groupName: normalizedGroupName.value,
    groupSortOrder: parsedGroupSortOrder.value,
  })
}
</script>

<template>
  <div class="monitor-group-form">
    <div v-if="error" class="monitor-group-form__error-banner">{{ error }}</div>

    <div class="monitor-group-form__field">
      <label class="monitor-group-form__label">{{ t('admin_dashboard.group_edit_name') }}</label>
      <input
        v-model="groupName"
        class="monitor-group-form__input"
        :placeholder="t('admin_dashboard.group_edit_name_placeholder')"
      />
    </div>

    <div class="monitor-group-form__field">
      <label class="monitor-group-form__label">{{ t('admin_dashboard.group_edit_sort_order') }}</label>
      <input
        :value="groupSortOrderInput"
        class="monitor-group-form__input"
        type="text"
        inputmode="numeric"
        @input="groupSortOrderInput = ($event.target as HTMLInputElement).value"
      />
      <div v-if="groupSortOrderError" class="monitor-group-form__field-error">{{ groupSortOrderError }}</div>
    </div>

    <div class="monitor-group-form__hint">
      {{ t('admin_dashboard.group_edit_help', { count: monitorCount }) }}
    </div>

    <div class="monitor-group-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="isLoading || !canSubmit" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : t('common.save') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.monitor-group-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.monitor-group-form__error-banner {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
}

.monitor-group-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.monitor-group-form__label {
  @include form-label;
}

.monitor-group-form__input {
  @include form-input;
}

.monitor-group-form__field-error {
  font-size: 0.75rem;
  color: var(--color-danger);
}

.monitor-group-form__hint {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.monitor-group-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
