# 세명 인사이드 — 관리자 Part 2 (게시글 · 신고 관리)

> Part 1(회원 관리)에 이어, 커뮤니티 모더레이션 기능을 추가합니다.
> 게시글 숨김/삭제, 신고 접수·처리, 통계 확장.

---

## 0. 변경 요약

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/schema.prisma` | `Post`, `Comment`, `Report` 모델 + enum 추가 |
| 서버 | `server/src/routes/admin.ts` | 게시글/신고 라우트 + 통계 확장 |
| 클라 | `client/src/api/admin.ts` | posts/reports API 추가 |
| 클라 | `client/src/pages/admin/AdminLayout.tsx` | **신규** — 탭 네비 + Outlet |
| 클라 | `client/src/pages/admin/AdminPosts.tsx` | **신규** — 게시글 관리 |
| 클라 | `client/src/pages/admin/AdminReports.tsx` | **신규** — 신고 관리 |
| 클라 | `App.tsx` | 중첩 라우트로 재구성 |

---

## 1. `prisma/schema.prisma` (추가분)

```prisma
enum PostStatus {
  VISIBLE
  HIDDEN
  DELETED
}

enum ReportStatus {
  PENDING
  RESOLVED
  DISMISSED
}

enum ReportTarget {
  POST
  COMMENT
}

model Post {
  id        Int        @id @default(autoincrement())
  board     String     // 게시판 슬러그: free, humor, info ...
  title     String
  content   String
  author    User       @relation("UserPosts", fields: [authorId], references: [id])
  authorId  String
  status    PostStatus @default(VISIBLE)
  views     Int        @default(0)
  likes     Int        @default(0)
  createdAt DateTime   @default(now())

  comments  Comment[]
  reports   Report[]

  @@index([board, status])
  @@index([createdAt])
}

model Comment {
  id        Int        @id @default(autoincrement())
  post      Post       @relation(fields: [postId], references: [id], onDelete: Cascade)
  postId    Int
  author    User       @relation("UserComments", fields: [authorId], references: [id])
  authorId  String
  content   String
  status    PostStatus @default(VISIBLE)
  createdAt DateTime   @default(now())

  @@index([postId])
}

model Report {
  id          String       @id @default(cuid())
  target      ReportTarget
  post        Post?        @relation(fields: [postId], references: [id])
  postId      Int?
  commentId   Int?
  reporter    User         @relation("UserReports", fields: [reporterId], references: [id])
  reporterId  String
  reason      String
  status      ReportStatus @default(PENDING)
  handledById String?
  createdAt   DateTime     @default(now())

  @@index([status])
  @@index([createdAt])
}
```

### `User` 모델에 관계 추가 (Part 1의 User에 이어서)

```prisma
model User {
  // ... 기존 필드 ...
  posts    Post[]    @relation("UserPosts")
  comments Comment[] @relation("UserComments")
  reports  Report[]  @relation("UserReports")
}
```

> 적용: `npx prisma migrate dev -n add_posts_reports`

---

## 2. `server/src/routes/admin.ts` (추가분 — 기존 파일 하단에 이어서)

```ts
// ───────────────────────── 통계 확장 ─────────────────────────
// 기존 /stats 라우트를 아래로 교체 (게시글/신고 수치 추가)
router.get("/stats", async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    total, verified, suspended, todaySignups,
    totalPosts, hiddenPosts, pendingReports,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { phoneVerified: true } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.post.count({ where: { status: { not: "DELETED" } } }),
    prisma.post.count({ where: { status: "HIDDEN" } }),
    prisma.report.count({ where: { status: "PENDING" } }),
  ]);

  res.json({
    total, verified, suspended, todaySignups,
    totalPosts, hiddenPosts, pendingReports,
  });
});

// ───────────────────────── 게시글 관리 ─────────────────────────

// 게시글 목록 (게시판/상태/검색 + 페이지네이션)
router.get("/posts", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Number(req.query.size) || 20);
  const board = String(req.query.board || "").trim();
  const status = String(req.query.status || "").trim();
  const q = String(req.query.q || "").trim();

  const where: any = {};
  if (board) where.board = board;
  if (status) where.status = status;
  if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }];

  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      select: {
        id: true, board: true, title: true, status: true,
        views: true, likes: true, createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { comments: true, reports: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);

  res.json({ page, size, total, items });
});

// 게시글 상태 변경 (숨김/복원/삭제)
router.patch("/posts/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!["VISIBLE", "HIDDEN", "DELETED"].includes(status)) {
    return res.status(400).json({ message: "잘못된 상태값입니다." });
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ message: "게시글을 찾을 수 없습니다." });

  await prisma.post.update({ where: { id }, data: { status } });
  await prisma.adminAuditLog.create({
    data: {
      actorId: req.user!.id,
      action: `POST_${status}`,
      targetId: String(id),
    },
  });

  res.json({ id, status });
});

// ───────────────────────── 신고 관리 ─────────────────────────

