function normalizeLiteralHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}

// v0.x 基线：
// - 允许任何有效的 TCP 端口（1-65535）
// 注意：这会增加 SSRF/端口扫描滥用的风险。保留下方的主机/IP 封禁规则，并依靠
// 管理员认证 + 速率限制（Cloudflare 层）来提供额外保护。
function isAllowedPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (p.length === 0) return false;
    if (!/^[0-9]+$/.test(p)) return false;
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function ipv4ToInt(host: string): number {
  const parts = host.split('.');
  if (parts.length !== 4) {
    throw new Error('Invalid IPv4 literal');
  }
  const [aStr, bStr, cStr, dStr] = parts as [string, string, string, string];
  const a = Number(aStr);
  const b = Number(bStr);
  const c = Number(cStr);
  const d = Number(dStr);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4InCidr(ip: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

function isBlockedIpv4Int(ip: number): boolean {
  return (
    ipv4InCidr(ip, '0.0.0.0', 8) || // "本机"网络
    ipv4InCidr(ip, '10.0.0.0', 8) ||
    ipv4InCidr(ip, '100.64.0.0', 10) || // 运营商级 NAT
    ipv4InCidr(ip, '127.0.0.0', 8) ||
    ipv4InCidr(ip, '169.254.0.0', 16) || // 链路本地
    ipv4InCidr(ip, '172.16.0.0', 12) ||
    ipv4InCidr(ip, '192.0.0.0', 24) || // IETF 协议分配
    ipv4InCidr(ip, '192.0.2.0', 24) || // 测试网络 1
    ipv4InCidr(ip, '192.168.0.0', 16) ||
    ipv4InCidr(ip, '198.18.0.0', 15) || // 基准测试
    ipv4InCidr(ip, '198.51.100.0', 24) || // 测试网络 2
    ipv4InCidr(ip, '203.0.113.0', 24) || // 测试网络 3
    ipv4InCidr(ip, '224.0.0.0', 4) || // 多播
    ipv4InCidr(ip, '240.0.0.0', 4) // 保留
  );
}

function parseIpv6MappedIpv4(host: string): number | null {
  const lower = normalizeLiteralHost(host).toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;

  const tail = lower.slice('::ffff:'.length);
  if (isIpv4Literal(tail)) {
    return ipv4ToInt(tail);
  }

  // URL 解析器返回的规范映射形式，例如 ::ffff:7f00:1
  const parts = tail.split(':');
  if (parts.length !== 2) return null;
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;

  const hi = Number.parseInt(parts[0] ?? '', 16);
  const lo = Number.parseInt(parts[1] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  const a = (hi >>> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >>> 8) & 0xff;
  const d = lo & 0xff;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isBlockedIpLiteral(host: string): boolean {
  const normalized = normalizeLiteralHost(host);
  const lower = normalized.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') return true;
  if (lower.includes(':')) {
    if (lower.startsWith('fe80:')) return true; // IPv6 链路本地地址
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // IPv6 唯一本地地址（fc00::/7）
  }

  const mappedIpv4 = parseIpv6MappedIpv4(normalized);
  if (mappedIpv4 !== null) {
    return isBlockedIpv4Int(mappedIpv4);
  }

  if (!isIpv4Literal(normalized)) return false;
  return isBlockedIpv4Int(ipv4ToInt(normalized));
}

function normalizeHostForValidation(host: string): string {
  const trimmed = normalizeLiteralHost(host.trim());
  if (!trimmed) return trimmed;

  // 保持 IPv6 字面量不变；URL 解析需要方括号，且可能拒绝我们已处理的简写形式。
  if (trimmed.includes(':')) {
    return trimmed;
  }

  // 在封禁范围检查之前，规范化非标准的 IPv4 表示法（如 127.1 / 0x7f000001）。
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
}

export function validateHttpTarget(target: string): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'target must be a valid URL';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'target protocol must be http or https';
  }

  const hostname = url.hostname;
  if (!hostname) return 'target must include a hostname';
  if (hostname.toLowerCase() === 'localhost') return 'target hostname is not allowed';
  if (isBlockedIpLiteral(hostname)) return 'target hostname is not allowed';

  const port = url.port ? Number(url.port) : url.protocol === 'http:' ? 80 : 443;
  if (!isAllowedPort(port)) return 'target port is not allowed';

  return null;
}

export function parseTcpTarget(target: string): { host: string; port: number } | null {
  const trimmed = target.trim();
  if (trimmed.length === 0) return null;

  // IPv6 格式：[::1]:443
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return null;
    const host = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (!rest.startsWith(':')) return null;
    const port = Number(rest.slice(1));
    if (!isAllowedPort(port)) return null;
    return { host, port };
  }

  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return null;
  const host = trimmed.slice(0, idx);
  if (host.includes(':')) return null; // IPv6 必须使用 [addr]:port 格式
  const port = Number(trimmed.slice(idx + 1));
  if (!isAllowedPort(port)) return null;
  return { host, port };
}

export function validateTcpTarget(target: string): string | null {
  const parsed = parseTcpTarget(target);
  if (!parsed) return 'target must be in host:port format (IPv6: [addr]:port)';

  const host = normalizeHostForValidation(parsed.host);
  if (host.length === 0) return 'target host is required';
  if (host.toLowerCase() === 'localhost') return 'target host is not allowed';
  if (isBlockedIpLiteral(host)) return 'target host is not allowed';

  if (!isAllowedPort(parsed.port)) return 'target port is not allowed';
  return null;
}
