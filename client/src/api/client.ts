import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  withCredentials: true,
});

export type Board = {
  id: number;
  slug: string;
  name: string;
  description?: string;
  isAnonymous: boolean;
  isHot: boolean;
};

export type Category = {
  id: number;
  name: string;
  boards: Board[];
};

export type Post = {
  id: number;
  title: string;
  content: string;
  authorId?: number | null;
  authorNick: string;
  author?: { id: number; level?: number; exp?: number } | null;
  boardId: number;
  board?: Board;
  viewCount: number;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  isPinned: boolean;
  isNotice: boolean;
  createdAt: string;
  images?: { id: number; url: string }[];
  tags?: { tag: { name: string } }[];
  bookmarks?: { id: number }[];
};

export type User = {
  id: number;
  username: string;
  email?: string;
  nickname: string;
  role: "USER" | "MANAGER" | "ADMIN";
  profileImage?: string | null;
  level?: number;
  exp?: number;
  levelProgress?: {
    level: number;
    exp: number;
    currentLevelExp: number;
    nextLevelExp: number;
    remainingExp: number;
    progress: number;
  };
};