// 신고 목록 (상태 필터)
router.get("/reports", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Number(req.query.size) || 20);
  const status = String(req.query.status || "PENDING").trim();

  const where = status ? { status: status as any } : {};

  const [items, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      select: {
        id: true, target: true, postId: true, commentId: true,
        reason: true, status: true, createdAt: true,
        reporter: { select: { nickname: true } },
        post: { select: { id: true, title: true, status: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  res.json({ page, size, total, items });
});

// 신고 처리: 숨김 후 해결 / 유지 후 해결 / 반려
router.patch("/reports/:id", async (req, res) => {
  const { id } = req.params;
  const { action } = req.body ?? {}; // RESOLVE_HIDE | RESOLVE_KEEP | DISMISS

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) return res.status(404).json({ message: "신고를 찾을 수 없습니다." });

  // 신고 대상 게시글 숨김 처리
  if (action === "RESOLVE_HIDE" && report.target === "POST" && report.postId) {
    await prisma.post.update({ where: { id: report.postId }, data: { status: "HIDDEN" } });
  }

  const nextStatus = action === "DISMISS" ? "DISMISSED" : "RESOLVED";
  await prisma.report.update({
    where: { id },
    data: { status: nextStatus, handledById: req.user!.id },
  });

  await prisma.adminAuditLog.create({
    data: { actorId: req.user!.id, action: `REPORT_${action}`, targetId: id },
  });

  res.json({ id, status: nextStatus });
});
```

---

## 3. `client/src/api/admin.ts` (추가분 — 기존 adminApi에 병합)

```ts
export const adminApi = {
  // ... 기존 stats / users / setStatus / remove ...

  // 게시글
  posts: (params: { page?: number; status?: string; board?: string; q?: string }) =>
    api.get("/admin/posts", { params }).then((r) => r.data),

  setPostStatus: (id: number, status: "VISIBLE" | "HIDDEN" | "DELETED") =>
    api.patch(`/admin/posts/${id}/status`, { status }).then((r) => r.data),

  // 신고
  reports: (params: { page?: number; status?: string }) =>
    api.get("/admin/reports", { params }).then((r) => r.data),

  handleReport: (id: string, action: "RESOLVE_HIDE" | "RESOLVE_KEEP" | "DISMISS") =>
    api.patch(`/admin/reports/${id}`, { action }).then((r) => r.data),
};
```

---

## 4. `client/src/pages/admin/AdminLayout.tsx` (신규 — 탭 네비)

```tsx
import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/admin", label: "회원 관리", end: true },
  { to: "/admin/posts", label: "게시글 관리" },
  { to: "/admin/reports", label: "신고 관리" },
];

export default function AdminLayout() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-5">관리자 대시보드</h1>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `px-4 py-2.5 text-sm font-medium -mb-px border-b-2 ${
                isActive
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
```

> 기존 `AdminDashboard.tsx`에서는 최상단 `<h1>관리자 대시보드</h1>` 한 줄만 제거하세요 (레이아웃으로 이동). 통계 카드 + 회원 테이블은 그대로 회원 관리 탭으로 사용됩니다.

---

## 5. `client/src/pages/admin/AdminPosts.tsx` (신규)

```tsx
import { useEffect, useState } from "react";
import { adminApi } from "../../api/admin";

interface PostRow {
  id: number;
  board: string;
  title: string;
  status: "VISIBLE" | "HIDDEN" | "DELETED";
  views: number;
  likes: number;
  createdAt: string;
  author: { nickname: string };
  _count: { comments: number; reports: number };
}

const STATUS_FILTERS = [
  { v: "", label: "전체" },
  { v: "VISIBLE", label: "정상" },
  { v: "HIDDEN", label: "숨김" },
  { v: "DELETED", label: "삭제됨" },
];

