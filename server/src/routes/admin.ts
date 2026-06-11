import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { UserRole } from "../../generated/prisma/index.js";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../prisma.js";
import { redis } from "../redis.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createTransporter } from "../utils/mailer.js";
import { appendServerLog, getServerLogs } from "../utils/serverLogs.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole([UserRole.ADMIN, UserRole.MANAGER]));

const banSchema = z.object({
  reason: z.string().trim().min(2).max(200).optional(),
  banUntil: z.string().datetime().optional().nullable(),
});

const roleSchema = z.object({
  role: z.nativeEnum(UserRole),
});

const reportStatusSchema = z.object({
  status: z.enum(["PENDING", "REVIEWED", "DISMISSED"]),
});

const boardCreateSchema = z.object({
  slug: z.string().trim().min(2).max(30).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(30),
  description: z.string().trim().max(200).optional(),
  categoryId: z.number().int().positive(),
  isHot: z.boolean().optional(),
  isAnonymous: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const boardUpdateSchema = boardCreateSchema.partial();

const bannedWordSchema = z.object({
  word: z.string().trim().min(1).max(50),
  level: z.number().int().min(1).max(2).default(1),
});

const serverLogsQuerySchema = z.object({
  level: z.enum(["info", "warn", "error", "security"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(20).max(300).default(120),
});

adminRouter.get(
  "/ops",
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    const [apiCheck, databaseCheck, redisCheck, storageCheck, smtpCheck, solapiCheck, authCheck, securityCheck] = await Promise.all([
      checkApiRuntime(),
      checkDatabase(),
      checkRedis(),
      checkSupabaseStorage(),
      checkSmtp(),
      checkSolapi(),
      checkAuthSecrets(),
      checkSecurityConfig(),
    ]);

    const counts = await getOpsCounts();

    const checks = [apiCheck, databaseCheck, redisCheck, storageCheck, smtpCheck, solapiCheck, authCheck, securityCheck];
    const requiredFailure = checks.some((check) => check.required && check.status === "error");
    const hasWarning = checks.some((check) => check.status !== "ok");

    res.json({
      api: apiCheck.status === "error" ? "error" : "ready",
      database: databaseCheck.status === "error" ? "error" : "ready",
      redis: redisCheck.status === "ok" ? "ready" : "fallback-memory",
      status: requiredFailure ? "error" : hasWarning ? "warn" : "ok",
      durationMs: Date.now() - startedAt,
      checks,
      counts,
      checkedAt: new Date().toISOString(),
    });
  }),
);

adminRouter.get(
  "/logs",
  requireRole([UserRole.ADMIN]),
  asyncHandler(async (req, res) => {
    const query = serverLogsQuerySchema.parse(req.query);
    const logs = getServerLogs(query);
    appendServerLog({
      level: "info",
      source: "admin",
      message: "Server logs viewed in admin console",
      method: req.method,
      path: req.originalUrl,
      statusCode: 200,
      ip: req.ip || req.socket.remoteAddress,
      userId: req.user?.id,
      meta: { level: query.level ?? "all", limit: query.limit, q: query.q ? "filtered" : null },
    });
    res.json({ logs, generatedAt: new Date().toISOString() });
  }),
);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayUsers, todayPosts, pendingReports, totalUsers, totalPosts] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.post.count({ where: { createdAt: { gte: today }, isDeleted: false } }),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.user.count(),
      prisma.post.count({ where: { isDeleted: false } }),
    ]);
    res.json({ todayUsers, todayPosts, pendingReports, totalUsers, totalPosts });
  }),
);

adminRouter.get(
  "/stats/daily",
  asyncHandler(async (_req, res) => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return date;
    });

    const rows = await Promise.all(
      days.map(async (start) => {
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const [users, posts, comments] = await Promise.all([
          prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
          prisma.post.count({ where: { createdAt: { gte: start, lt: end }, isDeleted: false } }),
          prisma.comment.count({ where: { createdAt: { gte: start, lt: end }, isDeleted: false } }),
        ]);
        return {
          date: start.toISOString().slice(0, 10),
          label: new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(start),
          users,
          posts,
          comments,
        };
      }),
    );
    res.json({ rows });
  }),
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const canRevealPersonalData = req.user?.role === UserRole.ADMIN && req.query.reveal === "1";
    const revealReason = String(req.query.reason ?? "").trim().slice(0, 200);
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ username: { contains: q } }, { nickname: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        phone: true,
        carrier: true,
        phoneVerified: true,
        role: true,
        isVerified: true,
        isBanned: true,
        banReason: true,
        banUntil: true,
        level: true,
        exp: true,
        createdAt: true,
      },
    });

    if (canRevealPersonalData) {
      await prisma.adminPrivacyAccessLog.create({
        data: {
          adminId: req.user!.id,
          adminUsername: req.user!.username,
          action: "USER_LIST_REVEAL",
          reason: revealReason || "관리자 회원 목록 원문 확인",
          ip: req.ip,
          userAgent: req.get("user-agent") ?? null,
        },
      });
    }

    res.json({
      users: users.map((user) => ({
        ...user,
        email: canRevealPersonalData ? user.email : maskEmail(user.email),
        phone: canRevealPersonalData ? user.phone : maskPhone(user.phone),
        personalDataMasked: !canRevealPersonalData,
      })),
      canRevealPersonalData: req.user?.role === UserRole.ADMIN,
      personalDataMasked: !canRevealPersonalData,
    });
  }),
);

