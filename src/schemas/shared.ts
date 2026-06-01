import { z } from 'zod';

import { isRecord } from '../snapshots/shared';

// ── 共享枚举 ───────────────────────────────────────────────────────────────

export const monitorStatusSchema = z.enum(['up', 'down', 'maintenance', 'paused', 'unknown']);
export const checkStatusSchema = z.enum(['up', 'down', 'maintenance', 'unknown']);
export const incidentStatusSchema = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);
export const incidentImpactSchema = z.enum(['none', 'minor', 'major', 'critical']);

// ── 共享子 Schema ──────────────────────────────────────────────────────────

export const siteNavLinkSchema = z.object({
  label: z.string().min(1).max(20),
  url: z.string().url(),
});

export const bannerStatusSchema = z.enum([
  'operational',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
]);

export const bannerSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('incident'),
    status: bannerStatusSchema,
    title: z.string(),
    incident: z
      .object({
        id: z.number().int().positive(),
        title: z.string(),
        status: incidentStatusSchema,
        impact: incidentImpactSchema,
      })
      .nullable(),
  }),
  z.object({
    source: z.literal('maintenance'),
    status: bannerStatusSchema,
    title: z.string(),
    maintenance_window: z
      .object({
        id: z.number().int().positive(),
        title: z.string(),
        starts_at: z.number().int().nonnegative(),
        ends_at: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
  z.object({
    source: z.literal('monitors'),
    status: bannerStatusSchema,
    title: z.string(),
    down_ratio: z.number().nullable().optional(),
  }),
]);

// ── 类型守卫（用于 stored 文件的手写运行时验证）────────────────────────────

export { isRecord };

export function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isPositiveInt(value: unknown): value is number {
  return isInt(value) && value > 0;
}

export function isNonNegativeInt(value: unknown): value is number {
  return isInt(value) && value >= 0;
}

export function isNullableNonNegativeInt(value: unknown): value is number | null {
  return value === null || isNonNegativeInt(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

export function isNullableMilliPercent(value: unknown): value is number | null {
  return value === null || (isInt(value) && value >= 0 && value <= 100_000);
}

export function isStringMember(set: ReadonlySet<string>, value: unknown): value is string {
  return typeof value === 'string' && set.has(value);
}

// ── 共享验证辅助 ───────────────────────────────────────────────────────────

const BANNER_STATUSES_SET = new Set(['operational', 'partial_outage', 'major_outage', 'maintenance', 'unknown']);
const INCIDENT_STATUSES_SET = new Set(['investigating', 'identified', 'monitoring', 'resolved']);
const INCIDENT_IMPACTS_SET = new Set(['none', 'minor', 'major', 'critical']);

export function validateBanner(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!isStringMember(BANNER_STATUSES_SET, value.status) || typeof value.title !== 'string') {
    return false;
  }

  if (value.source === 'incident') {
    return (
      value.incident === null ||
      (isRecord(value.incident) &&
        isPositiveInt(value.incident.id) &&
        typeof value.incident.title === 'string' &&
        isStringMember(INCIDENT_STATUSES_SET, value.incident.status) &&
        isStringMember(INCIDENT_IMPACTS_SET, value.incident.impact))
    );
  }

  if (value.source === 'maintenance') {
    return (
      value.maintenance_window === null ||
      (isRecord(value.maintenance_window) &&
        isPositiveInt(value.maintenance_window.id) &&
        typeof value.maintenance_window.title === 'string' &&
        isNonNegativeInt(value.maintenance_window.starts_at) &&
        isNonNegativeInt(value.maintenance_window.ends_at))
    );
  }

  if (value.source === 'monitors') {
    return value.down_ratio === undefined || value.down_ratio === null || typeof value.down_ratio === 'number';
  }

  return false;
}

export function validateSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInt(value.up) &&
    isNonNegativeInt(value.down) &&
    isNonNegativeInt(value.maintenance) &&
    isNonNegativeInt(value.paused) &&
    isNonNegativeInt(value.unknown)
  );
}
