import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Terminal, XCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, Board, Post } from "../api/client";
import { useAuthStore } from "../store/auth";

type AdminStats = {
  todayUsers: number;
  todayPosts: number;
  pendingReports: number;
  totalUsers: number;
  totalPosts: number;
};

type DailyStatsRow = {
  date: string;
  label: string;
  users: number;
  posts: number;
  comments: number;
};

type AdminOpsCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "error";
  required: boolean;
  message: string;
  latencyMs?: number;
};

type AdminOps = {
  api: "ready" | "error";
  database: "ready" | "error";
  redis: "ready" | "fallback-memory";
  status: "ok" | "warn" | "error";
  durationMs: number;
  checkedAt: string;
  checks: AdminOpsCheck[];
  counts: {
    users: number;
    posts: number;
    comments: number;
    pendingReports: number;
  };
};

type AdminUser = {
  id: number;
  username: string;
  email: string;
  nickname: string;
  phone?: string | null;
  carrier?: string | null;
  phoneVerified?: boolean;
  role: "USER" | "MANAGER" | "ADMIN";
  isBanned: boolean;
  banReason?: string | null;
  banUntil?: string | null;
  level?: number;
  exp?: number;
  createdAt: string;
};

type AdminBoard = Board & {
  categoryId: number;
  category?: { id: number; name: string };
  _count?: { posts: number };
};

type AdminReport = {
  id: number;
  reason: string;
  detail?: string | null;
  status: "PENDING" | "REVIEWED" | "DISMISSED";
  createdAt: string;
  reporter?: { id: number; nickname: string };
  post?: { id: number; title: string; board?: { slug: string; name: string } } | null;
  comment?: { id: number; content: string; post?: { id: number; title: string; board?: { slug: string; name: string } } } | null;
};