adminRouter.get(
  "/privacy-logs",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== UserRole.ADMIN) return res.status(403).json({ message: "최고관리자만 확인할 수 있습니다." });
    const logs = await prisma.adminPrivacyAccessLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ logs });
  }),
);

adminRouter.put(
  "/users/:id/ban",
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id) return res.status(400).json({ message: "자기 자신은 정지할 수 없습니다." });

    const input = banSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    if (target.role !== UserRole.USER && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ message: "매니저는 관리자 또는 매니저 계정을 정지할 수 없습니다." });
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: { isBanned: true, banReason: input.reason ?? "관리자에 의해 정지됨", banUntil: input.banUntil ? new Date(input.banUntil) : null },
      select: { id: true, username: true, nickname: true, role: true, isBanned: true, banReason: true, banUntil: true },
    });
    res.json({ user });
  }),
);

adminRouter.put(
  "/users/:id/unban",
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    if (target.role !== UserRole.USER && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ message: "매니저는 관리자 또는 매니저 계정의 정지를 해제할 수 없습니다." });
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: { isBanned: false, banReason: null, banUntil: null },
      select: { id: true, username: true, nickname: true, role: true, isBanned: true, banReason: true, banUntil: true },
    });
    res.json({ user });
  }),
);

adminRouter.put(
  "/users/:id/role",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== UserRole.ADMIN) return res.status(403).json({ message: "최고관리자만 권한을 변경할 수 있습니다." });
    const input = roleSchema.parse(req.body);
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id && input.role !== UserRole.ADMIN) {
      return res.status(400).json({ message: "자기 자신의 최고관리자 권한은 낮출 수 없습니다." });
    }
    const user = await prisma.user.update({
      where: { id: targetId },
      data: { role: input.role },
      select: { id: true, username: true, nickname: true, role: true, isBanned: true },
    });
    res.json({ user });
  }),
);

adminRouter.get(
  "/reports",
  asyncHandler(async (_req, res) => {
    const reports = await prisma.report.findMany({
      take: 100,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        reporter: { select: { id: true, nickname: true } },
        post: { select: { id: true, title: true, board: { select: { slug: true, name: true } } } },
        comment: { select: { id: true, content: true, post: { select: { id: true, title: true, board: { select: { slug: true, name: true } } } } } },
      },
    });
    res.json({ reports });
  }),
);

adminRouter.put(
  "/reports/:id",
  asyncHandler(async (req, res) => {
    const input = reportStatusSchema.parse(req.body);
    const report = await prisma.report.update({ where: { id: Number(req.params.id) }, data: { status: input.status } });
    res.json({ report });
  }),
);

adminRouter.get(
  "/posts",
  asyncHandler(async (_req, res) => {
    const posts = await prisma.post.findMany({
      take: 100,
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: { board: true },
    });
    res.json({ posts });
  }),
);

adminRouter.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const post = await prisma.post.update({ where: { id: Number(req.params.id) }, data: { isDeleted: true } });
    res.json({ post });
  }),
);

adminRouter.put(
  "/posts/:id/pin",
  asyncHandler(async (req, res) => {
    const input = z.object({ isPinned: z.boolean(), isNotice: z.boolean() }).parse(req.body);
    const post = await prisma.post.update({
      where: { id: Number(req.params.id) },
      data: { isPinned: input.isPinned, isNotice: input.isNotice },
    });
    res.json({ post });
  }),
);

