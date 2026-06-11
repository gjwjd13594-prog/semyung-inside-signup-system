import type { RequestHandler } from "express";
import { appendServerLog } from "../utils/serverLogs.js";

const ignoredPaths = new Set(["/health", "/ready"]);

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    if (ignoredPaths.has(req.path) || req.originalUrl.startsWith("/api/admin/logs")) return;

    const durationMs = Date.now() - startedAt;
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const shouldLog = req.originalUrl.startsWith("/api/admin") || isMutation || res.statusCode >= 400 || durationMs >= 1000;
    if (!shouldLog) return;

    appendServerLog({
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      source: "http",
      message: `${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
      userId: req.user?.id,
    });
  });

  next();
};
