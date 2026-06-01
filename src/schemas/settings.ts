import { z } from 'zod';

export const settingsPatchInputSchema = z
  .object({
    site_title: z.string().min(1).max(100).optional(),
    site_description: z.string().max(500).optional(),

    site_locale: z.enum(['auto', 'en', 'zh-CN', 'zh-TW']).optional(),

    // IANA 时区，例如 'UTC'、'Asia/Shanghai'。
    site_timezone: z.string().min(1).max(64).optional(),

    site_nav_link_1_label: z.string().max(20).optional(),
    site_nav_link_1_url: z.string().max(500).optional(),
    site_nav_link_2_label: z.string().max(20).optional(),
    site_nav_link_2_url: z.string().max(500).optional(),
    site_nav_link_3_label: z.string().max(20).optional(),
    site_nav_link_3_url: z.string().max(500).optional(),

    retention_check_results_days: z.number().int().min(1).max(365).optional(),

    state_failures_to_down_from_up: z.number().int().min(1).max(10).optional(),
    state_successes_to_up_from_down: z.number().int().min(1).max(10).optional(),

    admin_default_overview_range: z.enum(['24h', '7d']).optional(),
    admin_default_monitor_range: z.enum(['24h', '7d', '30d', '90d']).optional(),
  })
  .strict();

export type SettingsPatchInput = z.infer<typeof settingsPatchInputSchema>;
