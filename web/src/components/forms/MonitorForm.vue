<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AdminMonitor, CreateMonitorInput, PatchMonitorInput, MonitorType, HttpResponseMatchMode } from '../../api/types'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  monitor?: AdminMonitor
  isLoading?: boolean
  error?: string | undefined
}>()

const emit = defineEmits<{
  submit: [data: CreateMonitorInput | PatchMonitorInput]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

// 表单状态
const name = ref(props.monitor?.name ?? '')
const groupName = ref(props.monitor?.group_name ?? '')
const sortOrder = ref(props.monitor?.sort_order ?? 0)
const showOnStatusPage = ref(props.monitor?.show_on_status_page ?? true)
const publicAccess = ref(props.monitor?.public_access ?? false)
const type = ref<MonitorType>(props.monitor?.type ?? 'http')
const target = ref(props.monitor?.target ?? '')
const intervalSec = ref(props.monitor?.interval_sec ?? 60)
const timeoutMs = ref(props.monitor?.timeout_ms ?? 10000)
const httpMethod = ref(props.monitor?.http_method ?? 'GET')

const hasAdvanced = !!props.monitor?.http_headers_json ||
  !!props.monitor?.expected_status_json ||
  !!props.monitor?.http_body ||
  !!props.monitor?.response_keyword ||
  !!props.monitor?.response_forbidden_keyword

const showAdvancedHttp = ref(hasAdvanced)
const httpHeadersJson = ref(props.monitor?.http_headers_json ? JSON.stringify(props.monitor.http_headers_json, null, 2) : '')
const expectedStatusInput = ref(props.monitor?.expected_status_json?.join(', ') ?? '')
const httpBody = ref(props.monitor?.http_body ?? '')
const responseKeyword = ref(props.monitor?.response_keyword ?? '')
const responseKeywordMode = ref<HttpResponseMatchMode>(props.monitor?.response_keyword_mode ?? 'contains')
const responseForbiddenKeyword = ref(props.monitor?.response_forbidden_keyword ?? '')
const responseForbiddenKeywordMode = ref<HttpResponseMatchMode>(props.monitor?.response_forbidden_keyword_mode ?? 'contains')

// 验证
type ParseResult = { ok: true } | { ok: false; error: string }

function parseJsonHeaders(raw: string): ParseResult {
  if (!raw.trim()) return { ok: true }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: t('admin_monitors.headers_must_be_object') }
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        return { ok: false, error: t('admin_monitors.headers_must_be_strings') }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: t('admin_monitors.invalid_json') }
  }
}

function parseExpectedStatus(raw: string): ParseResult {
  if (!raw.trim()) return { ok: true }
  try {
    let arr: unknown
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      arr = JSON.parse(trimmed)
    } else {
      arr = trimmed.split(/[\s,]+/).filter(Boolean).map(Number)
    }
    if (!Array.isArray(arr) || arr.length === 0) return { ok: false, error: t('admin_monitors.expected_status_must_be_array') }
    for (const n of arr) {
      if (!Number.isInteger(n) || n < 100 || n > 599) {
        return { ok: false, error: t('admin_monitors.expected_status_range') }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: t('admin_monitors.invalid_format') }
  }
}

function parseRegex(raw: string): ParseResult {
  if (!raw.trim()) return { ok: true }
  try {
    new RegExp(raw)
    return { ok: true }
  } catch {
    return { ok: false, error: t('admin_monitors.invalid_regex') }
  }
}

const headersParse = computed(() => showAdvancedHttp.value ? parseJsonHeaders(httpHeadersJson.value) : null)
const expectedStatusParse = computed(() => showAdvancedHttp.value ? parseExpectedStatus(expectedStatusInput.value) : null)
const responseKeywordRegexParse = computed(() => showAdvancedHttp.value && responseKeywordMode.value === 'regex' ? parseRegex(responseKeyword.value) : null)
const responseForbiddenKeywordRegexParse = computed(() => showAdvancedHttp.value && responseForbiddenKeywordMode.value === 'regex' ? parseRegex(responseForbiddenKeyword.value) : null)

const canSubmit = computed(() =>
  name.value.trim().length > 0 &&
  target.value.trim().length > 0 &&
  (!showAdvancedHttp.value || (
    headersParse.value?.ok !== false &&
    expectedStatusParse.value?.ok !== false &&
    responseKeywordRegexParse.value?.ok !== false &&
    responseForbiddenKeywordRegexParse.value?.ok !== false
  ))
)

