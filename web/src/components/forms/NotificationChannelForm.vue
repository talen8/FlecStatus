<script setup lang="ts">
import { ref, computed } from 'vue'
import type {
  NotificationChannel,
  CreateNotificationChannelInput,
  WebhookChannelConfig,
} from '../../api/types'
import { useI18nStore } from '../../stores/i18n'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  channel?: NotificationChannel
  isLoading?: boolean
  error?: string | undefined
}>()

const emit = defineEmits<{
  submit: [data: CreateNotificationChannelInput]
  cancel: []
}>()

const i18n = useI18nStore()
const { t } = i18n

const webhookMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const allEvents: Array<'monitor.down' | 'monitor.up' | 'incident.created' | 'incident.updated' | 'incident.resolved' | 'maintenance.started' | 'maintenance.ended' | 'test.ping'> = [
  'monitor.down', 'monitor.up',
  'incident.created', 'incident.updated', 'incident.resolved',
  'maintenance.started', 'maintenance.ended',
]

const eventLabelKey: Record<string, string> = {
  'monitor.down': 'event_type.monitor_down',
  'monitor.up': 'event_type.monitor_up',
  'incident.created': 'event_type.incident_created',
  'incident.updated': 'event_type.incident_updated',
  'incident.resolved': 'event_type.incident_resolved',
  'maintenance.started': 'event_type.maintenance_started',
  'maintenance.ended': 'event_type.maintenance_ended',
}

// 初始配置提取
const initialConfig = props.channel?.config_json as WebhookChannelConfig | undefined

// 通用状态
const name = ref(props.channel?.name ?? '')
const timeoutMs = ref(initialConfig?.timeout_ms ?? 5000)
const messageTemplate = ref(initialConfig?.message_template ?? '')
const enabledEvents = ref<Array<'monitor.down' | 'monitor.up' | 'incident.created' | 'incident.updated' | 'incident.resolved' | 'maintenance.started' | 'maintenance.ended' | 'test.ping'>>(initialConfig?.enabled_events ?? [])

// 自定义 Webhook 状态
const url = ref(initialConfig?.url ?? '')
const method = ref(initialConfig?.method ?? 'POST')
const payloadType = ref(initialConfig?.payload_type ?? 'json')
const headersJson = ref(initialConfig?.headers ? JSON.stringify(initialConfig.headers, null, 2) : '')
const payloadTemplateJson = ref(initialConfig?.payload_template ? JSON.stringify(initialConfig.payload_template, null, 2) : '')
const signingEnabled = ref(initialConfig?.signing?.enabled ?? false)
const signingSecretRef = ref(initialConfig?.signing?.secret_ref ?? '')
const locale = ref(initialConfig?.locale ?? 'zh-CN')

// 验证
type ParseResult = { ok: true } | { ok: false; error: string }

function parseJsonHeaders(raw: string): ParseResult {
  if (!raw.trim()) return { ok: true }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: t('admin_channels.headers_must_be_object') }
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        return { ok: false, error: t('admin_channels.headers_must_be_strings') }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: t('admin_channels.invalid_json') }
  }
}

function parsePayloadTemplate(raw: string): ParseResult {
  if (!raw.trim()) return { ok: true }
  try {
    JSON.parse(raw)
    return { ok: true }
  } catch {
    return { ok: false, error: t('admin_channels.invalid_json') }
  }
}

const headersParse = computed(() => parseJsonHeaders(headersJson.value))
const payloadTemplateParse = computed(() => parsePayloadTemplate(payloadTemplateJson.value))

const canSubmit = computed(() => {
  if (name.value.trim().length === 0) return false
  if (url.value.trim().length === 0) return false
  if (headersParse.value?.ok === false) return false
  if (payloadTemplateParse.value?.ok === false) return false
  return true
})

function toggleEvent(evt: typeof allEvents[number]) {
  const idx = enabledEvents.value.indexOf(evt)
  if (idx >= 0) {
    enabledEvents.value = enabledEvents.value.filter(x => x !== evt)
  } else {
    enabledEvents.value = [...enabledEvents.value, evt]
  }
}

function handleSubmit() {
  if (!canSubmit.value) return

  const config: WebhookChannelConfig = {
    url: url.value.trim(),
    method: method.value,
  }
  if (payloadType.value !== 'json') config.payload_type = payloadType.value
  if (timeoutMs.value !== 5000) config.timeout_ms = timeoutMs.value
  if (headersJson.value.trim()) config.headers = JSON.parse(headersJson.value)
  if (messageTemplate.value.trim()) config.message_template = messageTemplate.value.trim()
  if (payloadTemplateJson.value.trim()) config.payload_template = JSON.parse(payloadTemplateJson.value)
  if (enabledEvents.value.length > 0) config.enabled_events = enabledEvents.value
  if (locale.value !== 'zh-CN') config.locale = locale.value
  if (signingEnabled.value && signingSecretRef.value.trim()) {
    config.signing = { enabled: true, secret_ref: signingSecretRef.value.trim() }
  }

  emit('submit', {
    name: name.value.trim(),
    type: 'webhook',
    config_json: config,
  })
}
</script>

