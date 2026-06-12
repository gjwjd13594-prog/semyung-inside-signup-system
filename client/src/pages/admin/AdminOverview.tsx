import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Link as LinkIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/admin";

type AdminStats = {
  todayUsers: number;
  todayPosts: number;
  pendingReports: number;
  totalUsers: number;
  totalPosts: number;
};

type DailyRow = { date: string; label: string; users: number; posts: number; comments: number };

export function AdminOverview() {
  const stats = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.stats(),
  });
  const daily = useQuery<{ rows: DailyRow[] }>({
    queryKey: ["admin-daily"],
    queryFn: () => adminApi.dailyStats(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black">오늘의 현황</h2>
        <button
          onClick={() => { stats.refetch(); daily.refetch(); }}
          className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-bold hover:border-brand hover:text-brand"
        >
          <RefreshCw size={14} className={stats.isFetching ? "animate-spin" : ""} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "오늘 가입자", value: stats.data?.todayUsers ?? 0 },
          { label: "오늘 글", value: stats.data?.todayPosts ?? 0 },
          { label: "미처리 신고", value: stats.data?.pendingReports ?? 0, danger: (stats.data?.pendingReports ?? 0) > 0 },
          { label: "전체 회원", value: stats.data?.totalUsers ?? 0 },
          { label: "전체 글", value: stats.data?.totalPosts ?? 0 },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border bg-white p-4 ${s.danger ? "border-red-200" : "border-gray-100"}`}>
            <div className={`text-2xl font-black ${s.danger ? "text-red-600" : "text-gray-900"}`}>{s.value.toLocaleString("ko-KR")}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {daily.data?.rows.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="font-black mb-3">최근 7일 활동 <span className="text-xs font-bold text-gray-400">가입/글/댓글</span></h3>
          <div className="grid grid-cols-7 gap-2">
            {daily.data.rows.map((r) => {
              const max = Math.max(...daily.data!.rows.flatMap((row) => [row.users, row.posts, row.comments]), 1);
              return (
                <div key={r.date} className="flex min-h-32 flex-col justify-end gap-1">
                  <div className="flex flex-1 items-end justify-center gap-0.5">
                    <div className="w-2 rounded-t bg-green-400" style={{ height: `${Math.max(4, (r.users / max) * 90)}px` }} />
                    <div className="w-2 rounded-t bg-brand" style={{ height: `${Math.max(4, (r.posts / max) * 90)}px` }} />
                    <div className="w-2 rounded-t bg-blue-400" style={{ height: `${Math.max(4, (r.comments / max) * 90)}px` }} />
                  </div>
                  <p className="text-center text-[11px] font-bold text-gray-500 truncate">{r.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Link className="rounded bg-brand px-4 py-2 text-sm font-black text-white" to="/admin/users">회원 관리 →</Link>
        <Link className="rounded border px-4 py-2 text-sm font-bold hover:border-brand hover:text-brand" to="/admin/reports">신고 처리 →</Link>
      </div>
    </div>
  );
}
