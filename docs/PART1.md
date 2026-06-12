# 세명 인사이드 — 로그인 + 관리자 기능 추가

> 저장소(`semyung-inside-signup-system`)의 구조·API·보안 규칙에 맞춰 작성했습니다.
> 추가/변경되는 파일만 모았고, 기존 회원가입 흐름(bcrypt, httpOnly 쿠키, SOLAPI)은 그대로 유지합니다.

---

## 0. 변경 요약

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/schema.prisma` | `User`에 `role`, `status`, `createdAt`, `lastLoginAt` 추가 + `AdminAuditLog` 모델 |
| 서버 | `server/src/middleware/auth.ts` | `requireAuth` / `requireAdmin` 추가 |
| 서버 | `server/src/routes/auth.ts` | `login` 시 role 포함 토큰 발급, 정지 계정 차단 |
| 서버 | `server/src/routes/admin.ts` | **신규** — 통계 / 회원목록 / 정지·해제 / 삭제 |
| 서버 | `server/src/utils/mask.ts` | **신규** — 전화번호 마스킹 |
| 서버 | `server/prisma/seed.ts` | **신규** — 관리자 계정 시드 |
| 클라 | `client/src/pages/LoginPage.tsx` | **신규/갱신** — 로그인 + 관리자 분기 |
| 클라 | `client/src/api/admin.ts` | **신규** — 관리자 API 클라이언트 |
| 클라 | `client/src/pages/admin/AdminDashboard.tsx` | **신규** — 관리자 대시보드 |
| 클라 | `client/src/components/RequireAdmin.tsx` | **신규** — 관리자 라우트 가드 |
| env | `server/.env.example` | `ADMIN_*` 변수 추가 |

---

## 1. `prisma/schema.prisma` (추가/변경분)

```prisma
enum Role {
  USER
  ADMIN
}

enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  id            String     @id @default(cuid())
  username      String     @unique
  email         String     @unique
  password      String
  nickname      String     @unique
  phone         String     @unique
  carrier       String
  phoneVerified Boolean    @default(false)

  // ▼▼ 관리자 기능을 위해 추가 ▼▼
  role          Role       @default(USER)
  status        UserStatus @default(ACTIVE)
  createdAt     DateTime   @default(now())
  lastLoginAt   DateTime?

  auditLogs     AdminAuditLog[] @relation("AdminActor")
}

// 관리자 작업 감사 로그
model AdminAuditLog {
  id         String   @id @default(cuid())
  actor      User     @relation("AdminActor", fields: [actorId], references: [id])
  actorId    String
  action     String   // e.g. "SUSPEND_USER", "DELETE_USER"
  targetId   String?  // 대상 사용자 id
  memo       String?
  createdAt  DateTime @default(now())

  @@index([actorId])
  @@index([createdAt])
}
```

> 적용: `npx prisma migrate dev -n add_admin_role`

---

## 2. `server/src/utils/mask.ts` (신규)

```ts
// 전화번호 마스킹: 01012345678 -> 010****5678
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

// 이메일 마스킹: abc@semyung.ac.kr -> a**@semyung.ac.kr
export function maskEmail(email: string): string {
  const [id, domain] = email.split("@");
  if (!domain) return "***";
  const head = id.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, id.length - 1))}@${domain}`;
}
```

---

## 3. `server/src/middleware/auth.ts` (추가/변경분)

```ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AuthUser {
  id: string;
  role: "USER" | "ADMIN";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// 로그인 사용자 검증 (httpOnly accessToken 쿠키)
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      sub: string;
      role: "USER" | "ADMIN";
    };
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ message: "세션이 만료되었습니다." });
  }
}

// 관리자 전용 가드
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "관리자 권한이 필요합니다." });
    }
    return next();
  });
}
```

---

## 4. `server/src/routes/auth.ts` — 로그인 부분 (변경분)

> 기존 `register` / `phone/*` / `check-*` 라우트는 그대로 두고, **login**만 role·status 반영하도록 교체합니다.

```ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { config } from "../config";
import { loginLimiter } from "../middleware/rateLimiters";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ... (기존 check-username / check-nickname / phone/send-code / phone/verify-code / register 유지) ...

// 로그인
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ message: "아이디와 비밀번호를 입력해주세요." });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }

  // 정지 계정 차단
  if (user.status === "SUSPENDED") {
    return res.status(403).json({ message: "이용이 정지된 계정입니다. 관리자에게 문의하세요." });
  }

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: "1h" }
  );
  const refreshToken = jwt.sign(
    { sub: user.id, role: user.role },
    config.jwtRefreshSecret,
    { expiresIn: "14d" }
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const secure = config.nodeEnv === "production";
  res
    .cookie("accessToken", accessToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 1000,
    })
    .cookie("refreshToken", refreshToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 14 * 24 * 60 * 60 * 1000,
    })
    .json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role, // ◀ 클라이언트 분기에 사용
      },
    });
});

// 로그아웃
router.post("/logout", (_req, res) => {
  res.clearCookie("accessToken").clearCookie("refreshToken").json({ ok: true });
});

// 내 정보
router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, username: true, nickname: true, role: true, status: true },
  });
  if (!user) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  res.json({ user });
});

export default router;
```