// 提交
function handleSubmit() {
  if (!canSubmit.value) return

  const headersParsed = httpHeadersJson.value.trim() ? JSON.parse(httpHeadersJson.value) as Record<string, string> : null
  const expectedStatusParsed = expectedStatusInput.value.trim()
    ? (expectedStatusInput.value.trim().startsWith('[')
      ? JSON.parse(expectedStatusInput.value)
      : expectedStatusInput.value.split(/[\s,]+/).filter(Boolean).map(Number))
    : null

  if (props.monitor) {
    // 编辑模式
    const patch: PatchMonitorInput = {
      name: name.value.trim(),
      target: target.value.trim(),
      group_name: groupName.value.trim() || null,
      sort_order: sortOrder.value,
      show_on_status_page: showOnStatusPage.value,
      public_access: publicAccess.value,
      interval_sec: intervalSec.value,
      timeout_ms: timeoutMs.value,
      ...(type.value === 'http' ? { http_method: httpMethod.value } : {}),
    }

    if (type.value === 'http' && showAdvancedHttp.value) {
      patch.http_headers_json = headersParsed
      patch.expected_status_json = expectedStatusParsed
      patch.http_body = httpBody.value.trim() || null
      patch.response_keyword = responseKeyword.value.trim() || null
      patch.response_keyword_mode = responseKeyword.value.trim() ? responseKeywordMode.value : null
      patch.response_forbidden_keyword = responseForbiddenKeyword.value.trim() || null
      patch.response_forbidden_keyword_mode = responseForbiddenKeyword.value.trim() ? responseForbiddenKeywordMode.value : null
    } else if (type.value === 'http') {
      patch.http_headers_json = null
      patch.expected_status_json = null
      patch.http_body = null
      patch.response_keyword = null
      patch.response_keyword_mode = null
      patch.response_forbidden_keyword = null
      patch.response_forbidden_keyword_mode = null
    }

    emit('submit', patch)
  } else {
    // 创建模式
    const input: CreateMonitorInput = {
      name: name.value.trim(),
      type: type.value,
      target: target.value.trim(),
      interval_sec: intervalSec.value,
      timeout_ms: timeoutMs.value,
      show_on_status_page: showOnStatusPage.value,
      public_access: publicAccess.value,
      sort_order: sortOrder.value,
    }
    if (groupName.value.trim()) input.group_name = groupName.value.trim()
    if (type.value === 'http') {
      input.http_method = httpMethod.value
      if (showAdvancedHttp.value) {
        if (headersParsed) input.http_headers_json = headersParsed
        if (expectedStatusParsed) input.expected_status_json = expectedStatusParsed
        if (httpBody.value.trim()) input.http_body = httpBody.value.trim()
        if (responseKeyword.value.trim()) {
          input.response_keyword = responseKeyword.value.trim()
          input.response_keyword_mode = responseKeywordMode.value
        }
        if (responseForbiddenKeyword.value.trim()) {
          input.response_forbidden_keyword = responseForbiddenKeyword.value.trim()
          input.response_forbidden_keyword_mode = responseForbiddenKeywordMode.value
        }
      }
    }
    emit('submit', input)
  }
}
</script>

