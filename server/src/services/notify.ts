import { prisma } from "../prisma.js";

interface NotifyInput {
  type: string;
  message: string;
  link?: string;
}

export async function notify(userId: number, input: NotifyInput) {
  const n = await prisma.notification.create({ data: { userId, ...input } });
  // 실시간 소켓 push (소켓이 초기화된 경우)
  try {
    const { io } = await import("../socket/index.js");
    if (io) io.to(`user:${userId}`).emit("notification:new", n);
  } catch {
    // 소켓 미초기화 시 무시 (REST only 환경)
  }
  return n;
}