adminRouter.get(
  "/boards",
  asyncHandler(async (_req, res) => {
    const [boards, categories] = await Promise.all([
      prisma.board.findMany({ orderBy: { sortOrder: "asc" }, include: { category: true, _count: { select: { posts: true } } } }),
      prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    res.json({ boards, categories });
  }),
);

adminRouter.post(
  "/boards",
  asyncHandler(async (req, res) => {
    const input = boardCreateSchema.parse(req.body);
    const board = await prisma.board.create({ data: input });
    res.status(201).json({ board });
  }),
);

adminRouter.put(
  "/boards/:id",
  asyncHandler(async (req, res) => {
    const input = boardUpdateSchema.parse(req.body);
    const board = await prisma.board.update({ where: { id: Number(req.params.id) }, data: input });
    res.json({ board });
  }),
);

adminRouter.delete(
  "/boards/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const postCount = await prisma.post.count({ where: { boardId: id, isDeleted: false } });
    if (postCount > 0) return res.status(400).json({ message: "게시글이 있는 게시판은 삭제할 수 없습니다." });
    const board = await prisma.board.delete({ where: { id } });
    res.json({ board });
  }),
);

adminRouter.get(
  "/banned-words",
  asyncHandler(async (_req, res) => {
    const words = await prisma.bannedWord.findMany({ orderBy: { id: "desc" } });
    res.json({ words });
  }),
);

adminRouter.post(
  "/banned-words",
  asyncHandler(async (req, res) => {
    const input = bannedWordSchema.parse(req.body);
    const word = await prisma.bannedWord.create({ data: input });
    res.status(201).json({ word });
  }),
);

adminRouter.delete(
  "/banned-words/:id",
  asyncHandler(async (req, res) => {
    const word = await prisma.bannedWord.delete({ where: { id: Number(req.params.id) } });
    res.json({ word });
  }),
);

type OpsCheckStatus = "ok" | "warn" | "error";

type OpsCheck = {
  key: string;
  label: string;
  status: OpsCheckStatus;
  required: boolean;
  message: string;
  latencyMs?: number;
};

async function measureCheck(key: string, label: string, required: boolean, run: () => Promise<Omit<OpsCheck, "key" | "label" | "required" | "latencyMs">>): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    const result = await run();
    return { key, label, required, latencyMs: Date.now() - startedAt, ...result };
  } catch (error) {
    return {
      key,
      label,
      required,
      latencyMs: Date.now() - startedAt,
      status: required ? "error" : "warn",
      message: error instanceof Error ? error.message : "점검 중 오류가 발생했습니다.",
    };
  }
}

