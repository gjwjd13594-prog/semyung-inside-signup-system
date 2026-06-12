import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../api/admin";

type Report = {
  id: number; reason: string; detail?: string | null;
  status: "PENDING" | "REVIEWED" | "DISMISSED"; createdAt: string;
  reporter?: { id: number; nickname: string };
  post?: { id: number; title: string; board?: { slug: string; name: string } } | null;
  comment?: { id: number; content: string; post?: { id: number; title: string; board?: { slug: string; name: string } } } | null;
};

const reasonLabels: Record<string, string> = {
  SPAM: "스팸", OBSCENE: "음란", ILLEGAL: "불법", HATE: "혐오",
  PERSONAL_INFO: "개인정보", COPYRIGHT: "저작권", OTHER: "기타",
};

export function AdminReports() {
  const qc = useQueryClient();
  const query = useQuery<{ reports: Report[] }>({
    queryKey: ["admin-reports"],
    queryFn: () => adminApi.reports(),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: Report["status"] }) => adminApi.updateReport(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });

  const pending = query.data?.reports.filter((r) => r.status === "PENDING") ?? [];
  const done = query.data?.reports.filter((r) => r.status !== "PENDING") ?? [];

  const ReportCard = ({ r }: { r: Report }) => (
    <div className="rounded border border-gray-100 bg-white p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-black">{r.post ? "게시글 신고" : "댓글 신고"} <span className="text-xs text-gray-400">#{r.id}</span></p>
        <span className={`text-xs px-2 py-1 rounded font-black ${r.status === "PENDING" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"}`}>
          {r.status === "PENDING" ? "대기" : r.status === "REVIEWED" ? "처리완료" : "기각"}
        </span>
      </div>
      <p className="text-sm text-gray-600">신고자: {r.reporter?.nickname ?? "알 수 없음"} · 사유: {reasonLabels[r.reason] ?? r.reason}</p>
      {r.detail && <p className="text-sm bg-gray-50 rounded p-2">{r.detail}</p>}
      {r.comment && <p className="text-sm text-gray-700 line-clamp-2">댓글: {r.comment.content}</p>}
      {r.post && <p className="text-sm font-bold text-brand">원문: {r.post.title}</p>}
      {r.status === "PENDING" && (
        <div className="flex gap-2 flex-wrap pt-1">
          <button className="rounded bg-brand px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300" disabled={updateMut.isPending} onClick={() => updateMut.mutate({ id: r.id, status: "REVIEWED" })}>처리 완료</button>
          <button className="rounded bg-gray-800 px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300" disabled={updateMut.isPending} onClick={() => updateMut.mutate({ id: r.id, status: "DISMISSED" })}>기각</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="panel-soft rounded p-4 bg-white space-y-3">
      <h2 className="text-lg font-black">신고 관리</h2>
      {pending.length > 0 && (
        <div>
          <p className="text-sm font-bold text-red-600 mb-2">미처리 신고 {pending.length}건</p>
          <div className="space-y-2">{pending.map((r) => <ReportCard key={r.id} r={r} />)}</div>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="text-sm font-bold text-gray-400 mb-2">처리된 신고</p>
          <div className="space-y-2">{done.map((r) => <ReportCard key={r.id} r={r} />)}</div>
        </div>
      )}
      {!query.data?.reports.length && <p className="text-sm text-gray-500 py-6 text-center">접수된 신고가 없습니다.</p>}
    </div>
  );
}
