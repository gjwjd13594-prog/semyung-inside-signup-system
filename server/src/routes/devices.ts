import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

devicesRouter.post(
  "/token",
  asyncHandler(async (req, res) => {
    const { token, platform } = req.body ?? {};
    if (!token) return res.status(400).json({ message: "토큰이 필요합니다." });
    await prisma.deviceToken.upsert({
      where: { token },
      update: { userId: req.user!.id, platform: platform ?? "android" },
      create: { userId: req.user!.id, token, platform: platform ?? "android" },
    });
    res.json({ ok: true });
  }),
);

devicesRouter.delete(
  "/token",
  asyncHandler(async (req, res) => {
    const { token } = req.body ?? {};
    if (token) await prisma.deviceToken.deleteMany({ where: { token, userId: req.user!.id } });
    res.json({ ok: true });
  }),
);