type AdminPrivacyLog = {
  id: number;
  adminId: number;
  adminUsername: string;
  action: string;
  targetUserId?: number | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

type AdminServerLog = {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error" | "security";
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

type BannedWord = {
  id: number;
  word: string;
  level: number;
};

type AdminTab = "users" | "posts" | "reports" | "boards" | "bannedWords" | "privacyLogs" | "serverLogs";

export function AdminPage() {
  const { initialized, user } = useAuthStore();
  const [tab, setTab] = useState<AdminTab>("users");
  const isOperator = user?.role === "ADMIN" || user?.role === "MANAGER";

  const stats = useQuery({
    enabled: isOperator,
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get<AdminStats>("/api/admin/stats")).data,
  });

  const dailyStats = useQuery({
    enabled: isOperator,
    queryKey: ["admin-daily-stats"],
    queryFn: async () => (await api.get<{ rows: DailyStatsRow[] }>("/api/admin/stats/daily")).data.rows,
  });

  const ops = useQuery({
    enabled: isOperator,
    queryKey: ["admin-ops"],
    queryFn: async () => (await api.get<AdminOps>("/api/admin/ops")).data,
    refetchInterval: 60000,
  });

  if (!initialized) return <AdminNotice title="확인 중입니다" description="로그인 상태를 확인하고 있습니다." />;
  if (!user) {
    return <AdminNotice title="로그인이 필요합니다" description="관리자 페이지는 로그인 후 사용할 수 있습니다." action={<Link className="rounded bg-brand px-4 py-2 font-black text-white" to="/login">로그인하기</Link>} />;
  }
  if (!isOperator) return <AdminNotice title="관리자 권한이 없습니다" description="이 페이지는 관리자 또는 매니저 계정만 사용할 수 있습니다." />;

  return (
    <section className="space-y-3">
      <div className="panel-soft rounded p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-black text-brand"><ShieldCheck size={18} /> 운영자 콘솔</p>
            <h1 className="mt-1 text-3xl font-black">관리자 대시보드</h1>
            <p className="mt-2 text-sm text-gray-500">회원, 게시글, 신고, 게시판, 금지어를 한 곳에서 관리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-black hover:border-brand hover:text-brand" onClick={() => {
              void stats.refetch();
              void dailyStats.refetch();
              void ops.refetch();
            }} type="button">
              <RefreshCw size={16} /> 새로고침
            </button>
            <Link className="rounded bg-brand px-4 py-2 text-sm font-black text-white" to="/write?board=notice">공지 작성</Link>
            <Link className="rounded border px-4 py-2 text-sm font-black hover:border-brand hover:text-brand" to="/board/notice">공지 보기</Link>
          </div>
        </div>
        {stats.isError ? <ErrorBox message="관리자 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." /> : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="오늘 가입자" value={stats.data?.todayUsers ?? 0} />
          <Stat label="오늘 글" value={stats.data?.todayPosts ?? 0} />
          <Stat label="미처리 신고" value={stats.data?.pendingReports ?? 0} danger={(stats.data?.pendingReports ?? 0) > 0} />
          <Stat label="전체 회원" value={stats.data?.totalUsers ?? 0} />
          <Stat label="전체 글" value={stats.data?.totalPosts ?? 0} />
        </div>
        {dailyStats.data?.length ? <AdminStatsChart rows={dailyStats.data} /> : null}
      </div>

      <AdminOpsPanel isFetching={ops.isFetching} isLoading={ops.isLoading} ops={ops.data} onRefresh={() => void ops.refetch()} />

      <div className="panel-soft rounded p-3">
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "users"} onClick={() => setTab("users")}>회원 관리</TabButton>
          <TabButton active={tab === "posts"} onClick={() => setTab("posts")}>게시글 관리</TabButton>
          <TabButton active={tab === "reports"} onClick={() => setTab("reports")}>신고 관리</TabButton>
          <TabButton active={tab === "boards"} onClick={() => setTab("boards")}>게시판 관리</TabButton>
          <TabButton active={tab === "bannedWords"} onClick={() => setTab("bannedWords")}>금지어 관리</TabButton>
          {user.role === "ADMIN" ? <TabButton active={tab === "serverLogs"} onClick={() => setTab("serverLogs")}>서버 로그</TabButton> : null}
          {user.role === "ADMIN" ? <TabButton active={tab === "privacyLogs"} onClick={() => setTab("privacyLogs")}>개인정보 열람 로그</TabButton> : null}
        </div>
      </div>

      {tab === "users" ? <AdminUsers currentUserRole={user.role} currentUserId={user.id} /> : null}
      {tab === "posts" ? <AdminPosts /> : null}
      {tab === "reports" ? <AdminReports /> : null}
      {tab === "boards" ? <AdminBoards /> : null}
      {tab === "bannedWords" ? <AdminBannedWords /> : null}
      {tab === "serverLogs" && user.role === "ADMIN" ? <AdminServerLogs /> : null}
      {tab === "privacyLogs" && user.role === "ADMIN" ? <AdminPrivacyLogs /> : null}
    </section>
  );
}

