import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../api/admin";

type Post = {
  id: number; title: string; authorNick: string;
  viewCount: number; isPinned: boolean; isNotice: boolean; isDeleted: boolean;
  createdAt: string; board?: { name: string; slug: string };
};

export function AdminPosts() {
  const qc = useQueryClient();
  const query = useQuery<{ posts: Post[] }>({
    queryKey: ["admin-posts"],
    queryFn: () => adminApi.posts(),
  });
  const pinMut = useMutation({
    mutationFn: (p: Post) => adminApi.pinPost(p.id, !p.isPinned, !p.isPinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-posts"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => adminApi.deletePost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-posts"] }),
  });

  return (
    <div className="panel-soft rounded p-4 bg-white space-y-2">
      <h2 className="text-lg font-black">게시글 관리</h2>
      {query.data?.posts.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded border border-gray-100 p-3">
          <span className="text-xs text-gray-400">[{p.board?.name ?? "게시판"}]</span>
          <span className="flex-1 truncate font-bold min-w-0">{p.title}</span>
          <span className="text-xs text-gray-500">{p.authorNick} · 조회 {p.viewCount}</span>
          {p.isPinned && <span className="text-xs px-1.5 py-0.5 bg-brand/10 text-brand rounded">공지</span>}
          <button
            className="rounded bg-brand px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300"
            disabled={pinMut.isPending}
            onClick={() => pinMut.mutate(p)}
          >
            {p.isPinned ? "공지 해제" : "공지 고정"}
          </button>
          <button
            className="rounded bg-red-600 px-3 py-1 text-sm font-bold text-white disabled:bg-gray-300"
            disabled={delMut.isPending}
            onClick={() => { if (confirm("삭제할까요?")) delMut.mutate(p.id); }}
          >
            삭제
          </button>
        </div>
      ))}
      {!query.data?.posts.length && <p className="text-sm text-gray-500 py-6 text-center">게시글이 없습니다.</p>}
    </div>
  );
}
