import { api } from "./client";

export const photoApi = {
  list: () => api.get("/api/photos").then((r) => r.data.photos),

  upload: async (file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return api.post("/api/photos/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },

  remove: (id: string) => api.delete(`/api/photos/${id}`).then((r) => r.data),
  setPrimary: (id: string) => api.patch(`/api/photos/${id}/primary`).then((r) => r.data),
  submitReview: () => api.post("/api/photos/submit-review").then((r) => r.data),
};
