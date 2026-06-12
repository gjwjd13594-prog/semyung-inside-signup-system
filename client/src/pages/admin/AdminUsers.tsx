import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { adminApi } from "../../api/admin";

type AdminUser = {
  id: number; username: string; email: string; nickname: string;
  phone?: string | null; carrier?: string | null; phoneVerified?: boolean;
  role: "USER" | "MANAGER" | "ADMIN"; isBanned: boolean;
  banReason?: string | null; banUntil?: string | null; level?: number; exp?: number; createdAt: string;
};

export function AdminUsers({ currentUserId, currentUserRole }: { currentUserId: number; currentUserRole: string }) {
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revealReason, setRevealReason] = useState("");

  const query = useQuery({
    queryKey: ["admin-users", submitted, reveal, revealReason],
    queryFn: () => adminApi.users({ q: submitted, reveal: reveal ? "1" : undefined, reason: reveal ? revealReason : undefined }),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => adminApi.setRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const banMut = useMutation({
    mutationFn: ({ id, banned, reason }: { id: number; banned: boolean; reason?: string }) =>
      banned ? adminApi.unbanUser(id) : adminApi.banUser(id, reason || "운영정책 위반"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const users: AdminUser[] = query.data?.users ?? [];
  const canReveal = Boolean(query.data?.canRevealPersonalData);

  return (
    <div className="panel-soft rounded p-4 bg-white space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h2 className="text-lg font-black">회원 관리</h2>
        <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); setSubmitted(keyword.trim()); }}>
          <input className="h-10 rounded border border-gray-300 bg-white px-3" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="아이디, 닉네임, 이메일 검색" />
          <button className="rounded bg-gray-900 px-4 font-bold text-white" type="submit">검색</button>
          {submitted && <button className="rounded border px-3 font-bold" onClick={() => { setKeyword(""); setSubmitted(""); }} type="button">초기화</button>}
        </form>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 flex items-center justify-between">
        <p>이메일·전화번호는 기본 마스킹됩니다.</p>
        {canReveal && (
          <button className="rounded bg-gray-900 px-3 py-1.5 text-white text-sm" onClick={() => {
            if (reveal) { setReveal(false); setRevealReason(""); return; }
            const reason = prompt("원문 확인 사유를 입력해주세요.");
            if (!reason?.trim()) return;
            if (!confirm("개인정보 원문을 표시합니다.")) return;
            setRevealReason(reason.trim()); setReveal(true);
          }}>
            {reveal ? "숨기기" : "원문 확인"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              {["ID", "아이디", "닉네임", "이메일", "전화번호", "권한", "상태", "관리"].map((h) => (
                <th key={h} className="p-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b bg-white">
                <td className="p-2">{u.id}</td>
                <td className="p-2 font-bold">{u.username}</td>
                <td className="p-2">{u.nickname}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">{u.phone ?? "-"}</td>
                <td className="p-2">
                  <select
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-sm disabled:bg-gray-100"
                    disabled={currentUserRole !== "ADMIN" || u.id === currentUserId || roleMut.isPending}
                    value={u.role}
                    onChange={(e) => { if (confirm(`권한을 ${e.target.value}로 변경할까요?`)) roleMut.mutate({ id: u.id, role: e.target.value }); }}
                  >
                    <option value="USER">USER</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td className="p-2">
                  <span className={`rounded px-2 py-1 text-xs font-black ${u.isBanned ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                    {u.isBanned ? "정지" : "정상"}
                  </span>
                  {u.banReason && <p className="text-xs text-gray-500 mt-0.5">{u.banReason}</p>}
                </td>
                <td className="p-2">
                  <button
                    className="rounded bg-gray-900 px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300"
                    disabled={u.id === currentUserId || banMut.isPending}
                    onClick={() => {
                      if (u.isBanned) { if (confirm("정지를 해제할까요?")) banMut.mutate({ id: u.id, banned: true }); return; }
                      const reason = prompt("정지 사유:", "운영정책 위반");
                      if (!reason) return;
                      banMut.mutate({ id: u.id, banned: false, reason });
                    }}
                  >
                    {u.isBanned ? "해제" : "정지"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && <p className="p-4 text-sm text-gray-500">표시할 회원이 없습니다.</p>}
      </div>
    </div>
  );
}
