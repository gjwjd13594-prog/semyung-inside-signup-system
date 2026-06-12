# 세명 인사이드 — Part 4 (실시간 채팅 · 승인 알림)

> Part 1(회원/관리자), Part 2(게시글/신고), Part 3(사진 승인/도용방지)에 이어,
> 데모의 가짜 동작 2개를 실제로 교체합니다:
> ① 1.7초 자동 승인 → **실제 방장/게시자 승인 + 실시간 알림**
> ② 랜덤 더미 답장 → **Socket.io 실시간 채팅 (DB 영속)**

```bash
npm i socket.io socket.io-client
```

---

## 0. 변경 요약

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/schema.prisma` | `ChatRoom`, `ChatMessage`, `RoomMember`, `JoinRequest`, `Notification` |
| 서버 | `server/src/socket/index.ts` | **신규** — Socket.io 서버 + 쿠키 JWT 인증 |
| 서버 | `server/src/socket/chat.ts` | **신규** — 채팅 이벤트 (금지어 필터 포함) |
| 서버 | `server/src/services/notify.ts` | **신규** — 알림 생성 + 실시간 push |
| 서버 | `server/src/routes/meetups.ts` | **신규** — 번개 신청/승인/거절 + 벙 종료 평가 |
| 서버 | `server/src/routes/chats.ts` | **신규** — 채팅방 목록/이전 메시지 |
| 서버 | `server/src/routes/banned.ts` | 금지어를 DB로 이동 (관리자 CRUD) |
| 클라 | `client/src/lib/socket.ts` | **신규** — 소켓 클라이언트 싱글톤 |
| 클라 | `client/src/hooks/useChat.ts` | **신규** — 채팅 훅 |

---

## 1. `prisma/schema.prisma` (추가분)

```prisma
enum RoomKind {
  DM        // 소개팅 1:1
  MEETUP    // 번개 단체방
  GROUP     // 과팅 단체방
}

enum JoinStatus {
  PENDING
  APPROVED
  REJECTED
}

model ChatRoom {
  id        String        @id @default(cuid())
  kind      RoomKind
  title     String
  // DM이면 matchId, MEETUP이면 meetupId, GROUP이면 groupPostId 연결
  refId     String?
  members   RoomMember[]
  messages  ChatMessage[]
  createdAt DateTime      @default(now())

  @@index([kind, refId])
}

model RoomMember {
  id       String   @id @default(cuid())
  room     ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  roomId   String
  user     User     @relation("RoomMembers", fields: [userId], references: [id])
  userId   String
  isHost   Boolean  @default(false)
  lastReadAt DateTime @default(now())
  joinedAt DateTime @default(now())

  @@unique([roomId, userId])
  @@index([userId])
}

model ChatMessage {
  id        String   @id @default(cuid())
  room      ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  roomId    String
  sender    User     @relation("SentMessages", fields: [senderId], references: [id])
  senderId  String
  content   String   // 금지어 필터 적용된 본문
  isSystem  Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([roomId, createdAt])
}

model Meetup {
  id        String        @id @default(cuid())
  title     String
  place     String
  time      String
  maxN      Int
  tag       String
  host      User          @relation("HostedMeetups", fields: [hostId], references: [id])
  hostId    String
  ended     Boolean       @default(false)
  requests  JoinRequest[]
  createdAt DateTime      @default(now())
}

model JoinRequest {
  id        String     @id @default(cuid())
  meetup    Meetup     @relation(fields: [meetupId], references: [id], onDelete: Cascade)
  meetupId  String
  applicant User       @relation("JoinRequests", fields: [applicantId], references: [id])
  applicantId String
  status    JoinStatus @default(PENDING)
  createdAt DateTime   @default(now())

  @@unique([meetupId, applicantId])
}

model Notification {
  id        String   @id @default(cuid())
  user      User     @relation("Notifications", fields: [userId], references: [id])
  userId    String
  type      String   // JOIN_REQUEST, JOIN_APPROVED, NEW_MESSAGE, MATCH, PROFILE_APPROVED ...
  title     String
  body      String?
  refId     String?  // roomId / meetupId 등
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId, read])
}

