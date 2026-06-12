import { Server, Socket } from "socket.io";
import { prisma } from "../prisma.js";

let bannedCache: string[] = [];
let bannedAt = 0;

async function bannedWords() {
  if (Date.now() - bannedAt > 5 * 60_000) {
    bannedCache = (await prisma.bannedWord.findMany()).map((b) => b.word);
    bannedAt = Date.now();
  }
  return bannedCache;
}

async function filterBanned(text: string) {
  let out = text;
  for (const w of await bannedWords()) out = out.split(w).join("●".repeat(w.length));
  return out;
}

export function registerChatHandlers(io: Server, socket: Socket) {
  const userId = socket.data.userId as number;

  socket.on("room:join", async (roomId: string, ack?: (r: object) => void) => {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) return ack?.({ ok: false, message: "참여 권한이 없어요." });
    socket.join(`room:${roomId}`);
    ack?.({ ok: true });
  });

  socket.on("message:send", async (data: { roomId: string; content: string }, ack?: (r: object) => void) => {
    const { roomId, content } = data;
    if (!content?.trim()) return;

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { room: { include: { members: true } } },
    });
    if (!member) return ack?.({ ok: false, message: "참여 권한이 없어요." });

    const filtered = await filterBanned(content.trim().slice(0, 1000));
    const msg = await prisma.chatMessage.create({
      data: { roomId, senderId: userId, content: filtered },
      include: { sender: { select: { id: true, nickname: true } } },
    });

    io.to(`room:${roomId}`).emit("message:new", {
      id: msg.id, roomId, content: msg.content, createdAt: msg.createdAt,
      sender: msg.sender, isSystem: false,
    });

    ack?.({ ok: true, filtered: filtered !== content.trim() });
  });

  socket.on("room:read", async (roomId: string) => {
    await prisma.roomMember.updateMany({
      where: { roomId, userId },
      data: { lastReadAt: new Date() },
    }).catch(() => {});
  });
}

export async function systemMessage(io: Server, roomId: string, text: string) {
  const msg = await prisma.chatMessage.create({
    data: { roomId, content: text, isSystem: true },
  });
  io.to(`room:${roomId}`).emit("message:new", {
    id: msg.id, roomId, content: msg.content, createdAt: msg.createdAt,
    sender: { id: null, nickname: "안내" }, isSystem: true,
  });
}
