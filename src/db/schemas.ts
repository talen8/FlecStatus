import { z } from 'zod';

export function parseDbJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: string,
  opts: { field?: string } = {},
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (err) {
    const field = opts.field ?? 'json';
    throw new Error(`Invalid JSON in ${field}: ${(err as Error).message}`);
  }

  const r = schema.safeParse(parsed);
  if (!r.success) {
    const field = opts.field ?? 'json';
    throw new Error(`Invalid value in ${field}: ${r.error.message}`);
  }
  return r.data;
}

export function parseDbJsonNullable<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: string | null,
  opts: { field?: string } = {},
): T | null {
  if (value === null) return null;
  return parseDbJson(schema, value, opts);
}

export function serializeDbJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: T,
  opts: { field?: string } = {},
): string {
  const r = schema.safeParse(value);
  if (!r.success) {
    const field = opts.field ?? 'json';
    throw new Error(`Invalid value in ${field}: ${r.error.message}`);
  }
  return JSON.stringify(r.data);
}

export function serializeDbJsonNullable<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: T | null,
  opts: { field?: string } = {},
): string | null {
  if (value === null) return null;
  return serializeDbJson(schema, value, opts);
}

export const httpHeadersJsonSchema = z.record(z.string());
export type HttpHeadersJson = z.infer<typeof httpHeadersJsonSchema>;

export const expectedStatusJsonSchema = z.array(z.number().int().min(100).max(599)).min(1);
export type ExpectedStatusJson = z.infer<typeof expectedStatusJsonSchema>;

export const webhookSigningSchema = z.object({
  enabled: z.boolean(),
  secret_ref: z.string().min(1),
});

const notificationChannelTimeoutMsSchema = z.number().int().min(1).max(60000).optional();
const notificationMessageTemplateSchema = z.string().min(1).max(10_000).optional();

export const notificationEventTypeSchema = z.enum([
  'monitor.down',
  'monitor.up',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'maintenance.started',
  'maintenance.ended',
  'test.ping',
]);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

const webhookUrlSchema = z
  .string()
  .url()
  .refine((val) => {
    try {
      const url = new URL(val);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url protocol must be http or https');

export const customWebhookChannelConfigSchema = z
  .object({
    url: webhookUrlSchema,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('POST'),
    headers: z.record(z.string()).optional(),
    timeout_ms: notificationChannelTimeoutMsSchema,
    payload_type: z.enum(['json', 'param', 'x-www-form-urlencoded']).default('json'),

    // payload 模板中 $MSG / {{message}} 使用的可选消息模板。
    message_template: notificationMessageTemplateSchema,

    // 可选的 payload 模板。此 JSON 值中的字符串可以引用魔术变量。
    payload_template: z.unknown().optional(),

    // 如果省略，该渠道将接收所有事件。
    enabled_events: z.array(notificationEventTypeSchema).min(1).optional(),

    // 通知消息语言，默认 zh-CN。
    locale: z.enum(['en', 'zh-CN', 'zh-TW']).optional(),

    signing: webhookSigningSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payload_template === undefined) return;

    // 对于 query param / form 类型的 payload，仅支持扁平的键值对象。
    if (val.payload_type === 'param' || val.payload_type === 'x-www-form-urlencoded') {
      const pt = val.payload_template;
      const isObject = pt !== null && typeof pt === 'object' && !Array.isArray(pt);
      if (!isObject) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload_template'],
          message: `payload_template must be an object when payload_type is ${val.payload_type}`,
        });
        return;
      }

      for (const [k, v] of Object.entries(pt as Record<string, unknown>)) {
        if (v === null || v === undefined) continue;
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload_template', k],
          message: `payload_template.${k} must be a string/number/boolean/null for ${val.payload_type}`,
        });
      }
    }
  });
export type CustomWebhookChannelConfig = z.infer<typeof customWebhookChannelConfigSchema>;

export const webhookChannelConfigSchema = customWebhookChannelConfigSchema;
export type WebhookChannelConfig = z.infer<typeof webhookChannelConfigSchema>;