model BannedWord {
  id   String @id @default(cuid())
  word String @unique
}

// User 모델에 관계 추가:
// rooms        RoomMember[]  @relation("RoomMembers")
// messages     ChatMessage[] @relation("SentMessages")
// hostedMeetups Meetup[]     @relation("HostedMeetups")
// joinRequests JoinRequest[] @relation("JoinRequests")
// notifications Notification[] @relation("Notifications")
```

> 적용: `npx prisma migrate dev -n add_realtime`
> ※ 과팅(GroupPost)도 동일 패턴(JoinRequest에 `groupPostId` 추가 또는 별도 모델)으로 확장하면 됩니다. 분량상 번개 기준으로 작성했고, 과팅은 복붙 수준으로 동일해요.

---

## 2. `server/src/socket/index.ts` (신규 — 서버 부트스트랩 + 인증)

```ts
import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { config } from "../config";
import { registerChatHandlers } from "./chat";

export let io: Server;

export function initSocket(server: http.Server) {
  io = new Server(server, {
    cors: { origin: config.clientOrigin, credentials: true },
  });

  // httpOnly 쿠키의 accessToken으로 소켓 인증 (Part 1과 동일 토큰)
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || "";
      const { accessToken } = cookie.parse(raw);
      if (!accessToken) return next(new Error("UNAUTHORIZED"));
      const payload = jwt.verify(accessToken, config.jwtSecret) as { sub: string; role: string };
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    // 개인 알림 채널 — 어디서든 이 사용자에게 push 가능
    socket.join(`user:${socket.data.userId}`);
    registerChatHandlers(io, socket);
  });

  return io;
}
```

```ts
// server/src/index.ts 수정 — Express와 같은 http 서버 공유
import http from "http";
import { initSocket } from "./socket";

const server = http.createServer(app);
initSocket(server);
server.listen(config.port);   // 기존 app.listen 대신
```

---

## 3. `server/src/socket/chat.ts` (신규 — 채팅 이벤트)

```ts
import { Server, Socket } from "socket.io";
import { prisma } from "../prisma";
import { notify } from "../services/notify";

// DB 금지어 캐시 (5분)
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
  const userId = socket.data.userId as string;

  // 방 입장 — 멤버인지 DB로 검증 후 join
  socket.on("room:join", async (roomId: string, ack?: Function) => {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) return ack?.({ ok: false, message: "참여 권한이 없어요." });
    socket.join(`room:${roomId}`);
    ack?.({ ok: true });
  });

  // 메시지 전송 — 서버에서 금지어 필터 + DB 저장 + 브로드캐스트
  socket.on("message:send", async (data: { roomId: string; content: string }, ack?: Function) => {
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

    // 방에 없는(소켓 미접속 포함) 멤버에게 알림
    const others = member.room.members.filter((m) => m.userId !== userId);
    for (const o of others) {
      await notify(o.userId, {
        type: "NEW_MESSAGE",
        title: member.room.title,
        body: filtered.slice(0, 50),
        refId: roomId,
      });
    }
    ack?.({ ok: true, filtered: filtered !== content.trim() });
  });

  // 읽음 처리
  socket.on("room:read", async (roomId: string) => {
    await prisma.roomMember.updateMany({
      where: { roomId, userId },
      data: { lastReadAt: new Date() },
    }).catch(() => {});
  });
}

// 시스템 메시지 헬퍼 — 라우트에서 호출
export async function systemMessage(roomId: string, text: string) {
  const { io } = await import("./index");
  const msg = await prisma.chatMessage.create({
    data: { roomId, senderId: "SYSTEM", content: text, isSystem: true },
  }).catch(async () => {
    // senderId FK 제약이 있다면 시스템 계정을 seed 해두거나 nullable로 변경
    return prisma.chatMessage.create({ data: { roomId, senderId: (await systemUser()).id, content: text, isSystem: true } });
  });
  io.to(`room:${roomId}`).emit("message:new", { ...msg, sender: { id: "SYSTEM", nickname: "안내" } });
}
async function systemUser() {
  return prisma.user.upsert({
    where: { username: "__system__" },
    update: {},
    create: { username: "__system__", email: "system@internal", password: "!", nickname: "안내", phone: "0", carrier: "-", role: "USER" },
  });
}
```

---

## 4. `server/src/services/notify.ts` (신규)

```ts
import { prisma } from "../prisma";

interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  refId?: string;
}

// DB 저장 + 접속 중이면 실시간 push (한 함수로 통일)
export async function notify(userId: string, input: NotifyInput) {
  const n = await prisma.notification.create({ data: { userId, ...input } });
  const { io } = await import("../socket");
  io.to(`user:${userId}`).emit("notification:new", n);
  return n;
}
```

---

## 5. `server/src/routes/meetups.ts` (신규 — 실제 승인 플로우)

```ts
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireApprovedProfile } from "../middleware/profileGate";
import { notify } from "../services/notify";
import { systemMessage } from "../socket/chat";

const router = Router();
router.use(requireAuth, requireApprovedProfile);

// 번개 목록
router.get("/", async (_req, res) => {
  const items = await prisma.meetup.findMany({
    where: { ended: false },
    orderBy: { createdAt: "desc" },
    include: {
      host: { select: { id: true, nickname: true } },
      requests: { select: { applicantId: true, status: true } },
    },
  });
  res.json({ items });
});

// 번개 생성 (작성자 = 방장, 채팅방도 함께 생성)
router.post("/", async (req, res) => {
  const { title, place, time, maxN, tag } = req.body ?? {};
  if (!title || !place || !time) return res.status(400).json({ message: "필수 항목을 입력해주세요." });

  const meetup = await prisma.meetup.create({
    data: { title, place, time, maxN: Number(maxN) || 4, tag: tag || "#가볍게", hostId: req.user!.id },
  });
  const room = await prisma.chatRoom.create({
    data: {
      kind: "MEETUP", title, refId: meetup.id,
      members: { create: { userId: req.user!.id, isHost: true } },
    },
  });
  res.status(201).json({ meetup, roomId: room.id });
});

// 참여 신청 → 방장에게 실시간 알림 (자동 승인 ❌)
router.post("/:id/apply", async (req, res) => {
  const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
  if (!meetup || meetup.ended) return res.status(404).json({ message: "번개를 찾을 수 없어요." });
  if (meetup.hostId === req.user!.id) return res.status(400).json({ message: "내 번개에는 신청할 수 없어요." });

  const approvedN = await prisma.joinRequest.count({ where: { meetupId: meetup.id, status: "APPROVED" } });
  if (approvedN + 1 >= meetup.maxN) return res.status(400).json({ message: "모집이 마감됐어요." });

  const reqRow = await prisma.joinRequest.upsert({
    where: { meetupId_applicantId: { meetupId: meetup.id, applicantId: req.user!.id } },
    update: { status: "PENDING" },
    create: { meetupId: meetup.id, applicantId: req.user!.id },
  });

  const applicant = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { nickname: true, dept: true } });
  await notify(meetup.hostId, {
    type: "JOIN_REQUEST",
    title: `'${meetup.title}' 참여 신청`,
    body: `${applicant!.nickname}(${applicant!.dept})님이 신청했어요`,
    refId: meetup.id,
  });
  res.json({ status: reqRow.status }); // 클라이언트는 '승인 대기 중' 표시
});

