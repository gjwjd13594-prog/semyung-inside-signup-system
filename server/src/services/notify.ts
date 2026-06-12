import { prisma } from "../prisma.js";
import { pushToUser } from "../lib/fcm.js";

interface NotifyInput {
  type: string;
  message: string;
  link?: string;
}

export async function notify(userId: number, input: NotifyInput) {
  const n = await prisma.notification.create({ data: { userId, ...input } });
  try {
    const { io } = await import("../socket/index.js");
    if (io) io.to(`user:${userId}`).emit("notification:new", n);
  } catch {
    // 소켓 미초기화 시 무시
  }
  await pushToUser(userId, input.message, { type: input.type, link: input.link ?? "" }).catch(() => {});
  return n;
}
