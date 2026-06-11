export type ServerLogLevel = "info" | "warn" | "error" | "security";

export type ServerLogEntry = {
  id: number;
  timestamp: string;
  level: ServerLogLevel;
  source: string;
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  ip?: string;
  userId?: number;
  meta?: Record<string, string | number | boolean | null>;
};

const MAX_LOGS = 500;
const logs: ServerLogEntry[] = [];
let nextId = 1;
let consoleCaptureInstalled = false;

export function appendServerLog(entry: Omit<ServerLogEntry, "id" | "timestamp"> & { timestamp?: string }) {
  const safeEntry: ServerLogEntry = {
    id: nextId++,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level,
    source: entry.source.slice(0, 40),
    message: entry.message.slice(0, 800),
    method: entry.method,
    path: entry.path ? sanitizePath(entry.path) : undefined,
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
    ip: entry.ip ? maskIp(entry.ip) : undefined,
    userId: entry.userId,
    meta: sanitizeMeta(entry.meta),
  };

  logs.unshift(safeEntry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

export function getServerLogs(options: { level?: ServerLogLevel; q?: string; limit?: number }) {
  const keyword = options.q?.trim().toLowerCase();
  const limit = Math.min(Math.max(options.limit ?? 120, 1), MAX_LOGS);

  return logs
    .filter((entry) => !options.level || entry.level === options.level)
    .filter((entry) => {
      if (!keyword) return true;
      return [
        entry.level,
        entry.source,
        entry.message,
        entry.method,
        entry.path,
        String(entry.statusCode ?? ""),
        String(entry.userId ?? ""),
      ].some((value) => value?.toLowerCase().includes(keyword));
    })
    .slice(0, limit);
}

export function installConsoleLogCapture() {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    appendServerLog({ level: "info", source: "console", message: formatConsoleArgs(args) });
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    appendServerLog({ level: "info", source: "console", message: formatConsoleArgs(args) });
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    appendServerLog({ level: "warn", source: "console", message: formatConsoleArgs(args) });
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    appendServerLog({ level: "error", source: "console", message: formatConsoleArgs(args) });
    original.error(...args);
  };
}

function formatConsoleArgs(args: unknown[]) {
  return args.map((arg) => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === "string") return redactSecretText(arg);
    try {
      return redactSecretText(JSON.stringify(arg));
    } catch {
      return String(arg);
    }
  }).join(" ").slice(0, 800);
}

function sanitizeMeta(meta: ServerLogEntry["meta"]) {
  if (!meta) return undefined;
  return Object.fromEntries(
    Object.entries(meta)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, value]) => [key, typeof value === "string" ? redactSecretText(value).slice(0, 200) : value]),
  );
}

function sanitizePath(path: string) {
  try {
    const url = new URL(path, "http://local");
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, "[redacted]");
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return redactSecretText(path).slice(0, 300);
  }
}

function redactSecretText(value: string) {
  return value
    .replace(/(authorization|cookie|password|pass|secret|token|api[_-]?key|service[_-]?role)(["'\s:=]+)[^"'\s,}]+/gi, "$1$2[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}

function isSensitiveKey(key: string) {
  return /(authorization|cookie|password|pass|secret|token|api[_-]?key|service[_-]?role|refresh|access)/i.test(key);
}

function maskIp(ip: string) {
  const forwarded = ip.split(",")[0]?.trim() || ip;
  const ipv4 = forwarded.match(/(\d{1,3}\.){3}\d{1,3}/)?.[0];
  if (ipv4) {
    const parts = ipv4.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (forwarded.includes(":")) return `${forwarded.slice(0, 12)}...`;
  return forwarded.slice(0, 24);
}