// 방장 승인 → 채팅방 멤버 추가 + 신청자에게 알림 + 시스템 메시지
router.patch("/:id/requests/:reqId/approve", async (req, res) => {
  const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
  if (!meetup) return res.status(404).json({ message: "번개를 찾을 수 없어요." });
  if (meetup.hostId !== req.user!.id) return res.status(403).json({ message: "방장만 승인할 수 있어요." });

  const jr = await prisma.joinRequest.update({
    where: { id: req.params.reqId },
    data: { status: "APPROVED" },
    include: { applicant: { select: { id: true, nickname: true } } },
  });

  const room = await prisma.chatRoom.findFirst({ where: { kind: "MEETUP", refId: meetup.id } });
  if (room) {
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: jr.applicantId } },
      update: {}, create: { roomId: room.id, userId: jr.applicantId },
    });
    await systemMessage(room.id, `${jr.applicant.nickname}님이 입장했어요 🎉`);
  }

  await notify(jr.applicantId, {
    type: "JOIN_APPROVED",
    title: `'${meetup.title}' 승인 완료!`,
    body: "채팅방이 열렸어요. 인사를 나눠보세요 🍻",
    refId: room?.id,
  });
  res.json({ ok: true, roomId: room?.id });
});

// 방장 거절
router.patch("/:id/requests/:reqId/reject", async (req, res) => {
  const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
  if (!meetup || meetup.hostId !== req.user!.id) return res.status(403).json({ message: "방장만 처리할 수 있어요." });
  const jr = await prisma.joinRequest.update({ where: { id: req.params.reqId }, data: { status: "REJECTED" } });
  await notify(jr.applicantId, { type: "JOIN_REJECTED", title: `'${meetup.title}' 신청이 거절됐어요`, refId: meetup.id });
  res.json({ ok: true });
});

// 벙 종료 + 전원 매너평가 (방장이 종료, 평가는 각자 제출)
router.post("/:id/end", async (req, res) => {
  const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
  if (!meetup || meetup.hostId !== req.user!.id) return res.status(403).json({ message: "방장만 종료할 수 있어요." });
  await prisma.meetup.update({ where: { id: meetup.id }, data: { ended: true } });
  const room = await prisma.chatRoom.findFirst({ where: { kind: "MEETUP", refId: meetup.id }, include: { members: true } });
  if (room) {
    await systemMessage(room.id, "벙이 종료됐어요. 참여자 매너평가를 남겨주세요 🌡️");
    for (const m of room.members) {
      await notify(m.userId, { type: "RATE_REQUEST", title: `'${meetup.title}' 매너평가`, body: "함께한 참여자를 평가해주세요", refId: meetup.id });
    }
  }
  res.json({ ok: true });
});

