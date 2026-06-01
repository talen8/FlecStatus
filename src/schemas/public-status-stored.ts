import { z } from 'zod';

import type { PublicStatusResponse } from './public-status';
import {
  isInt,
  isNonNegativeInt,
  isNullableNonNegativeInt,
  isNullableString,
  isPercent,
  isPositiveInt,
  isRecord,
  isStringMember,
  validateBanner,
  validateSummary,
} from './shared';

const SITE_LOCALES = new Set(['auto', 'en', 'zh-CN', 'zh-TW']);
const MONITOR_STATUSES = new Set(['up', 'down', 'maintenance', 'paused', 'unknown']);
const CHECK_STATUSES = new Set(['up', 'down', 'maintenance', 'unknown']);
const INCIDENT_STATUSES = new Set(['investigating', 'identified', 'monitoring', 'resolved']);
const INCIDENT_IMPACTS = new Set(['none', 'minor', 'major', 'critical']);

function isNullablePercent(value: unknown): value is number | null {
  return value === null || isPercent(value);
}

function validateIncidentUpdate(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInt(value.id) &&
    isPositiveInt(value.incident_id) &&
    (value.status === null || isStringMember(INCIDENT_STATUSES, value.status)) &&
    typeof value.message === 'string' &&
    isNonNegativeInt(value.created_at)
  );
}

function validateIncident(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInt(value.id) &&
    typeof value.title === 'string' &&
    isStringMember(INCIDENT_STATUSES, value.status) &&
    isStringMember(INCIDENT_IMPACTS, value.impact) &&
    isNullableString(value.message) &&
    isNonNegativeInt(value.started_at) &&
    isNullableNonNegativeInt(value.resolved_at) &&
    Array.isArray(value.monitor_ids) &&
    value.monitor_ids.every(isPositiveInt) &&
    Array.isArray(value.updates) &&
    value.updates.every(validateIncidentUpdate)
  );
}

function validateMaintenanceWindow(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInt(value.id) &&
    typeof value.title === 'string' &&
    isNullableString(value.message) &&
    isNonNegativeInt(value.starts_at) &&
    isNonNegativeInt(value.ends_at) &&
    isNonNegativeInt(value.created_at) &&
    Array.isArray(value.monitor_ids) &&
    value.monitor_ids.every(isPositiveInt)
  );
}

function validateHeartbeat(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonNegativeInt(value.checked_at) &&
    isStringMember(CHECK_STATUSES, value.status) &&
    isNullableNonNegativeInt(value.latency_ms)
  );
}

function validateUptimeSummary(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonNegativeInt(value.range_start_at) &&
    isNonNegativeInt(value.range_end_at) &&
    isNonNegativeInt(value.total_sec) &&
    isNonNegativeInt(value.downtime_sec) &&
    isNonNegativeInt(value.unknown_sec) &&
    isNonNegativeInt(value.uptime_sec) &&
    isPercent(value.uptime_pct)
  );
}

function validateUptimeDay(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonNegativeInt(value.day_start_at) &&
    isNonNegativeInt(value.total_sec) &&
    isNonNegativeInt(value.downtime_sec) &&
    isNonNegativeInt(value.unknown_sec) &&
    isNonNegativeInt(value.uptime_sec) &&
    isNullablePercent(value.uptime_pct)
  );
}

function validateMonitor(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInt(value.id) &&
    typeof value.name === 'string' &&
    (value.type === 'http' || value.type === 'tcp') &&
    (value.group_name === null ||
      (typeof value.group_name === 'string' && value.group_name.length > 0)) &&
    isInt(value.group_sort_order) &&
    isInt(value.sort_order) &&
    isStringMember(MONITOR_STATUSES, value.status) &&
    typeof value.is_stale === 'boolean' &&
    isNullableNonNegativeInt(value.last_checked_at) &&
    isNullableNonNegativeInt(value.last_latency_ms) &&
    Array.isArray(value.heartbeats) &&
    value.heartbeats.every(validateHeartbeat) &&
    validateUptimeSummary(value.uptime_30d) &&
    Array.isArray(value.uptime_days) &&
    value.uptime_days.every(validateUptimeDay)
  );
}

function isStoredPublicStatusResponse(value: unknown): value is PublicStatusResponse {
  if (!isRecord(value)) {
    return false;
  }

  const maintenanceWindows = value.maintenance_windows;
  return (
    isNonNegativeInt(value.generated_at) &&
    typeof value.site_title === 'string' &&
    typeof value.site_description === 'string' &&
    isStringMember(SITE_LOCALES, value.site_locale) &&
    typeof value.site_timezone === 'string' &&
    isStringMember(MONITOR_STATUSES, value.overall_status) &&
    validateBanner(value.banner) &&
    validateSummary(value.summary) &&
    Array.isArray(value.monitors) &&
    value.monitors.every(validateMonitor) &&
    Array.isArray(value.active_incidents) &&
    value.active_incidents.every(validateIncident) &&
    isRecord(maintenanceWindows) &&
    Array.isArray(maintenanceWindows.active) &&
    maintenanceWindows.active.every(validateMaintenanceWindow) &&
    Array.isArray(maintenanceWindows.upcoming) &&
    maintenanceWindows.upcoming.every(validateMaintenanceWindow)
  );
}

export const storedPublicStatusResponseSchema = z.custom<PublicStatusResponse>(
  isStoredPublicStatusResponse,
);
