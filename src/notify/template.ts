import type { NotificationEventType } from '../db';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type PathToken = { type: 'prop'; key: string } | { type: 'index'; index: number };

function parsePath(path: string): PathToken[] | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  const tokens: PathToken[] = [];
  let i = 0;

  while (i < trimmed.length) {
    // 跳过前导点号。
    if (trimmed[i] === '.') {
      i++;
      continue;
    }

    // 解析属性名。
    const start = i;
    while (i < trimmed.length && trimmed[i] !== '.' && trimmed[i] !== '[') {
      i++;
    }
    if (i > start) {
      const key = trimmed.slice(start, i);
      if (!key || FORBIDDEN_KEYS.has(key)) return null;
      tokens.push({ type: 'prop', key });
    }

    // 解析可选的 [index] 段。
    while (i < trimmed.length && trimmed[i] === '[') {
      i++; // consume '['
      const idxStart = i;
      while (i < trimmed.length && trimmed[i] !== ']') {
        i++;
      }
      if (i >= trimmed.length) return null;
      const raw = trimmed.slice(idxStart, i).trim();
      i++; // consume ']'
      if (!/^\d+$/.test(raw)) return null;
      const index = Number(raw);
      if (!Number.isInteger(index)) return null;
      tokens.push({ type: 'index', index });
    }

    if (i < trimmed.length && trimmed[i] === '.') {
      i++;
    }
  }

  return tokens.length > 0 ? tokens : null;
}

function resolvePathValue(vars: Record<string, unknown>, path: string): unknown {
  const tokens = parsePath(path);
  if (!tokens) return undefined;

  let cur: unknown = vars;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;

    if (t.type === 'index') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[t.index];
      continue;
    }

    if (typeof cur !== 'object') return undefined;
    const rec = cur as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, t.key)) return undefined;
    cur = rec[t.key];
  }

  return cur;
}

function toTemplateString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function renderStringTemplate(template: string, vars: Record<string, unknown>): string {
  const msg = typeof vars.message === 'string' ? vars.message : '';

  // 兼容旧版：替换 $MSG。
  if (template === '$MSG') return msg;
  const withMsg = msg ? template.split('$MSG').join(msg) : template;

  return withMsg.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, expr: string) => {
    const value = resolvePathValue(vars, expr);
    return toTemplateString(value);
  });
}

export function renderJsonTemplate(
  value: unknown,
  vars: Record<string, unknown>,
  opts: { maxDepth?: number } = {},
): unknown {
  const maxDepth = opts.maxDepth ?? 32;

  function inner(v: unknown, depth: number): unknown {
    if (depth > maxDepth) return null;

    if (typeof v === 'string') {
      return renderStringTemplate(v, vars);
    }
    if (Array.isArray(v)) {
      return v.map((it) => inner(it, depth + 1));
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = inner(vv, depth + 1);
      }
      return out;
    }

    return v;
  }

  return inner(value, 0);
}