---

## 5. `server/src/routes/admin.ts` (신규)

```ts
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAdmin } from "../middleware/auth";
import { maskPhone, maskEmail } from "../utils/mask";

const router = Router();
router.use(requireAdmin); // 이하 모든 라우트 관리자 전용

// 대시보드 통계
router.get("/stats", async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [total, verified, suspended, todaySignups] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { phoneVerified: true } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
  ]);

  res.json({ total, verified, suspended, todaySignups });
});

// 회원 목록 (검색 + 페이지네이션, 전화번호 마스킹)
router.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Number(req.query.size) || 20);
  const q = String(req.query.q || "").trim();

  const where = q
    ? {
        OR: [
          { username: { contains: q } },
          { nickname: { contains: q } },
          { email: { contains: q } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      select: {
        id: true, username: true, nickname: true, email: true, phone: true,
        carrier: true, role: true, status: true, phoneVerified: true,
        createdAt: true, lastLoginAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    page, size, total,
    items: items.map((u) => ({
      ...u,
      phone: maskPhone(u.phone),   // ◀ 기본 마스킹
      email: maskEmail(u.email),
    })),
  });
});

// 회원 상태 변경 (정지/해제)
router.patch("/users/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ message: "잘못된 상태값입니다." });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "관리자 계정은 변경할 수 없습니다." });
  }

  const updated = await prisma.user.update({ where: { id }, data: { status } });

  await prisma.adminAuditLog.create({
    data: {
      actorId: req.user!.id,
      action: status === "SUSPENDED" ? "SUSPEND_USER" : "ACTIVATE_USER",
      targetId: id,
    },
  });

  res.json({ id: updated.id, status: updated.status });
});

// 회원 삭제
router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "관리자 계정은 삭제할 수 없습니다." });
  }

  await prisma.user.delete({ where: { id } });
  await prisma.adminAuditLog.create({
    data: { actorId: req.user!.id, action: "DELETE_USER", targetId: id },
  });

  res.json({ ok: true });
});

export default router;
```

### 라우터 등록 (`server/src/index.ts` 또는 `app.ts`에 추가)

```ts
import adminRoutes from "./routes/admin";
app.use("/api/admin", adminRoutes);
```

---

## 6. `server/prisma/seed.ts` (신규 — 관리자 계정 생성)

```ts
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL ?? "admin@semyunginside.com";

  if (!username || !password) {
    throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD 환경변수가 필요합니다.");
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { username },
    update: { role: "ADMIN", status: "ACTIVE", password: hashed },
    create: {
      username,
      email,
      password: hashed,
      nickname: "관리자",
      phone: "00000000000",
      carrier: "ADMIN",
      phoneVerified: true,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log(`✅ 관리자 계정 준비 완료: ${username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

### `package.json`에 추가

```json
{
  "prisma": { "seed": "ts-node server/prisma/seed.ts" },
  "scripts": { "seed:admin": "prisma db seed" }
}
```

> 실행: `npm run seed:admin` (비밀번호는 `.env`에서만 읽음 → 코드/깃에 노출 X)

---

## 7. `server/.env.example` (추가분)

```
# 관리자 시드 계정 (운영에서는 강력한 비밀번호 사용)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-strong-password
ADMIN_EMAIL=admin@semyunginside.com
```

---

## 8. `client/src/pages/LoginPage.tsx` (신규/갱신)

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!username || !password) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { username, password });
      setUser(data.user);
      // 관리자면 관리자 페이지로 분기
      navigate(data.user.role === "ADMIN" ? "/admin" : "/");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">세명 인사이드</h1>
        <p className="text-sm text-gray-500 mb-6">로그인</p>

        <label className="block text-sm font-medium text-gray-700 mb-1">아이디</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 mb-4 outline-none focus:border-indigo-500"
          placeholder="아이디"
        />

        <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 mb-4 outline-none focus:border-indigo-500"
          placeholder="비밀번호"
        />

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-60"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        <div className="text-center text-sm text-gray-500 mt-4">
          아직 회원이 아니신가요?{" "}
          <a href="/register" className="text-indigo-600 font-medium">회원가입</a>
        </div>
      </div>
    </div>
  );
}
```

---

## 9. `client/src/store/auth.ts` (참고 — role 포함)

```ts
import { create } from "zustand";

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: "USER" | "ADMIN";
}

interface AuthState {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  isAdmin: () => get().user?.role === "ADMIN",
}));
```

---

## 10. `client/src/api/admin.ts` (신규)

```ts
import { api } from "./client";

