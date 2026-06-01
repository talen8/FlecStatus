import { z } from 'zod';

import {
  bannerSchema,
  incidentImpactSchema,
  incidentStatusSchema,
  monitorStatusSchema,
  siteNavLinkSchema,
} from './shared';

const uptimeSummaryPreviewSchema = z.object({
  uptime_pct: z.number().min(0).max(100),
});

const homepageHeartbeatStripSchema = z.object({
  checked_at: z.array(z.number().int().nonnegative()),
  status_codes: z.string().regex(/^[udmx]*$/),
  latency_ms: z.array(z.number().int().nonnegative().nullable()),
});

const homepageUptimeDayStripSchema = z.object({
  day_start_at: z.array(z.number().int().nonnegative()),
  downtime_sec: z.array(z.number().int().nonnegative()),
  unknown_sec: z.array(z.number().int().nonnegative()),
  uptime_pct_milli: z.array(z.number().int().min(0).max(100_000).nullable()),
});

export const homepageMonitorCardSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['http', 'tcp']),
  group_name: z.string().min(1).nullable(),
  status: monitorStatusSchema,
  is_stale: z.boolean(),
  last_checked_at: z.number().int().nonnegative().nullable(),
  public_access: z.boolean().default(false),
  target: z.string().default(''),
  heartbeat_strip: homepageHeartbeatStripSchema,
  uptime_30d: uptimeSummaryPreviewSchema.nullable(),
  uptime_day_strip: homepageUptimeDayStripSchema,
});

const incidentSummarySchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: incidentStatusSchema,
  impact: incidentImpactSchema,
  message: z.string().nullable(),
  started_at: z.number().int().nonnegative(),
  resolved_at: z.number().int().nonnegative().nullable(),
});

const maintenanceWindowPreviewSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  message: z.string().nullable(),
  starts_at: z.number().int().nonnegative(),
  ends_at: z.number().int().nonnegative(),
  monitor_ids: z.array(z.number().int().positive()),
});

export const publicHomepageResponseSchema = z.object({
  generated_at: z.number().int().nonnegative(),
  bootstrap_mode: z.enum(['full', 'partial']).default('full'),
  monitor_count_total: z.number().int().nonnegative(),
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
  monitors: z.array(homepageMonitorCardSchema),
  active_incidents: z.array(incidentSummarySchema),
  maintenance_windows: z.object({
    active: z.array(maintenanceWindowPreviewSchema),
    upcoming: z.array(maintenanceWindowPreviewSchema),
  }),
  resolved_incident_preview: incidentSummarySchema.nullable(),
  maintenance_history_preview: maintenanceWindowPreviewSchema.nullable(),
});

export const storedPublicHomepageResponseSchema = z.object({
  generated_at: z.number().int().nonnegative(),
  bootstrap_mode: z.enum(['full', 'partial']),
  monitor_count_total: z.number().int().nonnegative(),
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
  monitors: z.array(homepageMonitorCardSchema),
  active_incidents: z.array(incidentSummarySchema),
  maintenance_windows: z.object({
    active: z.array(maintenanceWindowPreviewSchema),
    upcoming: z.array(maintenanceWindowPreviewSchema),
  }),
  resolved_incident_preview: incidentSummarySchema.nullable(),
  maintenance_history_preview: maintenanceWindowPreviewSchema.nullable(),
});

const publicHomepageRenderArtifactBaseSchema = z.object({
  generated_at: z.number().int().nonnegative(),
  preload_html: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
});

export const publicHomepageRenderArtifactSchema = publicHomepageRenderArtifactBaseSchema.extend({
  snapshot: publicHomepageResponseSchema,
});

export const publicHomepageStoredRenderArtifactSchema = z.union([
  publicHomepageRenderArtifactSchema,
  publicHomepageRenderArtifactBaseSchema.extend({
    snapshot_json: z.string().min(1),
  }),
]);

export type PublicHomepageResponse = z.infer<typeof publicHomepageResponseSchema>;
export type HomepageMonitorCard = z.infer<typeof homepageMonitorCardSchema>;
export type PublicHomepageRenderArtifact = z.infer<typeof publicHomepageRenderArtifactSchema>;
export type StoredPublicHomepageRenderArtifact = z.infer<
  typeof publicHomepageStoredRenderArtifactSchema
>;
