import { api } from "./client";

export const adminApi = {
  stats: () => api.get("/api/admin/stats").then((r) => r.data),
  dailyStats: () => api.get("/api/admin/stats/daily").then((r) => r.data),
  ops: () => api.get("/api/admin/ops").then((r) => r.data),

  users: (params?: { q?: string; reveal?: string; reason?: string }) =>
    api.get("/api/admin/users", { params }).then((r) => r.data),
  banUser: (id: number, reason: string, banUntil?: string | null) =>
    api.put(`/api/admin/users/${id}/ban`, { reason, banUntil }).then((r) => r.data),
  unbanUser: (id: number) =>
    api.put(`/api/admin/users/${id}/unban`).then((r) => r.data),
  setRole: (id: number, role: string) =>
    api.put(`/api/admin/users/${id}/role`, { role }).then((r) => r.data),

  posts: () => api.get("/api/admin/posts").then((r) => r.data),
  deletePost: (id: number) => api.delete(`/api/admin/posts/${id}`).then((r) => r.data),
  pinPost: (id: number, isPinned: boolean, isNotice: boolean) =>
    api.put(`/api/admin/posts/${id}/pin`, { isPinned, isNotice }).then((r) => r.data),

  reports: () => api.get("/api/admin/reports").then((r) => r.data),
  updateReport: (id: number, status: "PENDING" | "REVIEWED" | "DISMISSED") =>
    api.put(`/api/admin/reports/${id}`, { status }).then((r) => r.data),

  boards: () => api.get("/api/admin/boards").then((r) => r.data),
  createBoard: (data: object) => api.post("/api/admin/boards", data).then((r) => r.data),

  bannedWords: () => api.get("/api/admin/banned-words").then((r) => r.data),
  addBannedWord: (word: string, level: number) =>
    api.post("/api/admin/banned-words", { word, level }).then((r) => r.data),
  deleteBannedWord: (id: number) =>
    api.delete(`/api/admin/banned-words/${id}`).then((r) => r.data),

  privacyLogs: () => api.get("/api/admin/privacy-logs").then((r) => r.data),
  serverLogs: (params?: object) => api.get("/api/admin/logs", { params }).then((r) => r.data),
};