export const adminApi = {
  stats: () => api.get("/admin/stats").then((r) => r.data),

  users: (params: { page?: number; size?: number; q?: string }) =>
    api.get("/admin/users", { params }).then((r) => r.data),

  setStatus: (id: string, status: "ACTIVE" | "SUSPENDED") =>
    api.patch(`/admin/users/${id}/status`, { status }).then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/admin/users/${id}`).then((r) => r.data),
};
```

---

## 11. `client/src/components/RequireAdmin.tsx` (신규 — 라우트 가드)

```tsx
import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (user) { setChecked(true); return; }
    api.get("/auth/me")
      .then((r) => setUser(r.data.user))
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="p-10 text-center text-gray-400">확인 중...</div>;
  if (!user || user.role !== "ADMIN") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

### 라우터 등록 (`App.tsx`)

```tsx
import RequireAdmin from "./components/RequireAdmin";
import AdminDashboard from "./pages/admin/AdminDashboard";

<Route path="/login" element={<LoginPage />} />
<Route path="/register" element={<RegisterPage />} />
<Route
  path="/admin"
  element={<RequireAdmin><AdminDashboard /></RequireAdmin>}
/>
```

---

## 12. `client/src/pages/admin/AdminDashboard.tsx` (신규)

```tsx
import { useEffect, useState } from "react";
import { adminApi } from "../../api/admin";

interface UserRow {
  id: string;
  username: string;
  nickname: string;
  email: string;
  phone: string; // 서버에서 마스킹됨
  carrier: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  phoneVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({ total: 0, verified: 0, suspended: 0, todaySignups: 0 });
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const size = 20;

  const load = async () => {
    const [s, u] = await Promise.all([adminApi.stats(), adminApi.users({ page, size, q })]);
    setStats(s);
    setUsers(u.items);
    setTotal(u.total);
  };

  useEffect(() => { load(); }, [page]);

  const toggleStatus = async (u: UserRow) => {
    const next = u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    if (!confirm(`${u.nickname} 님을 ${next === "SUSPENDED" ? "정지" : "정지 해제"}할까요?`)) return;
    await adminApi.setStatus(u.id, next);
    load();
  };

  const removeUser = async (u: UserRow) => {
    if (!confirm(`${u.nickname} 님을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await adminApi.remove(u.id);
    load();
  };

  const cards = [
    { label: "전체 회원", value: stats.total, color: "text-indigo-600" },
    { label: "인증 완료", value: stats.verified, color: "text-emerald-600" },
    { label: "오늘 가입", value: stats.todaySignups, color: "text-blue-600" },
    { label: "정지 계정", value: stats.suspended, color: "text-red-500" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">관리자 대시보드</h1>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-sm text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 검색 */}
      <div className="flex gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())}
          placeholder="아이디 / 닉네임 / 이메일 검색"
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-indigo-500"
        />
        <button onClick={() => { setPage(1); load(); }} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm">검색</button>
      </div>

      {/* 회원 테이블 */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">아이디</th>
              <th className="text-left px-4 py-3">닉네임</th>
              <th className="text-left px-4 py-3">연락처</th>
              <th className="text-left px-4 py-3">통신사</th>
              <th className="text-left px-4 py-3">상태</th>
              <th className="text-right px-4 py-3">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {u.username}
                  {u.role === "ADMIN" && (
                    <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">관리자</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700">{u.nickname}</td>
                <td className="px-4 py-3 text-gray-500">{u.phone}</td>
                <td className="px-4 py-3 text-gray-500">{u.carrier}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    u.status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                  }`}>
                    {u.status === "ACTIVE" ? "정상" : "정지"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {u.role !== "ADMIN" && (
                    <>
                      <button onClick={() => toggleStatus(u)} className="text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 mr-1.5">
                        {u.status === "ACTIVE" ? "정지" : "해제"}
                      </button>
                      <button onClick={() => removeUser(u)} className="text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-500">
                        삭제
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">회원이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex justify-center items-center gap-3 mt-4 text-sm">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">이전</button>
        <span className="text-gray-500">{page} / {Math.max(1, Math.ceil(total / size))}</span>
        <button disabled={page >= Math.ceil(total / size)} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">다음</button>
      </div>
    </div>
  );
}
```

---

## 적용 순서 요약

1. `schema.prisma` 수정 → `npx prisma migrate dev -n add_admin_role`
2. `.env`에 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 추가
3. `server/prisma/seed.ts` 추가 + `package.json` seed 등록 → `npm run seed:admin`
4. 서버: `mask.ts`, `auth.ts`(login), `admin.ts` 반영 + `app.use("/api/admin", adminRoutes)`
5. 클라: `LoginPage`, `admin.ts`, `RequireAdmin`, `AdminDashboard` 추가 + 라우터 등록
6. `admin` 계정으로 로그인 → 자동으로 `/admin` 이동
