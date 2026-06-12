import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-access-secret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret",
  clientUrl: process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000",
  allowedOrigins: [
    ...(process.env.CORS_ORIGINS || process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
    process.env.RENDER_EXTERNAL_URL,
  ].filter((origin): origin is string => Boolean(origin)),
  serverUrl: process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:4000",
  rateLimit: {
    useRedis: process.env.RATE_LIMIT_REDIS !== "false",
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "community-images",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@example.com",
  },
  solapi: {
    apiKey: process.env.SOLAPI_API_KEY ?? "",
    apiSecret: process.env.SOLAPI_API_SECRET ?? "",
    senderPhone: process.env.SOLAPI_SENDER_PHONE ?? "",
  },
  nodeEnv: process.env.NODE_ENV ?? "development",
  clientOrigin: process.env.CLIENT_URL ?? "http://localhost:3001",
};
