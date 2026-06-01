import { z } from 'zod';

import {
  bannerSchema,
  checkStatusSchema,
  incidentImpactSchema,
  incidentStatusSchema,
  monitorStatusSchema,
  siteNavLinkSchema,
} from './shared';

const incidentUpdateSchema = z.object({
  id: z.number().int().positive(),
  incident_id: z.number().int().positive(),
  status: incidentStatusSchema.nullable(),
  message: z.string(),
  created_at: z.number().int().nonnegative(),
});

const incidentSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: incidentStatusSchema,
  impact: incidentImpactSchema,
  message: z.string().nullable(),
  started_at: z.number().int().nonnegative(),
  resolved_at: z.number().int().nonnegative().nullable(),
  monitor_ids: z.array(z.number().int().positive()),
  updates: z.array(incidentUpdateSchema),
});

const maintenanceWindowSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  message: z.string().nullable(),
  starts_at: z.number().int().nonnegative(),
  ends_at: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  monitor_ids: z.array(z.number().int().positive()),
});

const uptimeSummarySchema = z.object({
  range_start_at: z.number().int().nonnegative(),
  range_end_at: z.number().int().nonnegative(),
  total_sec: z.number().int().nonnegative(),
  downtime_sec: z.number().int().nonnegative(),
  unknown_sec: z.number().int().nonnegative(),
  uptime_sec: z.number().int().nonnegative(),
  uptime_pct: z.number().min(0).max(100),
});

const uptimeDaySchema = z.object({
  day_start_at: z.number().int().nonnegative(),
  total_sec: z.number().int().nonnegative(),
  downtime_sec: z.number().int().nonnegative(),
  unknown_sec: z.number().int().nonnegative(),
  uptime_sec: z.number().int().nonnegative(),
  uptime_pct: z.number().min(0).max(100).nullable(),
});

const heartbeatSchema = z.object({
  checked_at: z.number().int().nonnegative(),
  status: checkStatusSchema,
  latency_ms: z.number().int().nonnegative().nullable(),
});

const storedPublicMonitorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['http', 'tcp']),
  group_name: z.string().min(1).nullable(),
  group_sort_order: z.number().int(),
  sort_order: z.number().int(),
  status: monitorStatusSchema,
  is_stale: z.boolean(),
  last_checked_at: z.number().int().nonnegative().nullable(),
  last_latency_ms: z.number().int().nonnegative().nullable(),
  public_access: z.boolean().default(false),
  target: z.string().default(''),
  heartbeats: z.array(heartbeatSchema),
  uptime_30d: uptimeSummarySchema.nullable(),
  uptime_days: z.array(uptimeDaySchema),
});

const publicMonitorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['http', 'tcp']),
  group_name: z.string().min(1).nullable(),
  group_sort_order: z.number().int(),
  sort_order: z.number().int(),
  status: monitorStatusSchema,
  is_stale: z.boolean(),
  last_checked_at: z.number().int().nonnegative().nullable(),
  last_latency_ms: z.number().int().nonnegative().nullable(),
  public_access: z.boolean().default(false),
  target: z.string().default(''),

  // 最近 N 次检查（在响应中有数量限制），用于心跳条显示。
  heartbeats: z.array(heartbeatSchema).optional().default([]),

  // 基于每日汇总计算的 30 天可用性（UTC 完整天）。
  uptime_30d: uptimeSummarySchema.nullable(),

  // 30 个每日数据点（从旧到新）。每个条目是该天的总可用时间。
  uptime_days: z.array(uptimeDaySchema),
});

export const publicStatusResponseSchema = z.object({
  generated_at: z.number().int().nonnegative(),
  site_title: z.string().default(''),
  site_description: z.string().default(''),
  site_locale: z.enum(['auto', 'en', 'zh-CN', 'zh-TW']).default('auto'),
  site_timezone: z.string().default('UTC'),
  site_nav_links: z.array(siteNavLinkSchema).default([]),
  overall_status: monitorStatusSchema,
  banner: bannerSchema,
  summary: z.object({
    up: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    maintenance: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  monitors: z.array(publicMonitorSchema),
  active_incidents: z.array(incidentSchema),
  maintenance_windows: z.object({
    active: z.array(maintenanceWindowSchema),
    upcoming: z.array(maintenanceWindowSchema),
  }),
});

export const storedPublicStatusResponseSchema = z.object({
  generated_at: z.number().int().nonnegative(),
  site_title: z.string(),
  site_description: z.string(),
  site_locale: z.enum(['auto', 'en', 'zh-CN', 'zh-TW']),
  site_timezone: z.string(),
  site_nav_links: z.array(siteNavLinkSchema).default([]),
  overall_status: monitorStatusSchema,
  banner: bannerSchema,
  summary: z.object({
    up: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    maintenance: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  monitors: z.array(storedPublicMonitorSchema),
  active_incidents: z.array(incidentSchema),
  maintenance_windows: z.object({
    active: z.array(maintenanceWindowSchema),
    upcoming: z.array(maintenanceWindowSchema),
  }),
});

export type PublicStatusResponse = z.infer<typeof publicStatusResponseSchema>;