function AdminNotice({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
  return (
    <section className="panel-soft rounded bg-white p-6">
      <h1 className="text-2xl font-black">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

function AdminOpsPanel({ isFetching, isLoading, ops, onRefresh }: { isFetching: boolean; isLoading: boolean; ops?: AdminOps; onRefresh: () => void }) {
  const summary = ops?.status ?? "warn";
  return (
    <div className="panel-soft rounded p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black">서버 전체 점검</h2>
          <p className="mt-1 text-sm text-gray-500">API, DB, Redis, 이미지 저장소, 이메일, 문자, 인증/보안 설정을 한 번에 확인합니다.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded bg-gray-900 px-4 py-2 text-sm font-black text-white disabled:bg-gray-300" disabled={isFetching || isLoading} onClick={onRefresh} type="button">
          <RefreshCw className={isFetching ? "animate-spin" : ""} size={16} /> {isFetching ? "점검 중" : "전체 점검"}
        </button>
      </div>

      <div className={`mb-3 rounded border p-3 text-sm font-bold ${summaryTone(summary)}`}>
        {summary === "ok" ? "전체 점검 결과: 정상입니다." : summary === "warn" ? "전체 점검 결과: 주의 항목이 있습니다." : "전체 점검 결과: 즉시 확인이 필요한 오류가 있습니다."}
        {ops ? <span className="ml-2 text-xs font-bold text-gray-500">소요 {ops.durationMs}ms · {new Date(ops.checkedAt).toLocaleString("ko-KR")}</span> : null}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <StatusBadge label="API" status={ops?.api === "ready" ? "ok" : "error"} value={ops?.api ?? "확인 중"} />
        <StatusBadge label="Database" status={ops?.database === "ready" ? "ok" : "error"} value={ops?.database ?? "확인 중"} />
        <StatusBadge label="Redis" status={ops?.redis === "ready" ? "ok" : "warn"} value={ops?.redis === "ready" ? "ready" : "memory fallback"} />
        <StatusBadge label="미처리 신고" status={(ops?.counts.pendingReports ?? 0) === 0 ? "ok" : "warn"} value={`${ops?.counts.pendingReports ?? 0}건`} />
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {(ops?.checks ?? []).map((check) => (
          <OpsCheckCard check={check} key={check.key} />
        ))}
      </div>
    </div>
  );
}

function OpsCheckCard({ check }: { check: AdminOpsCheck }) {
  const Icon = check.status === "ok" ? CheckCircle2 : check.status === "warn" ? AlertTriangle : XCircle;
  return (
    <div className={`rounded border p-3 ${summaryTone(check.status)}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 shrink-0" size={18} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black">{check.label}</p>
            <span className="rounded bg-white/70 px-2 py-0.5 text-[11px] font-black">{check.required ? "필수" : "선택"}</span>
            {typeof check.latencyMs === "number" ? <span className="text-xs text-gray-500">{check.latencyMs}ms</span> : null}
          </div>
          <p className="mt-1 text-sm leading-5">{check.message}</p>
        </div>
      </div>
    </div>
  );
}

function AdminStatsChart({ rows }: { rows: DailyStatsRow[] }) {
  const max = Math.max(...rows.flatMap((row) => [row.users, row.posts, row.comments]), 1);
  return (
    <div className="mt-5 rounded border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black">최근 7일 활동</h2>
        <p className="text-xs font-bold text-gray-500">가입 / 글 / 댓글</p>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {rows.map((row) => (
          <div className="flex min-h-40 flex-col justify-end gap-1" key={row.date}>
            <div className="flex flex-1 items-end justify-center gap-1">
              <Bar color="bg-green-500" max={max} value={row.users} />
              <Bar color="bg-brand" max={max} value={row.posts} />
              <Bar color="bg-blue-500" max={max} value={row.comments} />
            </div>
            <p className="truncate text-center text-[11px] font-bold text-gray-500">{row.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminUsers({ currentUserId, currentUserRole }: { currentUserId: number; currentUserRole: "USER" | "MANAGER" | "ADMIN" }) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [revealPersonalData, setRevealPersonalData] = useState(false);
  const [revealReason, setRevealReason] = useState("");
  const [message, setMessage] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin-users", submittedKeyword, revealPersonalData, revealReason],
    queryFn: async () => (await api.get<{ users: AdminUser[]; canRevealPersonalData: boolean; personalDataMasked: boolean }>("/api/admin/users", {
      params: { q: submittedKeyword, reveal: revealPersonalData ? "1" : undefined, reason: revealPersonalData ? revealReason : undefined },
    })).data,
  });
  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: AdminUser["role"] }) => api.put(`/api/admin/users/${id}/role`, { role }),
    onSuccess: () => {
      setMessage("회원 권한을 변경했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => setMessage("권한 변경에 실패했습니다. 최고관리자 권한이 필요할 수 있습니다."),
  });
  const banMutation = useMutation({
    mutationFn: ({ id, banned, reason }: { id: number; banned: boolean; reason?: string }) => banned ? api.put(`/api/admin/users/${id}/unban`) : api.put(`/api/admin/users/${id}/ban`, { reason: reason || "관리자에 의해 정지됨" }),
    onSuccess: () => {
      setMessage("회원 상태를 변경했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => setMessage("회원 상태 변경에 실패했습니다. 본인 또는 상위 권한 계정은 제한될 수 있습니다."),
  });

  const users = usersQuery.data?.users ?? [];

  return (
    <div className="panel-soft rounded p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black">회원 관리</h2>
          <p className="mt-1 text-sm text-gray-500">회원 검색, 권한 변경, 정지/해제를 처리합니다.</p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
          event.preventDefault();
          setSubmittedKeyword(keyword.trim());
        }}>
          <input className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setKeyword(event.target.value)} placeholder="아이디, 닉네임, 이메일, 전화번호 검색" value={keyword} />
          <button className="rounded bg-gray-900 px-4 font-bold text-white" type="submit">검색</button>
          {submittedKeyword ? <button className="rounded border px-3 font-bold" onClick={() => {
            setKeyword("");
            setSubmittedKeyword("");
          }} type="button">초기화</button> : null}
        </form>
      </div>
      <PrivacyRevealBox
        canReveal={Boolean(usersQuery.data?.canRevealPersonalData)}
        reveal={revealPersonalData}
        onToggle={() => {
          if (revealPersonalData) {
            setRevealPersonalData(false);
            setRevealReason("");
            return;
          }
          const reason = prompt("회원 이메일과 휴대폰 원문을 확인하는 사유를 입력해 주세요.");
          if (!reason?.trim()) return;
          if (!confirm("개인정보 원문을 표시합니다. 꼭 필요한 경우에만 확인해 주세요.")) return;
          setRevealReason(reason.trim());
          setRevealPersonalData(true);
        }}
      />
      {message ? <InfoBox message={message} /> : null}
      {usersQuery.isError ? <ErrorBox message="회원 목록을 불러오지 못했습니다." /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">ID</th>
              <th className="p-2">아이디</th>
              <th className="p-2">닉네임</th>
              <th className="p-2">이메일</th>
              <th className="p-2">전화번호</th>
              <th className="p-2">등급</th>
              <th className="p-2">권한</th>
              <th className="p-2">상태</th>
              <th className="p-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((member) => {
              const canChangeRole = currentUserRole === "ADMIN" && member.id !== currentUserId;
              return (
                <tr className="border-b bg-white" key={member.id}>
                  <td className="p-2 text-center">{member.id}</td>
                  <td className="p-2 font-bold">{member.username}</td>
                  <td className="p-2">{member.nickname}</td>
                  <td className="p-2">{member.email}</td>
                  <td className="p-2">
                    <div className="font-bold">{formatPhone(member.phone)}</div>
                    <div className="text-xs text-gray-500">{member.phone ? `${carrierLabel(member.carrier)} · ${member.phoneVerified ? "인증완료" : "미인증"}` : "등록 없음"}</div>
                  </td>
                  <td className="p-2 text-center">Lv.{member.level ?? 1}<br /><span className="text-xs text-gray-500">{member.exp ?? 0} EXP</span></td>
                  <td className="p-2">
                    <select
                      className="rounded border border-gray-300 bg-white px-2 py-1 disabled:bg-gray-100"
                      disabled={!canChangeRole || roleMutation.isPending}
                      onChange={(event) => {
                        if (confirm(`${member.nickname} 회원의 권한을 ${event.target.value}(으)로 변경할까요?`)) {
                          roleMutation.mutate({ id: member.id, role: event.target.value as AdminUser["role"] });
                        }
                      }}
                      value={member.role}
                    >
                      <option value="USER">USER</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td className="p-2 text-center">
                    <span className={`rounded px-2 py-1 text-xs font-black ${member.isBanned ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{member.isBanned ? "정지" : "정상"}</span>
                    {member.banReason ? <p className="mt-1 text-xs text-gray-500">{member.banReason}</p> : null}
                  </td>
                  <td className="p-2 text-center">
                    <button className="rounded bg-gray-900 px-3 py-1 font-bold text-white disabled:bg-gray-300" disabled={member.id === currentUserId || banMutation.isPending} onClick={() => {
                      if (member.isBanned) {
                        if (confirm(`${member.nickname} 회원의 정지를 해제할까요?`)) banMutation.mutate({ id: member.id, banned: true });
                        return;
                      }
                      const reason = prompt("정지 사유를 입력해 주세요.", "운영정책 위반");
                      if (!reason) return;
                      banMutation.mutate({ id: member.id, banned: false, reason });
                    }} type="button">
                      {member.isBanned ? "해제" : "정지"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!users.length ? <p className="p-4 text-sm text-gray-500">표시할 회원이 없습니다.</p> : null}
      </div>
    </div>
  );
}

function AdminPosts() {
  const queryClient = useQueryClient();
  const postsQuery = useQuery({ queryKey: ["admin-posts"], queryFn: async () => (await api.get<{ posts: Post[] }>("/api/admin/posts")).data.posts });
  const pinMutation = useMutation({
    mutationFn: (post: Post) => api.put(`/api/admin/posts/${post.id}/pin`, { isPinned: !post.isPinned, isNotice: !post.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/posts/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-posts"] }),
  });

  return (
    <div className="panel-soft rounded p-4">
      <h2 className="mb-3 text-lg font-black">게시글 관리</h2>
      {postsQuery.isError ? <ErrorBox message="게시글 목록을 불러오지 못했습니다." /> : null}
      <div className="space-y-2">
        {postsQuery.data?.map((post) => (
          <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-3" key={post.id}>
            <Link className="min-w-0 flex-1 truncate font-bold hover:text-brand" to={`/board/${post.board?.slug ?? "free"}/${post.id}`}>{post.title}</Link>
            <span className="text-xs text-gray-500">{post.board?.name} · {post.authorNick} · 조회 {post.viewCount}</span>
            <button className="rounded bg-brand px-3 py-1 font-bold text-white disabled:bg-gray-300" disabled={pinMutation.isPending} onClick={() => pinMutation.mutate(post)} type="button">
              {post.isPinned ? "공지 해제" : "공지 고정"}
            </button>
            <button className="rounded bg-red-600 px-3 py-1 font-bold text-white disabled:bg-gray-300" disabled={deleteMutation.isPending} onClick={() => {
              if (confirm("정말 삭제하시겠습니까?")) deleteMutation.mutate(post.id);
            }} type="button">삭제</button>
          </div>
        ))}
        {!postsQuery.data?.length ? <p className="text-sm text-gray-500">게시글이 없습니다.</p> : null}
      </div>
    </div>
  );
}

function AdminReports() {
  const queryClient = useQueryClient();
  const reportsQuery = useQuery({ queryKey: ["admin-reports"], queryFn: async () => (await api.get<{ reports: AdminReport[] }>("/api/admin/reports")).data.reports });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: AdminReport["status"] }) => api.put(`/api/admin/reports/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-ops"] });
    },
  });

  return (
    <div className="panel-soft rounded p-4">
      <h2 className="mb-3 text-lg font-black">신고 관리</h2>
      {reportsQuery.isError ? <ErrorBox message="신고 목록을 불러오지 못했습니다." /> : null}
      <div className="space-y-2">
        {reportsQuery.data?.map((report) => {
          const targetPost = report.post ?? report.comment?.post;
          return (
            <div className="rounded border border-gray-200 bg-white p-3" key={report.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black">{report.post ? "게시글 신고" : "댓글 신고"} <span className="text-xs text-gray-500">#{report.id}</span></p>
                <span className={`rounded px-2 py-1 text-xs font-black ${report.status === "PENDING" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>{reportStatusLabel(report.status)}</span>
              </div>
              <p className="mt-2 text-sm text-gray-600">신고자: {report.reporter?.nickname ?? "알 수 없음"} · 사유: {reportReasonLabel(report.reason)} · {new Date(report.createdAt).toLocaleString("ko-KR")}</p>
              {report.detail ? <p className="mt-1 rounded bg-gray-50 p-2 text-sm">{report.detail}</p> : null}
              {report.comment ? <p className="mt-2 line-clamp-2 text-sm text-gray-700">댓글: {report.comment.content}</p> : null}
              {targetPost ? <Link className="mt-2 inline-flex text-sm font-bold text-brand" to={`/board/${targetPost.board?.slug ?? "free"}/${targetPost.id}`}>원문 보기: {targetPost.title}</Link> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded bg-brand px-3 py-1 font-bold text-white disabled:bg-gray-300" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: report.id, status: "REVIEWED" })} type="button">처리 완료</button>
                <button className="rounded bg-gray-800 px-3 py-1 font-bold text-white disabled:bg-gray-300" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: report.id, status: "DISMISSED" })} type="button">기각</button>
              </div>
            </div>
          );
        })}
        {!reportsQuery.data?.length ? <p className="text-sm text-gray-500">접수된 신고가 없습니다.</p> : null}
      </div>
    </div>
  );
}

