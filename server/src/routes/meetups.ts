import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireApprovedProfile } from "../middleware/profileGate.js";
import { notify } from "../services/notify.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const meetupRouter = Router();
meetupRouter.use(requireAuth, requireApprovedProfile);

// 번개 목록
meetupRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await prisma.meetup.findMany({
      where: { ended: false },
      orderBy: { createdAt: "desc" },
      include: {
        host: { select: { id: true, nickname: true } },
        requests: { select: { applicantId: true, status: true } },
      },
    });
    res.json({ items });
  }),
);

// 번개 생성
meetupRouter.post(
  "/",
  asyncHandler(async (req, res) => {
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
  }),
);

// 참여 신청
meetupRouter.post(
  "/:id/apply",
  asyncHandler(async (req, res) => {
    const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
    if (!meetup || meetup.ended) return res.status(404).json({ message: "번개를 찾을 수 없어요." });
    if (meetup.hostId === req.user!.id) return res.status(400).json({ message: "내 번개에는 신청할 수 없어요." });

    const approvedN = await prisma.joinRequest.count({ where: { meetupId: meetup.id, status: "APPROVED" } });
    if (approvedN + 1 >= meetup.maxN) return res.status(400).json({ message: "모집이 마감됐어요." });

    const jr = await prisma.joinRequest.upsert({
      where: { meetupId_applicantId: { meetupId: meetup.id, applicantId: req.user!.id } },
      update: { status: "PENDING" },
      create: { meetupId: meetup.id, applicantId: req.user!.id },
    });

    const applicant = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { nickname: true } });
    await notify(meetup.hostId, {
      type: "JOIN_REQUEST",
      message: `'${meetup.title}' 참여 신청 - ${applicant!.nickname}님이 신청했어요`,
      link: `/meetups/${meetup.id}`,
    });
    res.json({ status: jr.status });
  }),
);

// 방장 승인
meetupRouter.patch(
  "/:id/requests/:reqId/approve",
  asyncHandler(async (req, res) => {
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
      const { io } = await import("../socket/index.js");
      const { systemMessage } = await import("../socket/chat.js");
      if (io) await systemMessage(io, room.id, `${jr.applicant.nickname}님이 입장했어요 🎉`);
    }

    await notify(jr.applicantId, {
      type: "JOIN_APPROVED",
      message: `'${meetup.title}' 승인 완료! 채팅방이 열렸어요.`,
      link: room ? `/chats/${room.id}` : `/meetups/${meetup.id}`,
    });
    res.json({ ok: true, roomId: room?.id });
  }),
);

// 방장 거절
meetupRouter.patch(
  "/:id/requests/:reqId/reject",
  asyncHandler(async (req, res) => {
    const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
    if (!meetup || meetup.hostId !== req.user!.id) return res.status(403).json({ message: "방장만 처리할 수 있어요." });
    const jr = await prisma.joinRequest.update({ where: { id: req.params.reqId }, data: { status: "REJECTED" } });
    await notify(jr.applicantId, { type: "JOIN_REJECTED", message: `'${meetup.title}' 신청이 거절됐어요`, link: `/meetups/${meetup.id}` });
    res.json({ ok: true });
  }),
);

// 벙 종료
meetupRouter.post(
  "/:id/end",
  asyncHandler(async (req, res) => {
    const meetup = await prisma.meetup.findUnique({ where: { id: req.params.id } });
    if (!meetup || meetup.hostId !== req.user!.id) return res.status(403).json({ message: "방장만 종료할 수 있어요." });
    await prisma.meetup.update({ where: { id: meetup.id }, data: { ended: true } });
    const room = await prisma.chatRoom.findFirst({ where: { kind: "MEETUP", refId: meetup.id }, include: { members: true } });
    if (room) {
      const { io } = await import("../socket/index.js");
      const { systemMessage } = await import("../socket/chat.js");
      if (io) await systemMessage(io, room.id, "벙이 종료됐어요. 참여자 매너평가를 남겨주세요 🌡️");
      for (const m of room.members) {
        await notify(m.userId, { type: "RATE_REQUEST", message: `'${meetup.title}' 매너평가를 남겨주세요`, link: `/meetups/${meetup.id}` });
      }
    }
    res.json({ ok: true });
  }),
);
