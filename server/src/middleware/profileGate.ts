import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

export async function requireApprovedProfile(req: Request, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { photoStatus: true },
  });
  if (user?.photoStatus !== "APPROVED") {
    return res.status(403).json({
      code: "PROFILE_NOT_APPROVED",
      message: "프로필 사진 승인 후 이용할 수 있어요.",
      photoStatus: user?.photoStatus ?? "NONE",
    });
  }
  next();
}
