import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "../prisma.js";
import { sendSms, sendPhoneVerificationSms } from "../utils/sms.js";
import { phoneVerificationLimiter } from "../middleware/rateLimiters.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const recoveryRouter = Router();

const codes = new Map<string, { code: string; expiresAt: number }>();

// 1) 계정 찾기 — 이 번호로 가입돼 있는지 SMS로 안내 (열거 방지)
recoveryRouter.post(
  "/find-account",
  phoneVerificationLimiter,
  asyncHandler(async (req, res) => {
    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    if (phone.length < 10) return res.status(400).json({ message: "올바른 번호를 입력해주세요." });

    const user = await prisma.user.findUnique({ where: { phone } });
    if (user) {
      await sendSms(phone, `[세명인사이드] 회원 가입된 번호입니다. (닉네임: ${user.nickname})`);
    } else {
      await sendSms(phone, `[세명인사이드] 해당 번호로 가입된 계정이 없습니다.`);
    }
    res.json({ ok: true, message: "입력하신 번호로 안내 문자를 보냈어요." });
  }),
);

// 2) 비밀번호 재설정 — 인증코드 발송
recoveryRouter.post(
  "/reset/send-code",
  phoneVerificationLimiter,
  asyncHandler(async (req, res) => {
    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      codes.set(phone, { code, expiresAt: Date.now() + 5 * 60_000 });
      await sendPhoneVerificationSms(phone, code);
    }
    res.json({ ok: true, message: "가입된 번호라면 인증번호가 발송됩니다." });
  }),
);

// 3) 인증코드 확인 → 1회용 재설정 토큰 발급 (10분)
recoveryRouter.post(
  "/reset/verify-code",
  asyncHandler(async (req, res) => {
    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    const code = String(req.body?.code || "");
    const saved = codes.get(phone);
    if (!saved || saved.expiresAt < Date.now() || saved.code !== code) {
      return res.status(400).json({ message: "인증번호가 올바르지 않거나 만료됐어요." });
    }
    codes.delete(phone);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) return res.status(400).json({ message: "인증에 실패했어요." });

    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    res.json({ ok: true, resetToken: token });
  }),
);

// 4) 새 비밀번호 설정 (토큰 1회용)
recoveryRouter.post(
  "/reset/confirm",
  asyncHandler(async (req, res) => {
    const { resetToken, newPassword } = req.body ?? {};
    if (!resetToken || !newPassword) return res.status(400).json({ message: "잘못된 요청입니다." });
    if (String(newPassword).length < 6) return res.status(400).json({ message: "비밀번호는 6자 이상이어야 해요." });

    const row = await prisma.passwordResetToken.findUnique({ where: { token: resetToken } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      return res.status(400).json({ message: "만료되었거나 이미 사용된 링크예요. 처음부터 다시 진행해주세요." });
    }

    const hashed = await bcrypt.hash(String(newPassword), 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { password: hashed } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ ok: true, message: "비밀번호가 변경됐어요. 새 비밀번호로 로그인해주세요." });
  }),
);
