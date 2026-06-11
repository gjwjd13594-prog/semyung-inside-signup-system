import type { RequestHandler } from "express";
import { appendServerLog } from "../utils/serverLogs.js";

const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

const blockedPathPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)\.env($|[/?#])/i, reason: "env-file-probe" },
  { pattern: /(^|\/)\.git($|[/?#])/i, reason: "git-probe" },
  { pattern: /(^|\/)(wp-admin|wp-login|xmlrpc\.php)($|[/?#])/i, reason: "wordpress-probe" },
  { pattern: /(^|\/)(phpmyadmin|pma|adminer)($|[/?#])/i, reason: "db-admin-probe" },
  { pattern: /vendor\/phpunit/i, reason: "phpunit-probe" },
  { pattern: /(^|\/)(config|backup|dump|database)\.(sql|zip|tar|gz|bak)($|[/?#])/i, reason: "backup-file-probe" },
  { pattern: /\/etc\/passwd/i, reason: "system-file-probe" },
  { pattern: /(?:\.\.\/|%2e%2e%2f|%252e%252e%252f)/i, reason: "path-traversal" },
];

const blockedQueryPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script/i, reason: "script-injection" },
  { pattern: /(?:union\s+select|information_schema|sleep\s*\(|benchmark\s*\()/i, reason: "sql-injection-probe" },
  { pattern: /(?:cmd|exec|command|powershell|bash|sh)=/i, reason: "command-injection-probe" },
  { pattern: /(?:base64_decode|eval\s*\(|assert\s*\()/i, reason: "code-execution-probe" },
];

export const firewall: RequestHandler = (req, res, next) => {
  if (!allowedMethods.has(req.method)) {
    block(req, res, "method-not-allowed");
    return;
  }

  if (req.originalUrl.length > 2048) {
    block(req, res, "url-too-long");
    return;
  }

  for (const rule of blockedPathPatterns) {
    if (rule.pattern.test(req.path)) {
      block(req, res, rule.reason);
      return;
    }
  }

  const queryOnly = req.originalUrl.split("?")[1] ?? "";
  if (queryOnly) {
    const decodedQuery = safeDecode(queryOnly);
    for (const rule of blockedQueryPatterns) {
      if (rule.pattern.test(decodedQuery)) {
        block(req, res, rule.reason);
        return;
      }
    }
  }

  next();
};

function block(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], reason: string) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  appendServerLog({
    level: "security",
    source: "firewall",
    message: `Blocked request: ${reason}`,
    method: req.method,
    path: req.originalUrl,
    statusCode: 403,
    ip,
    userId: req.user?.id,
  });
  console.warn(`[firewall] blocked ${reason} ${ip} ${req.method} ${req.originalUrl}`);
  res.status(403).json({ message: "차단된 요청입니다." });
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