<template>
  <div class="channel-form">
    <div v-if="error" class="channel-form__error-banner">{{ error }}</div>

    <!-- 名称 -->
    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.name') }}</label>
      <input v-model="name" class="channel-form__input" required :placeholder="t('admin_channels.name_placeholder')" />
    </div>

    <!-- 自定义 Webhook 配置 -->
    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.webhook_url') }}</label>
      <input v-model="url" class="channel-form__input" required :placeholder="t('notification_form.webhook_url_placeholder')" />
    </div>

    <div class="channel-form__row">
      <div class="channel-form__field">
        <label class="channel-form__label">{{ t('admin_channels.method') }}</label>
        <select v-model="method" class="channel-form__select">
          <option v-for="m in webhookMethods" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
      <div class="channel-form__field">
        <label class="channel-form__label">{{ t('admin_channels.payload_type') }}</label>
        <select v-model="payloadType" class="channel-form__select">
          <option value="json">{{ t('notification_form.payload_type_json') }}</option>
          <option value="param">{{ t('notification_form.payload_type_query') }}</option>
          <option value="x-www-form-urlencoded">{{ t('notification_form.payload_type_urlencoded') }}</option>
        </select>
      </div>
    </div>

    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.headers') }}</label>
      <textarea v-model="headersJson" class="channel-form__textarea" rows="3" :placeholder="t('notification_form.headers_placeholder')" />
      <div v-if="headersParse && !headersParse.ok" class="channel-form__field-error">{{ headersParse.error }}</div>
    </div>

    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.payload_template') }}</label>
      <textarea v-model="payloadTemplateJson" class="channel-form__textarea" rows="3" />
      <div v-if="payloadTemplateParse && !payloadTemplateParse.ok" class="channel-form__field-error">{{ payloadTemplateParse.error }}</div>
    </div>

    <label class="channel-form__checkbox-card">
      <input v-model="signingEnabled" type="checkbox" />
      <span>{{ t('admin_channels.signing') }}</span>
    </label>
    <div v-if="signingEnabled" class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.signing_secret_ref') }}</label>
      <input v-model="signingSecretRef" class="channel-form__input" />
    </div>

    <!-- 通用字段 -->
    <div class="channel-form__row">
      <div class="channel-form__field">
        <label class="channel-form__label">{{ t('admin_channels.timeout') }}</label>
        <input v-model.number="timeoutMs" class="channel-form__input channel-form__input--sm" type="number" min="1000" />
      </div>
      <div class="channel-form__field">
        <label class="channel-form__label">{{ t('admin_channels.locale') }}</label>
        <select v-model="locale" class="channel-form__select">
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>

    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.message_template') }}</label>
      <textarea v-model="messageTemplate" class="channel-form__textarea" rows="3" />
    </div>

    <div class="channel-form__field">
      <label class="channel-form__label">{{ t('admin_channels.enabled_events') }}</label>
      <div class="channel-form__events-grid">
        <label
          v-for="evt in allEvents"
          :key="evt"
          class="channel-form__checkbox-item"
        >
          <input
            type="checkbox"
            :checked="enabledEvents.includes(evt)"
            @change="toggleEvent(evt)"
          />
          <span>{{ t((eventLabelKey[evt] ?? evt) as any) }} <code>{{ evt }}</code></span>
        </label>
      </div>
    </div>

    <!-- 底部按钮 -->
    <div class="channel-form__footer">
      <UiButton variant="secondary" size="sm" @click="$emit('cancel')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!canSubmit || isLoading" @click="handleSubmit">
        {{ isLoading ? t('common.submitting') : (channel ? t('common.save') : t('common.create')) }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.channel-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 75vh;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.channel-form__error-banner {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
}

.channel-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.channel-form__label {
  @include form-label;
}

.channel-form__input,
.channel-form__select {
  @include form-input;
}

.channel-form__input--sm {
  max-width: 10rem;
}

.channel-form__textarea {
  @include form-input;
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
}

.channel-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.channel-form__checkbox-card {
  display: flex;
  align-items: center;
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
  }
}

.channel-form__events-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg);
  padding: 0.5rem;
}

.channel-form__checkbox-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-primary);
  cursor: pointer;
  border-radius: 0.25rem;

  &:hover {
    background: var(--color-border);
  }

  input[type="checkbox"] {
    flex-shrink: 0;
  }

  code {
    font-size: 0.625rem;
    color: var(--color-text-secondary);
    opacity: 0.7;
  }
}

.channel-form__field-error {
  font-size: 0.75rem;
  color: var(--color-danger);
}

.channel-form__footer {
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
