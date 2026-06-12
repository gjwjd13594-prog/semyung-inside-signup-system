import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadPhoto, deletePhoto } from "../lib/storage.js";
import { sha256, aHash } from "../lib/imageHash.js";
import { findExactDuplicate } from "../services/dedup.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const photoRouter = Router();
photoRouter.use(requireAuth);

const MAX_PHOTOS = 5;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 1) 사진 목록
photoRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const photos = await prisma.profilePhoto.findMany({
      where: { userId: req.user!.id },
      orderBy: { order: "asc" },
      select: { id: true, url: true, isPrimary: true, order: true },
    });
    res.json({ photos });
  }),
);

// 2) 사진 업로드 (multipart/form-data)
photoRouter.post(
  "/upload",
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "사진 파일이 필요합니다." });

    const count = await prisma.profilePhoto.count({ where: { userId: req.user!.id } });
    if (count >= MAX_PHOTOS) return res.status(400).json({ message: "사진은 최대 5장까지 등록할 수 있어요." });

    const buffer = req.file.buffer;
    const hash = sha256(buffer);
    const phash = await aHash(buffer);

    // 도용 방지: 다른 사용자가 동일 파일 사용 중인지 확인
    const exact = await findExactDuplicate(hash, req.user!.id);
    if (exact) {
      return res.status(409).json({ message: "이미 다른 회원이 등록한 사진이에요. 본인 사진을 등록해주세요." });
    }

    const { key, url } = await uploadPhoto(req.user!.id, buffer, req.file.mimetype);

    const photo = await prisma.profilePhoto.create({
      data: { userId: req.user!.id, key, url, sha256: hash, phash, isPrimary: count === 0, order: count },
    });
    res.status(201).json({ id: photo.id, url: photo.url, isPrimary: photo.isPrimary });
  }),
);

// 3) 사진 삭제
photoRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const photo = await prisma.profilePhoto.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!photo) return res.status(404).json({ message: "사진을 찾을 수 없어요." });
    await deletePhoto(photo.key).catch(() => {});
    await prisma.profilePhoto.delete({ where: { id: photo.id } });
    if (photo.isPrimary) {
      const next = await prisma.profilePhoto.findFirst({ where: { userId: req.user!.id }, orderBy: { order: "asc" } });
      if (next) await prisma.profilePhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    res.json({ ok: true });
  }),
);

// 4) 대표 사진 변경
photoRouter.patch(
  "/:id/primary",
  asyncHandler(async (req, res) => {
    const photo = await prisma.profilePhoto.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!photo) return res.status(404).json({ message: "사진을 찾을 수 없어요." });
    await prisma.$transaction([
      prisma.profilePhoto.updateMany({ where: { userId: req.user!.id }, data: { isPrimary: false } }),
      prisma.profilePhoto.update({ where: { id: photo.id }, data: { isPrimary: true } }),
    ]);
    res.json({ ok: true });
  }),
);

// 5) 심사 제출
photoRouter.post(
  "/submit-review",
  asyncHandler(async (req, res) => {
    const count = await prisma.profilePhoto.count({ where: { userId: req.user!.id } });
    if (count < 1) return res.status(400).json({ message: "사진을 1장 이상 등록해주세요." });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { photoStatus: "PENDING", photoRejectReason: null },
    });
    res.json({ ok: true, photoStatus: "PENDING" });
  }),
);