<template>
  <div class="monitor-form">
    <div v-if="error" class="monitor-form__error-banner">{{ error }}</div>

    <!-- 名称 -->
    <div class="monitor-form__field">
      <label class="monitor-form__label">{{ t('admin_monitors.name') }}</label>
      <input v-model="name" class="monitor-form__input" required :placeholder="t('admin_monitors.name_placeholder')" />
    </div>

    <!-- 分组 -->
    <div class="monitor-form__field">
      <label class="monitor-form__label">{{ t('admin_monitors.group') }}</label>
      <input v-model="groupName" class="monitor-form__input" :placeholder="t('admin_monitors.group_placeholder')" />
    </div>

    <div class="monitor-form__quick-row">
      <!-- 显示在状态页 -->
      <label class="monitor-form__checkbox-card">
        <input v-model="showOnStatusPage" type="checkbox" />
        <span>{{ t('admin_monitors.show_on_status_page') }}</span>
      </label>

      <!-- 公开访问 -->
      <label class="monitor-form__checkbox-card">
        <input v-model="publicAccess" type="checkbox" />
        <span>{{ t('admin_monitors.public_access') }}</span>
      </label>

      <div class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.sort_order') }}</label>
        <input v-model.number="sortOrder" class="monitor-form__input" type="number" />
      </div>
    </div>

    <div :class="['monitor-form__target-row', type === 'http' && 'monitor-form__target-row--http']">
      <!-- 类型 -->
      <div class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.type') }}</label>
        <select v-model="type" class="monitor-form__select" :disabled="!!monitor">
          <option value="http">{{ t('monitor_form.type_http') }}</option>
          <option value="tcp">{{ t('monitor_form.type_tcp') }}</option>
        </select>
      </div>

      <!-- 目标 -->
      <div class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.target') }}</label>
        <input v-model="target" class="monitor-form__input" required :placeholder="type === 'http' ? t('monitor_form.target_url_placeholder') : t('monitor_form.target_host_port_placeholder')" />
      </div>

      <!-- HTTP 方法 -->
      <div v-if="type === 'http'" class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.http_method') }}</label>
        <select v-model="httpMethod" class="monitor-form__select">
          <option v-for="m in httpMethods" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>

    <!-- 间隔、超时 -->
    <div class="monitor-form__row">
      <div class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.interval') }}</label>
        <input v-model.number="intervalSec" class="monitor-form__input" type="number" min="10" />
      </div>
      <div class="monitor-form__field">
        <label class="monitor-form__label">{{ t('admin_monitors.timeout') }}</label>
        <input v-model.number="timeoutMs" class="monitor-form__input" type="number" min="1000" />
      </div>
    </div>

    <!-- 高级 HTTP 选项 -->
    <template v-if="type === 'http'">
      <label class="monitor-form__checkbox-card">
        <input v-model="showAdvancedHttp" type="checkbox" />
        <span>{{ t('admin_monitors.advanced_http') }}</span>
      </label>

      <template v-if="showAdvancedHttp">
        <div class="monitor-form__field">
          <label class="monitor-form__label">{{ t('admin_monitors.headers') }}</label>
          <textarea v-model="httpHeadersJson" class="monitor-form__textarea" rows="3" :placeholder="t('monitor_form.headers_placeholder')" />
          <div v-if="headersParse && !headersParse.ok" class="monitor-form__field-error">{{ headersParse.error }}</div>
        </div>

        <div class="monitor-form__field">
          <label class="monitor-form__label">{{ t('admin_monitors.expected_status') }}</label>
          <input v-model="expectedStatusInput" class="monitor-form__input" :placeholder="t('monitor_form.expected_status_placeholder')" />
          <div v-if="expectedStatusParse && !expectedStatusParse.ok" class="monitor-form__field-error">{{ expectedStatusParse.error }}</div>
        </div>

        <div class="monitor-form__field">
          <label class="monitor-form__label">{{ t('admin_monitors.body') }}</label>
          <textarea v-model="httpBody" class="monitor-form__textarea" rows="3" />
        </div>

        <div class="monitor-form__field">
          <label class="monitor-form__label">{{ t('admin_monitors.response_keyword') }}</label>
          <div class="monitor-form__keyword-row">
            <input v-model="responseKeyword" class="monitor-form__input monitor-form__input--flex" />
            <select v-model="responseKeywordMode" class="monitor-form__select monitor-form__select--sm">
              <option value="contains">{{ t('admin_monitors.contains') }}</option>
              <option value="regex">{{ t('admin_monitors.regex') }}</option>
            </select>
          </div>
          <div v-if="responseKeywordRegexParse && !responseKeywordRegexParse.ok" class="monitor-form__field-error">{{ responseKeywordRegexParse.error }}</div>
        </div>

        <div class="monitor-form__field">
          <label class="monitor-form__label">{{ t('admin_monitors.response_forbidden_keyword') }}</label>
          <div class="monitor-form__keyword-row">
            <input v-model="responseForbiddenKeyword" class="monitor-form__input monitor-form__input--flex" />
            <select v-model="responseForbiddenKeywordMode" class="monitor-form__select monitor-form__select--sm">
              <option value="contains">{{ t('admin_monitors.contains') }}</option>
              <option value="regex">{{ t('admin_monitors.regex') }}</option>
            </select>
          </div>
          <div v-if="responseForbiddenKeywordRegexParse && !responseForbiddenKeywordRegexParse.ok" class="monitor-form__field-error">{{ responseForbiddenKeywordRegexParse.error }}</div>
        </div>
      </template>
    </template>

    <!-- 底部按钮 -->
    <div class="monitor-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!canSubmit || isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : (monitor ? t('common.save') : t('common.create')) }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.monitor-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 75vh;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.monitor-form__error-banner {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
}

.monitor-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.monitor-form__label {
  @include form-label;
}

.monitor-form__input,
.monitor-form__select {
  @include form-input;
}

.monitor-form__input--flex {
  flex: 1;
}

.monitor-form__select--sm {
  width: auto;
  min-width: 6rem;
}

.monitor-form__textarea {
  @include form-input;
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.monitor-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.monitor-form__quick-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  align-items: end;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
}

.monitor-form__target-row {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.75rem;

  &--http {
    grid-template-columns: 8rem minmax(0, 1fr) 8rem;
  }

  @media (max-width: 640px) {
    grid-template-columns: 1fr;

    &--http {
      grid-template-columns: 1fr;
    }
  }
}

.monitor-form__checkbox-card {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  cursor: pointer;

  input[type="checkbox"] {
    flex-shrink: 0;
    margin-top: 0.125rem;
  }
}

.monitor-form__keyword-row {
  display: flex;
  gap: 0.5rem;
}

.monitor-form__field-error {
  font-size: 0.75rem;
  color: var(--color-danger);
}

.monitor-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
  position: sticky;
  bottom: 0;
  background: var(--color-card);
  padding-top: 0.5rem;
}
</style>