async function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 연결 시간이 초과되었습니다.`)), ms);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkApiRuntime() {
  return measureCheck("api", "API 서버", true, async () => {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? memory.heapUsed / memory.heapTotal : 0;
    const uptimeMinutes = Math.floor(process.uptime() / 60);
    return {
      status: heapRatio > 0.9 ? "warn" : "ok",
      message: `프로세스 정상 작동 중 · 가동 ${uptimeMinutes}분 · 메모리 ${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)}MB`,
    };
  });
}

async function checkDatabase() {
  return measureCheck("database", "Database", true, async () => {
    await withTimeout(prisma.$queryRaw`select 1`, 5000, "Database");
    const [users, posts, comments] = await Promise.all([
      prisma.user.count(),
      prisma.post.count({ where: { isDeleted: false } }),
      prisma.comment.count({ where: { isDeleted: false } }),
    ]);
    return {
      status: "ok",
      message: `연결 정상 · 회원 ${users}명 · 게시글 ${posts}개 · 댓글 ${comments}개`,
    };
  });
}

async function checkRedis() {
  return measureCheck("redis", "Redis / 캐시", false, async () => {
    try {
      if (redis.status !== "ready" && redis.status !== "connect") {
        await withTimeout(redis.connect(), 5000, "Redis");
      }
      const key = `ops-check:${Date.now()}`;
      await withTimeout(redis.set(key, "ok", "EX", 30), 5000, "Redis");
      const value = await withTimeout(redis.get(key), 5000, "Redis");
      await redis.del(key).catch(() => undefined);
      if (value !== "ok") throw new Error("Redis 읽기/쓰기 확인에 실패했습니다.");
      return { status: "ok", message: "연결, 읽기, 쓰기 정상" };
    } catch (error) {
      redis.disconnect();
      return {
        status: "warn",
        message: `Redis 연결 실패. 현재 서버 메모리 fallback으로 동작합니다. ${error instanceof Error ? error.message : ""}`.trim(),
      };
    }
  });
}

async function checkSupabaseStorage() {
  return measureCheck("storage", "이미지 저장소", true, async () => {
    const missing = [
      !config.supabase.url ? "SUPABASE_URL" : null,
      !config.supabase.serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      !config.supabase.storageBucket ? "SUPABASE_STORAGE_BUCKET" : null,
    ].filter(Boolean);

    if (missing.length) {
      return { status: "error", message: `필수 환경변수 누락: ${missing.join(", ")}` };
    }

    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await withTimeout(supabase.storage.getBucket(config.supabase.storageBucket), 10000, "Supabase Storage");
    if (error) throw new Error(error.message);
    return { status: "ok", message: `${data.name} 버킷 연결 정상` };
  });
}

async function checkSmtp() {
  return measureCheck("smtp", "SMTP 이메일", false, async () => {
    const missing = [
      !config.smtp.host ? "SMTP_HOST" : null,
      !config.smtp.user ? "SMTP_USER" : null,
      !config.smtp.pass ? "SMTP_PASS" : null,
    ].filter(Boolean);

    if (missing.length) {
      return { status: "warn", message: `비밀번호 재설정/이메일 인증 비활성. 누락: ${missing.join(", ")}` };
    }

    const transporter = createTransporter();
    try {
      await withTimeout(transporter.verify(), 10000, "SMTP");
      return { status: "ok", message: `${config.smtp.host}:${config.smtp.port} 연결 정상` };
    } finally {
      transporter.close();
    }
  });
}

async function checkSolapi() {
  return measureCheck("solapi", "SOLAPI 문자", false, async () => {
    const missing = [
      !config.solapi.apiKey ? "SOLAPI_API_KEY" : null,
      !config.solapi.apiSecret ? "SOLAPI_API_SECRET" : null,
      !config.solapi.senderPhone ? "SOLAPI_SENDER_PHONE" : null,
    ].filter(Boolean);

    if (missing.length) {
      return { status: "warn", message: `휴대폰 인증 문자 비활성. 누락: ${missing.join(", ")}` };
    }

    return {
      status: "ok",
      message: `문자 발송 설정 확인 완료 · 발신번호 ${maskSecret(config.solapi.senderPhone)}`,
    };
  });
}

async function checkAuthSecrets() {
  return measureCheck("auth", "인증/세션 보안", true, async () => {
    const insecure = [
      config.jwtSecret === "dev-access-secret" ? "JWT_SECRET" : null,
      config.jwtRefreshSecret === "dev-refresh-secret" ? "JWT_REFRESH_SECRET" : null,
    ].filter(Boolean);

    if (process.env.NODE_ENV === "production" && insecure.length) {
      return { status: "error", message: `운영환경 기본 시크릿 사용 중: ${insecure.join(", ")}` };
    }

    return { status: insecure.length ? "warn" : "ok", message: insecure.length ? `개발용 기본 시크릿 사용 중: ${insecure.join(", ")}` : "JWT 시크릿 설정 정상" };
  });
}

async function checkSecurityConfig() {
  return measureCheck("security", "보안 설정", true, async () => {
    const warnings = [
      process.env.NODE_ENV === "production" && !config.clientUrl.startsWith("https://") ? "CLIENT_URL이 HTTPS가 아닙니다." : null,
      process.env.NODE_ENV === "production" && !config.serverUrl.startsWith("https://") ? "SERVER_URL이 HTTPS가 아닙니다." : null,
      !config.rateLimit.useRedis ? "Rate limit Redis 저장소가 비활성화되어 있습니다." : null,
    ].filter(Boolean);

    return {
      status: warnings.length ? "warn" : "ok",
      message: warnings.length ? warnings.join(" ") : "HTTPS, CORS, rate limit 기본 설정 정상",
    };
  });
}

async function getOpsCounts() {
  try {
    const [users, posts, comments, pendingReports] = await Promise.all([
      prisma.user.count(),
      prisma.post.count({ where: { isDeleted: false } }),
      prisma.comment.count({ where: { isDeleted: false } }),
      prisma.report.count({ where: { status: "PENDING" } }),
    ]);
    return { users, posts, comments, pendingReports };
  } catch {
    return { users: 0, posts: 0, comments: 0, pendingReports: 0 };
  }
}

function toMb(value: number) {
  return Math.round(value / 1024 / 1024);
}

function maskSecret(value: string) {
  if (!value) return "(empty)";
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return maskMiddle(email);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function maskPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  return maskMiddle(phone);
}

function maskMiddle(value: string) {
  if (value.length <= 2) return `${value.slice(0, 1)}*`;
  return `${value.slice(0, 2)}${"*".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}
