import { z } from 'zod';

import { customWebhookChannelConfigSchema } from '../db';

export const createNotificationChannelInputSchema = z.object({
  name: z.string().min(1),
  type: z.literal('webhook').default('webhook'),
  config_json: customWebhookChannelConfigSchema,
  is_active: z.boolean().optional(),
});

export type CreateNotificationChannelInput = z.infer<typeof createNotificationChannelInputSchema>;

export const patchNotificationChannelInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    config_json: customWebhookChannelConfigSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: 'At least one field must be provided',
  });

export type PatchNotificationChannelInput = z.infer<typeof patchNotificationChannelInputSchema>;
