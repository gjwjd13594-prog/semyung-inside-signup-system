import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { adminApi } from "../../api/admin";

export function AdminBoards() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: "", name: "", description: "" });
  const query = useQuery({
    queryKey: ["admin-boards"],
    queryFn: () => adminApi.boards(),
  });
  const createMut = useMutation({
    mutationFn: () => adminApi.createBoard({
      slug: form.slug.trim(), name: form.name.trim(), description: form.description.trim(),
      categoryId: query.data?.categories[0]?.id ?? 1, isHot: false, isAnonymous: false,
      sortOrder: (query.data?.boards.length ?? 0) + 1,
    }),
    onSuccess: () => { setForm({ slug: "", name: "", description: "" }); qc.invalidateQueries({ queryKey: ["admin-boards"] }); },
  });

  return (
    <div className="panel-soft rounded p-4 bg-white space-y-4">
      <h2 className="text-lg font-black">게시판 관리</h2>
      <form className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!form.slug.trim() || !form.name.trim()) return; createMut.mutate(); }}>
        <input className="h-10 rounded border border-gray-300 bg-white px-3" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="slug (예: free)" />
        <input className="h-10 rounded border border-gray-300 bg-white px-3" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="게시판 이름" />
        <input className="h-10 rounded border border-gray-300 bg-white px-3" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="설명" />
        <button className="rounded bg-brand px-4 font-black text-white disabled:bg-gray-300" disabled={createMut.isPending} type="submit">추가</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {query.data?.boards.map((b: any) => (
          <div key={b.id} className="rounded border border-gray-100 p-3">
            <p className="font-black">{b.name} <span className="text-xs text-gray-400">/{b.slug}</span></p>
            <p className="text-sm text-gray-500">{b.description}</p>
            <p className="text-xs text-gray-400 mt-1">글 {b._count?.posts ?? 0}개 · {b.category?.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