export default function AdminPosts() {
  const [items, setItems] = useState<PostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const size = 20;

  const load = async () => {
    const data = await adminApi.posts({ page, status, q });
    setItems(data.items);
    setTotal(data.total);
  };

  useEffect(() => { load(); }, [page, status]);

  const change = async (p: PostRow, next: PostRow["status"]) => {
    const verb = next === "HIDDEN" ? "숨김" : next === "DELETED" ? "삭제" : "복원";
    if (!confirm(`"${p.title}" 게시글을 ${verb} 처리할까요?`)) return;
    await adminApi.setPostStatus(p.id, next);
    load();
  };

  const badge = (s: PostRow["status"]) => {
    const map = {
      VISIBLE: "bg-emerald-50 text-emerald-600",
      HIDDEN: "bg-amber-50 text-amber-600",
      DELETED: "bg-gray-100 text-gray-400",
    } as const;
    const label = { VISIBLE: "정상", HIDDEN: "숨김", DELETED: "삭제" }[s];
    return <span className={`text-xs px-2 py-1 rounded-full ${map[s]}`}>{label}</span>;
  };

  return (
    <div>
      {/* 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => { setPage(1); setStatus(f.v); }}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                status === f.v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())}
          placeholder="제목/내용 검색"
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-indigo-500"
        />
        <button onClick={() => { setPage(1); load(); }} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm">검색</button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">게시판</th>
              <th className="text-left px-4 py-3">제목</th>
              <th className="text-left px-4 py-3">작성자</th>
              <th className="text-center px-4 py-3">신고</th>
              <th className="text-left px-4 py-3">상태</th>
              <th className="text-right px-4 py-3">관리</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-gray-50">
                <td className="px-4 py-3 text-gray-500">{p.board}</td>
                <td className="px-4 py-3 text-gray-900 max-w-xs truncate">{p.title}</td>
                <td className="px-4 py-3 text-gray-600">{p.author.nickname}</td>
                <td className="px-4 py-3 text-center">
                  {p._count.reports > 0
                    ? <span className="text-red-500 font-semibold">{p._count.reports}</span>
                    : <span className="text-gray-300">0</span>}
                </td>
                <td className="px-4 py-3">{badge(p.status)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {p.status === "VISIBLE" && (
                    <button onClick={() => change(p, "HIDDEN")} className="text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 mr-1.5">숨김</button>
                  )}
                  {p.status === "HIDDEN" && (
                    <button onClick={() => change(p, "VISIBLE")} className="text-xs px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 mr-1.5">복원</button>
                  )}
                  {p.status !== "DELETED" && (
                    <button onClick={() => change(p, "DELETED")} className="text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-500">삭제</button>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">게시글이 없습니다.</td></tr>
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

## 6. `client/src/pages/admin/AdminReports.tsx` (신규)

```tsx
import { useEffect, useState } from "react";
import { adminApi } from "../../api/admin";

interface ReportRow {
  id: string;
  target: "POST" | "COMMENT";
  postId: number | null;
  reason: string;
  status: "PENDING" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  reporter: { nickname: string };
  post: { id: number; title: string; status: string } | null;
}

const STATUS_FILTERS = [
  { v: "PENDING", label: "대기" },
  { v: "RESOLVED", label: "처리됨" },
  { v: "DISMISSED", label: "반려" },
];

export default function AdminReports() {
  const [items, setItems] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState("PENDING");

  const load = async () => {
    const data = await adminApi.reports({ status });
    setItems(data.items);
  };

  useEffect(() => { load(); }, [status]);

  const act = async (r: ReportRow, action: "RESOLVE_HIDE" | "RESOLVE_KEEP" | "DISMISS") => {
    const msg = {
      RESOLVE_HIDE: "게시글을 숨기고 신고를 처리할까요?",
      RESOLVE_KEEP: "게시글을 유지하고 신고만 처리할까요?",
      DISMISS: "이 신고를 반려할까요?",
    }[action];
    if (!confirm(msg)) return;
    await adminApi.handleReport(r.id, action);
    load();
  };

  return (
    <div>
      {/* 상태 필터 */}
      <div className="flex gap-1 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setStatus(f.v)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              status === f.v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 신고 카드 리스트 */}
      <div className="space-y-3">
        {items.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600">
                    {r.target === "POST" ? "게시글" : "댓글"}
                  </span>
                  <span className="text-xs text-gray-400">
                    신고자 {r.reporter.nickname} · {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-900 truncate">
                  {r.post ? r.post.title : `#${r.postId ?? r.target}`}
                </div>
                <p className="text-sm text-gray-500 mt-1">사유: {r.reason}</p>
              </div>
            </div>

            {r.status === "PENDING" && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => act(r, "RESOLVE_HIDE")} className="text-xs px-3 py-1.5 rounded-md bg-amber-50 text-amber-600">숨김 후 처리</button>
                <button onClick={() => act(r, "RESOLVE_KEEP")} className="text-xs px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-600">유지 후 처리</button>
                <button onClick={() => act(r, "DISMISS")} className="text-xs px-3 py-1.5 rounded-md bg-gray-100 text-gray-500">반려</button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-100">
            해당 상태의 신고가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 7. `App.tsx` — 중첩 라우트로 재구성

```tsx
import RequireAdmin from "./components/RequireAdmin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard"; // 회원 관리 (index)
import AdminPosts from "./pages/admin/AdminPosts";
import AdminReports from "./pages/admin/AdminReports";

<Route path="/login" element={<LoginPage />} />
<Route path="/register" element={<RegisterPage />} />

<Route
  path="/admin"
  element={<RequireAdmin><AdminLayout /></RequireAdmin>}
>
  <Route index element={<AdminDashboard />} />
  <Route path="posts" element={<AdminPosts />} />
  <Route path="reports" element={<AdminReports />} />
</Route>
```

---

## 적용 순서

1. `schema.prisma`에 `Post`/`Comment`/`Report` + `User` 관계 추가 → `npx prisma migrate dev -n add_posts_reports`
2. `admin.ts`에 게시글/신고 라우트 추가 + `/stats` 교체
3. `api/admin.ts`에 posts/reports 메서드 병합
4. `AdminLayout` / `AdminPosts` / `AdminReports` 추가, `AdminDashboard` 상단 `<h1>` 제거
5. `App.tsx`를 중첩 라우트로 교체
6. `/admin` 접속 → 회원 / 게시글 / 신고 탭으로 전환