function AdminBoards() {
  const queryClient = useQueryClient();
  const boardsQuery = useQuery({ queryKey: ["admin-boards"], queryFn: async () => (await api.get<{ boards: AdminBoard[]; categories: { id: number; name: string }[] }>("/api/admin/boards")).data });
  const [form, setForm] = useState({ slug: "", name: "", description: "" });
  const createMutation = useMutation({
    mutationFn: () => api.post("/api/admin/boards", {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      categoryId: boardsQuery.data?.categories[0]?.id ?? 1,
      isHot: false,
      isAnonymous: false,
      sortOrder: (boardsQuery.data?.boards.length ?? 0) + 1,
    }),
    onSuccess: () => {
      setForm({ slug: "", name: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["admin-boards"] });
      void queryClient.invalidateQueries({ queryKey: ["boards"] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.slug.trim() || !form.name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="panel-soft rounded p-4">
      <h2 className="mb-3 text-lg font-black">게시판 관리</h2>
      {boardsQuery.isError ? <ErrorBox message="게시판 목록을 불러오지 못했습니다." /> : null}
      <form className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={submit}>
        <input className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder="주소 slug 예: free" value={form.slug} />
        <input className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="게시판 이름" value={form.name} />
        <input className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="설명" value={form.description} />
        <button className="rounded bg-brand px-4 font-black text-white disabled:bg-gray-300" disabled={createMutation.isPending} type="submit">추가</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {boardsQuery.data?.boards.map((board) => (
          <div className="rounded border border-gray-200 bg-white p-3" key={board.id}>
            <p className="font-black">{board.name} <span className="text-xs text-gray-500">/{board.slug}</span></p>
            <p className="text-sm text-gray-500">{board.description}</p>
            <p className="mt-1 text-xs text-gray-500">글 {board._count?.posts ?? 0}개 · {board.category?.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminServerLogs() {
  const [level, setLevel] = useState<AdminServerLog["level"] | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const logsQuery = useQuery({
    queryKey: ["admin-server-logs", level, submittedKeyword],
    queryFn: async () => (await api.get<{ logs: AdminServerLog[]; generatedAt: string }>("/api/admin/logs", {
      params: {
        limit: 160,
        level: level === "all" ? undefined : level,
        q: submittedKeyword || undefined,
      },
    })).data,
    refetchInterval: 15000,
  });

  return (
    <div className="panel-soft rounded p-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black"><Terminal size={18} /> 서버 로그</h2>
          <p className="mt-1 text-sm text-gray-500">최근 서버 요청, 오류, 방화벽 차단, 관리자 작업 로그를 확인합니다. 비밀번호, 토큰, 쿠키는 저장하지 않습니다.</p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
          event.preventDefault();
          setSubmittedKeyword(keyword.trim());
        }}>
          <select className="h-10 rounded border border-gray-300 bg-white px-3 font-bold" onChange={(event) => setLevel(event.target.value as AdminServerLog["level"] | "all")} value={level}>
            <option value="all">전체</option>
            <option value="info">정보</option>
            <option value="warn">주의</option>
            <option value="error">오류</option>
            <option value="security">보안</option>
          </select>
          <input className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setKeyword(event.target.value)} placeholder="검색어" value={keyword} />
          <button className="rounded bg-gray-900 px-4 font-bold text-white" type="submit">검색</button>
          <button className="inline-flex items-center justify-center gap-2 rounded border px-4 font-bold hover:border-brand hover:text-brand" onClick={() => void logsQuery.refetch()} type="button">
            <RefreshCw className={logsQuery.isFetching ? "animate-spin" : ""} size={16} /> 새로고침
          </button>
        </form>
      </div>

      {logsQuery.isError ? <ErrorBox message="서버 로그를 불러오지 못했습니다." /> : null}
      {logsQuery.data?.generatedAt ? <p className="mb-3 text-xs font-bold text-gray-500">마지막 갱신: {new Date(logsQuery.data.generatedAt).toLocaleString("ko-KR")}</p> : null}

      <div className="space-y-2">
        {logsQuery.data?.logs.map((log) => (
          <div className={`rounded border bg-white p-3 ${logBorderTone(log.level)}`} key={log.id}>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-1 text-xs font-black ${logBadgeTone(log.level)}`}>{logLevelLabel(log.level)}</span>
                  <span className="text-xs font-bold text-gray-500">{log.source}</span>
                  <span className="text-xs text-gray-400">#{log.id}</span>
                  {log.userId ? <span className="text-xs text-gray-500">user #{log.userId}</span> : null}
                  {log.ip ? <span className="text-xs text-gray-500">{log.ip}</span> : null}
                </div>
                <p className="mt-2 break-words text-sm font-bold text-gray-900">{log.message}</p>
                {log.path ? (
                  <p className="mt-1 break-all text-xs text-gray-500">
                    {log.method ? `${log.method} ` : ""}{log.path}
                    {typeof log.statusCode === "number" ? ` · ${log.statusCode}` : ""}
                    {typeof log.durationMs === "number" ? ` · ${log.durationMs}ms` : ""}
                  </p>
                ) : null}
                {log.meta && Object.keys(log.meta).length ? <p className="mt-1 break-all text-xs text-gray-400">{formatMeta(log.meta)}</p> : null}
              </div>
              <time className="shrink-0 text-xs font-bold text-gray-500">{new Date(log.timestamp).toLocaleString("ko-KR")}</time>
            </div>
          </div>
        ))}
        {!logsQuery.data?.logs.length ? <p className="rounded border border-gray-200 bg-white p-5 text-center text-sm text-gray-500">표시할 서버 로그가 없습니다.</p> : null}
      </div>
    </div>
  );
}

function AdminPrivacyLogs() {
  const logsQuery = useQuery({
    queryKey: ["admin-privacy-logs"],
    queryFn: async () => (await api.get<{ logs: AdminPrivacyLog[] }>("/api/admin/privacy-logs")).data.logs,
  });

  return (
    <div className="panel-soft rounded p-4">
      <div className="mb-3">
        <h2 className="text-lg font-black">개인정보 열람 로그</h2>
        <p className="mt-1 text-sm text-gray-500">관리자가 회원 이메일/휴대폰 원문을 확인한 기록입니다.</p>
      </div>
      {logsQuery.isError ? <ErrorBox message="개인정보 열람 로그를 불러오지 못했습니다." /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">일시</th>
              <th className="p-2">관리자</th>
              <th className="p-2">동작</th>
              <th className="p-2">사유</th>
              <th className="p-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {logsQuery.data?.map((log) => (
              <tr className="border-b bg-white" key={log.id}>
                <td className="p-2">{new Date(log.createdAt).toLocaleString("ko-KR")}</td>
                <td className="p-2">{log.adminUsername} #{log.adminId}</td>
                <td className="p-2">{log.action}</td>
                <td className="p-2">{log.reason ?? "-"}</td>
                <td className="p-2">{log.ip ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!logsQuery.data?.length ? <p className="p-4 text-sm text-gray-500">아직 열람 기록이 없습니다.</p> : null}
      </div>
    </div>
  );
}

function AdminBannedWords() {
  const queryClient = useQueryClient();
  const [word, setWord] = useState("");
  const [level, setLevel] = useState(1);
  const wordsQuery = useQuery({ queryKey: ["admin-banned-words"], queryFn: async () => (await api.get<{ words: BannedWord[] }>("/api/admin/banned-words")).data.words });
  const createMutation = useMutation({
    mutationFn: () => api.post("/api/admin/banned-words", { word: word.trim(), level }),
    onSuccess: () => {
      setWord("");
      setLevel(1);
      void queryClient.invalidateQueries({ queryKey: ["admin-banned-words"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/banned-words/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-banned-words"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!word.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="panel-soft rounded p-4">
      <h2 className="mb-3 text-lg font-black">금지어 관리</h2>
      {wordsQuery.isError ? <ErrorBox message="금지어 목록을 불러오지 못했습니다." /> : null}
      <form className="mb-4 flex flex-col gap-2 md:flex-row" onSubmit={submit}>
        <input className="h-10 flex-1 rounded border border-gray-300 bg-white px-3" onChange={(event) => setWord(event.target.value)} placeholder="금지어 입력" value={word} />
        <select className="h-10 rounded border border-gray-300 bg-white px-3" onChange={(event) => setLevel(Number(event.target.value))} value={level}>
          <option value={1}>경고</option>
          <option value={2}>자동 삭제 대상</option>
        </select>
        <button className="rounded bg-brand px-4 font-black text-white disabled:bg-gray-300" disabled={createMutation.isPending} type="submit">추가</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {wordsQuery.data?.map((item) => (
          <div className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white p-3" key={item.id}>
            <p className="font-black">{item.word} <span className="text-xs text-gray-500">레벨 {item.level}</span></p>
            <button className="rounded bg-red-600 px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(item.id)} type="button">삭제</button>
          </div>
        ))}
        {!wordsQuery.data?.length ? <p className="text-sm text-gray-500">등록된 금지어가 없습니다.</p> : null}
      </div>
    </div>
  );
}

function PrivacyRevealBox({ canReveal, onToggle, reveal }: { canReveal: boolean; onToggle: () => void; reveal: boolean }) {
  return (
    <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p>개인정보 보호를 위해 이메일과 휴대폰 번호는 기본적으로 마스킹됩니다.</p>
        {canReveal ? <button className="rounded bg-gray-900 px-3 py-2 text-white" onClick={onToggle} type="button">{reveal ? "개인정보 숨기기" : "관리자 원문 확인"}</button> : null}
      </div>
    </div>
  );
}

function StatusBadge({ label, status, value }: { label: string; status: AdminOpsCheck["status"]; value: string }) {
  return (
    <div className={`rounded border p-3 ${summaryTone(status)}`}>
      <p className="text-xs font-black">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return <button className={`rounded px-4 py-2 font-bold ${active ? "bg-brand text-white" : "bg-gray-100 hover:bg-gray-200"}`} onClick={onClick} type="button">{children}</button>;
}

function Stat({ danger = false, label, value }: { danger?: boolean; label: string; value: number }) {
  return (
    <div className={`rounded border bg-white p-4 shadow-sm ${danger ? "border-red-200" : "border-gray-200"}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-black ${danger ? "text-red-600" : "text-gray-950"}`}>{formatNumber(value)}</p>
    </div>
  );
}

function Bar({ color, max, value }: { color: string; max: number; value: number }) {
  return <div className={`w-3 rounded-t ${color}`} style={{ height: `${Math.max(4, (value / max) * 110)}px` }} title={String(value)} />;
}

function ErrorBox({ message }: { message: string }) {
  return <p className="my-3 flex items-center gap-2 rounded bg-red-50 p-3 text-sm font-bold text-red-700"><AlertTriangle size={16} /> {message}</p>;
}

function InfoBox({ message }: { message: string }) {
  return <p className="my-3 flex items-center gap-2 rounded bg-green-50 p-3 text-sm font-bold text-green-700"><CheckCircle2 size={16} /> {message}</p>;
}

function summaryTone(status: AdminOpsCheck["status"]) {
  if (status === "ok") return "border-green-200 bg-green-50 text-green-800";
  if (status === "warn") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-800";
}

function logLevelLabel(level: AdminServerLog["level"]) {
  const labels = {
    info: "정보",
    warn: "주의",
    error: "오류",
    security: "보안",
  };
  return labels[level];
}

function logBadgeTone(level: AdminServerLog["level"]) {
  if (level === "error") return "bg-red-100 text-red-700";
  if (level === "warn") return "bg-amber-100 text-amber-800";
  if (level === "security") return "bg-purple-100 text-purple-700";
  return "bg-blue-100 text-blue-700";
}

function logBorderTone(level: AdminServerLog["level"]) {
  if (level === "error") return "border-red-200";
  if (level === "warn") return "border-amber-200";
  if (level === "security") return "border-purple-200";
  return "border-gray-200";
}

function formatMeta(meta: AdminServerLog["meta"]) {
  if (!meta) return "";
  return Object.entries(meta).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPhone(phone?: string | null) {
  if (!phone) return "-";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return phone;
}

function carrierLabel(carrier?: string | null) {
  const labels: Record<string, string> = {
    SKT: "SKT",
    KT: "KT",
    LGU: "LG U+",
    SKT_MVNO: "SKT 알뜰폰",
    KT_MVNO: "KT 알뜰폰",
    LGU_MVNO: "LG U+ 알뜰폰",
  };
  return carrier ? labels[carrier] ?? carrier : "통신사 없음";
}

function reportReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    SPAM: "스팸",
    OBSCENE: "음란/선정",
    ILLEGAL: "불법 정보",
    HATE: "혐오/비방",
    PERSONAL_INFO: "개인정보 노출",
    COPYRIGHT: "저작권 침해",
    OTHER: "기타",
  };
  return labels[reason] ?? reason;
}

function reportStatusLabel(status: AdminReport["status"]) {
  const labels = {
    PENDING: "대기",
    REVIEWED: "처리 완료",
    DISMISSED: "기각",
  };
  return labels[status];
}
