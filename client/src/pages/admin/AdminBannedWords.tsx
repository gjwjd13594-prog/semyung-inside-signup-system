import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { adminApi } from "../../api/admin";

export function AdminBannedWords() {
  const qc = useQueryClient();
  const [word, setWord] = useState("");
  const [level, setLevel] = useState(1);
  const query = useQuery({ queryKey: ["admin-banned-words"], queryFn: () => adminApi.bannedWords() });
  const addMut = useMutation({
    mutationFn: () => adminApi.addBannedWord(word.trim(), level),
    onSuccess: () => { setWord(""); setLevel(1); qc.invalidateQueries({ queryKey: ["admin-banned-words"] }); },
  });
  const delMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteBannedWord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-banned-words"] }),
  });

  return (
    <div className="panel-soft rounded p-4 bg-white space-y-4">
      <h2 className="text-lg font-black">금지어 관리</h2>
      <form className="flex flex-col gap-2 md:flex-row" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!word.trim()) return; addMut.mutate(); }}>
        <input className="h-10 flex-1 rounded border border-gray-300 bg-white px-3" value={word} onChange={(e) => setWord(e.target.value)} placeholder="금지어 입력" />
        <select className="h-10 rounded border border-gray-300 bg-white px-3" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
          <option value={1}>경고</option>
          <option value={2}>자동 삭제 대상</option>
        </select>
        <button className="rounded bg-brand px-4 font-black text-white disabled:bg-gray-300" disabled={addMut.isPending} type="submit">추가</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {query.data?.words.map((w: any) => (
          <div key={w.id} className="flex items-center justify-between rounded border border-gray-100 p-3">
            <p className="font-black">{w.word} <span className="text-xs text-gray-400">레벨 {w.level}</span></p>
            <button className="rounded bg-red-600 px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300" disabled={delMut.isPending} onClick={() => delMut.mutate(w.id)}>삭제</button>
          </div>
        ))}
        {!query.data?.words.length && <p className="text-sm text-gray-500">등록된 금지어가 없습니다.</p>}
      </div>
    </div>
  );
}
