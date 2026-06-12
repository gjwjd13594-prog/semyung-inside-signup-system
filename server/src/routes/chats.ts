import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

// 내 채팅방 목록
chatRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.roomMember.findMany({
      where: { userId: req.user!.id },
      include: {
        room: {
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { nickname: true } } } },
          },
        },
      },
    });
    const items = await Promise.all(memberships.map(async (m) => ({
      roomId: m.roomId,
      kind: m.room.kind,
      title: m.room.title,
      lastMessage: m.room.messages[0] ?? null,
      unread: await prisma.chatMessage.count({
        where: { roomId: m.roomId, createdAt: { gt: m.lastReadAt }, senderId: { not: req.user!.id } },
      }),
    })));
    res.json({ items });
  }),
);

// 이전 메시지 (커서 페이지네이션)
chatRouter.get(
  "/:roomId/messages",
  asyncHandler(async (req, res) => {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: req.params.roomId, userId: req.user!.id } },
    });
    if (!member) return res.status(403).json({ message: "참여 권한이 없어요." });

    const before = req.query.before ? new Date(String(req.query.before)) : new Date();
    const messages = await prisma.chatMessage.findMany({
      where: { roomId: req.params.roomId, createdAt: { lt: before } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { sender: { select: { id: true, nickname: true } } },
    });
    res.json({ messages: messages.reverse() });
  }),
);