function asString(vars: Record<string, unknown>, path: string): string {
  const v = resolvePathValue(vars, path);
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type Locale = 'en' | 'zh-CN' | 'zh-TW';

type MessageMap = {
  'monitor.down': (name: string, target: string, err: string) => string;
  'monitor.up': (name: string, target: string) => string;
  'incident.created': (title: string, impact: string) => string;
  'incident.updated': (title: string, msg: string) => string;
  'incident.resolved': (title: string) => string;
  'maintenance.started': (title: string) => string;
  'maintenance.ended': (title: string) => string;
  'test.ping': () => string;
  default: (ev: string) => string;
};

const messagesByLocale: Record<Locale, MessageMap> = {
  en: {
    'monitor.down': (name, target, err) =>
      `Monitor DOWN: ${name}${target ? ` (${target})` : ''}${err ? `\nError: ${err}` : ''}`,
    'monitor.up': (name, target) =>
      `Monitor UP: ${name}${target ? ` (${target})` : ''}`,
    'incident.created': (title, impact) =>
      `Incident created: ${title}${impact ? ` (impact: ${impact})` : ''}`,
    'incident.updated': (title, msg) =>
      `Incident updated: ${title}${msg ? `\n${msg}` : ''}`,
    'incident.resolved': (title) =>
      `Incident resolved: ${title}`,
    'maintenance.started': (title) =>
      `Maintenance started: ${title}`,
    'maintenance.ended': (title) =>
      `Maintenance ended: ${title}`,
    'test.ping': () => 'FlecStatus test notification',
    default: (ev) => ev ? `FlecStatus event: ${ev}` : 'FlecStatus notification',
  },
  'zh-CN': {
    'monitor.down': (name, target, err) =>
      `监控离线：${name}${target ? `（${target}）` : ''}${err ? `\n错误：${err}` : ''}`,
    'monitor.up': (name, target) =>
      `监控恢复：${name}${target ? `（${target}）` : ''}`,
    'incident.created': (title, impact) =>
      `事件创建：${title}${impact ? `（影响：${impact}）` : ''}`,
    'incident.updated': (title, msg) =>
      `事件更新：${title}${msg ? `\n${msg}` : ''}`,
    'incident.resolved': (title) =>
      `事件已解决：${title}`,
    'maintenance.started': (title) =>
      `维护开始：${title}`,
    'maintenance.ended': (title) =>
      `维护结束：${title}`,
    'test.ping': () => 'FlecStatus 测试通知',
    default: (ev) => ev ? `FlecStatus 事件：${ev}` : 'FlecStatus 通知',
  },
  'zh-TW': {
    'monitor.down': (name, target, err) =>
      `監控離線：${name}${target ? `（${target}）` : ''}${err ? `\n錯誤：${err}` : ''}`,
    'monitor.up': (name, target) =>
      `監控恢復：${name}${target ? `（${target}）` : ''}`,
    'incident.created': (title, impact) =>
      `事件建立：${title}${impact ? `（影響：${impact}）` : ''}`,
    'incident.updated': (title, msg) =>
      `事件更新：${title}${msg ? `\n${msg}` : ''}`,
    'incident.resolved': (title) =>
      `事件已解決：${title}`,
    'maintenance.started': (title) =>
      `維護開始：${title}`,
    'maintenance.ended': (title) =>
      `維護結束：${title}`,
    'test.ping': () => 'FlecStatus 測試通知',
    default: (ev) => ev ? `FlecStatus 事件：${ev}` : 'FlecStatus 通知',
  },
};

export function defaultMessageForEvent(
  eventType: NotificationEventType | string,
  vars: Record<string, unknown>,
  locale?: string,
): string {
  const loc: Locale = locale === 'en' || locale === 'zh-TW' ? locale : 'zh-CN';
  const msgs = messagesByLocale[loc];

  switch (eventType) {
    case 'monitor.down':
      return msgs['monitor.down'](
        asString(vars, 'monitor.name'),
        asString(vars, 'monitor.target'),
        asString(vars, 'state.error'),
      );
    case 'monitor.up':
      return msgs['monitor.up'](
        asString(vars, 'monitor.name'),
        asString(vars, 'monitor.target'),
      );
    case 'incident.created':
      return msgs['incident.created'](
        asString(vars, 'incident.title'),
        asString(vars, 'incident.impact'),
      );
    case 'incident.updated':
      return msgs['incident.updated'](
        asString(vars, 'incident.title'),
        asString(vars, 'update.message'),
      );
    case 'incident.resolved':
      return msgs['incident.resolved'](asString(vars, 'incident.title'));
    case 'maintenance.started':
      return msgs['maintenance.started'](asString(vars, 'maintenance.title'));
    case 'maintenance.ended':
      return msgs['maintenance.ended'](asString(vars, 'maintenance.title'));
    case 'test.ping':
      return msgs['test.ping']();
    default:
      return msgs['default'](asString(vars, 'event'));
  }
}