// 매너평가 제출 (1인 1회, 참여자만) — User.temp 가감
router.post("/:id/rate", async (req, res) => {
  const { ratings } = req.body ?? {}; // [{ userId, up: boolean }]
  if (!Array.isArray(ratings)) return res.status(400).json({ message: "잘못된 요청입니다." });
  const room = await prisma.chatRoom.findFirst({
    where: { kind: "MEETUP", refId: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  const memberIds = new Set(room?.members.map((m) => m.userId) ?? []);
  if (!memberIds.has(req.user!.id)) return res.status(403).json({ message: "참여자만 평가할 수 있어요." });

  for (const r of ratings) {
    if (!memberIds.has(r.userId) || r.userId === req.user!.id) continue;
    const delta = r.up ? 0.5 : -0.5;
    await prisma.$executeRaw`
      UPDATE "User" SET temp = LEAST(50, GREATEST(30, temp + ${delta})) WHERE id = ${r.userId}
    `;
  }
  res.json({ ok: true });
});

export default router;
```

> `User.temp Float @default(36.5)` 컬럼을 schema에 추가하세요. 중복 평가 방지가 필요하면 `MeetupRating(meetupId, raterId, targetId)` unique 테이블을 더하면 됩니다.

---

## 6. `server/src/routes/chats.ts` (신규 — 목록/히스토리 REST)

```ts
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// 내 채팅방 목록 (마지막 메시지 + 안읽음 수)
router.get("/", async (req, res) => {
  const memberships = await prisma.roomMember.findMany({
    where: { userId: req.user!.id },
    include: {
      room: {
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { nickname: true } } } } },
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
});

// 이전 메시지 (커서 페이지네이션)
router.get("/:roomId/messages", async (req, res) => {
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
});

export default router;
```

### 라우터 등록

```ts
app.use("/api/meetups", meetupRoutes);
app.use("/api/chats", chatRoutes);
```

---

## 7. 금지어 관리자 CRUD (admin.ts 추가분)

```ts
router.get("/banned-words", async (_req, res) => {
  res.json({ items: await prisma.bannedWord.findMany({ orderBy: { word: "asc" } }) });
});
router.post("/banned-words", async (req, res) => {
  const { word } = req.body ?? {};
  if (!word?.trim()) return res.status(400).json({ message: "단어를 입력해주세요." });
  const row = await prisma.bannedWord.upsert({ where: { word: word.trim() }, update: {}, create: { word: word.trim() } });
  res.status(201).json(row);
});
router.delete("/banned-words/:id", async (req, res) => {
  await prisma.bannedWord.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
```

---

## 8. 클라이언트 — `client/src/lib/socket.ts` + `hooks/useChat.ts`

```ts
// lib/socket.ts — 싱글톤 (쿠키 자동 전송)
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_ORIGIN, { withCredentials: true });
  }
  return socket;
}
```

```ts
// hooks/useChat.ts
import { useEffect, useState, useCallback } from "react";
import { getSocket } from "../lib/socket";
import { api } from "../api/client";

export interface Message {
  id: string; roomId: string; content: string; createdAt: string;
  sender: { id: string; nickname: string }; isSystem: boolean;
}

export function useChat(roomId: string) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const socket = getSocket();
    // 이전 메시지 로드 + 방 입장
    api.get(`/chats/${roomId}/messages`).then((r) => setMessages(r.data.messages));
    socket.emit("room:join", roomId, (ack: any) => { if (!ack?.ok) console.warn(ack?.message); });

    const onNew = (msg: Message) => {
      if (msg.roomId !== roomId) return;
      setMessages((prev) => [...prev, msg]);
      socket.emit("room:read", roomId);
    };
    socket.on("message:new", onNew);
    return () => { socket.off("message:new", onNew); };
  }, [roomId]);

  const send = useCallback((content: string) => {
    getSocket().emit("message:send", { roomId, content }, (ack: any) => {
      if (ack?.filtered) console.info("금지어가 가려졌어요");
    });
  }, [roomId]);

  return { messages, send };
}
```

```ts
// 전역 알림 구독 (App.tsx 등 최상위에서 1회)
useEffect(() => {
  const socket = getSocket();
  socket.on("notification:new", (n) => {
    // 토스트 표시 + 알림 목록 갱신. n.type별 분기:
    // JOIN_REQUEST → 방장 화면 갱신 / JOIN_APPROVED → "채팅방 입장" 버튼 활성화
  });
  return () => { socket.off("notification:new"); };
}, []);
```

---

## 적용 순서

1. `npm i socket.io socket.io-client cookie` → schema 반영 → `npx prisma migrate dev -n add_realtime`
2. `index.ts`를 `http.createServer(app)` + `initSocket(server)` 구조로 변경
3. `socket/`, `services/notify.ts`, `routes/meetups.ts`, `routes/chats.ts` 추가 + 라우터 등록
4. 금지어를 메모리 → DB(BannedWord)로 이전, 관리자 CRUD 연결
5. 클라: `lib/socket.ts`, `useChat` 훅 적용, 전역 알림 구독
6. 데모의 `setTimeout` 자동 승인 로직 제거 → `apply`/`approve` API + `notification:new` 이벤트로 교체

## 설계 메모

- **권한은 전부 서버 검증**: 방 입장·메시지 전송 모두 `RoomMember` DB 확인 후 처리. 클라이언트 신뢰 ❌
- **금지어 필터는 서버에서**: 저장 전 적용되므로 우회해도 DB에 원문이 남지 않음. 변형 우회(자모 분해 등) 강화는 `filterBanned`만 교체하면 됨
- **알림 = DB + 실시간**: 미접속 시에도 DB에 남아 접속 후 확인 가능. 푸시(FCM)는 Capacitor 단계에서 `notify()`에 한 줄 추가하면 됨 — 이 함수가 그 허브
- **과팅 승인**은 번개와 동일 패턴 (JoinRequest 확장)
