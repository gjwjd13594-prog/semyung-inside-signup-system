import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { loginLimiter, phoneVerificationLimiter } from "../middleware/rateLimiters.js";
import { requireAuth, signAccessToken, signRefreshToken } from "../middleware/auth.js";
import { sendEmailVerification, sendPasswordReset } from "../utils/mailer.js";
import { CARRIERS, isValidKoreanMobile, normalizePhone } from "../utils/phone.js";
import { sendPhoneVerificationSms } from "../utils/sms.js";

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().regex(/^[a-z0-9_]{4,20}$/),
  email: z.string().email(),
  nickname: z.string().min(2).max(20),
  password: z.string().min(8),
  phone: z.string(),
  carrier: z.string(),
  phoneCode: z.string().regex(/^\d{6}$/),
});

const phoneSchema = z.object({
  phone: z.string(),
  carrier: z.string(),
  privacyAgreed: z.boolean(),
  phoneVerificationAgreed: z.boolean(),
});

const phoneVerifySchema = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/),
});

const secureCookie = process.env.NODE_ENV === "production";
const baseCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secureCookie,
  path: "/",
};
const accessCookieOptions = { ...baseCookieOptions, maxAge: 30 * 60 * 1000 };
const refreshCookieOptions = { ...baseCookieOptions, maxAge: 14 * 24 * 60 * 60 * 1000 };

authRouter.post(
  "/phone/send-code",
  phoneVerificationLimiter,
  asyncHandler(async (req, res) => {
    const input = phoneSchema.parse(req.body);
    const phone = normalizePhone(input.phone);

    if (!CARRIERS.has(input.carrier)) {
      return res.status(400).json({ message: "통신사를 선택해 주세요." });
    }
    if (!isValidKoreanMobile(phone)) {
      return res.status(400).json({ message: "휴대폰 번호는 01012345678 형식으로 입력해 주세요." });
    }
    if (!input.privacyAgreed || !input.phoneVerificationAgreed) {
      return res.status(400).json({ message: "개인정보 수집 및 인증 문자 발송에 동의해 주세요." });
    }

    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(409).json({ message: "이미 가입된 휴대폰 번호입니다." });
    }

    const recent = await prisma.phoneVerification.findFirst({
      where: {
        phone,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      return res.status(429).json({ message: "인증번호는 1분 뒤 다시 요청할 수 있습니다." });
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const codeHash = await bcrypt.hash(code, 10);

    await prisma.phoneVerification.deleteMany({ where: { phone, consumedAt: null } });
    const verification = await prisma.phoneVerification.create({
      data: {
        phone,
        carrier: input.carrier,
        codeHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    try {
      await sendPhoneVerificationSms(phone, code);
    } catch (error) {
      await prisma.phoneVerification.delete({ where: { id: verification.id } }).catch(() => undefined);
      throw error;
    }

    res.json({ message: "인증번호를 문자로 보냈습니다. 5분 안에 입력해 주세요.", phone });
  }),
);

authRouter.post(
  "/phone/verify-code",
  asyncHandler(async (req, res) => {
    const input = phoneVerifySchema.parse(req.body);
    const phone = normalizePhone(input.phone);

    const verification = await prisma.phoneVerification.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!verification) return res.status(400).json({ message: "인증번호를 먼저 받아주세요." });
    if (verification.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "인증번호가 만료되었습니다. 다시 받아주세요." });
    if (verification.attempts >= 5) return res.status(400).json({ message: "인증번호 입력 횟수를 초과했습니다. 다시 받아주세요." });

    const ok = await bcrypt.compare(input.code, verification.codeHash);
    if (!ok) {
      await prisma.phoneVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ message: "인증번호가 맞지 않습니다." });
    }

    await prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { verifiedAt: new Date() },
    });
    res.json({ message: "휴대폰 인증이 완료되었습니다.", phone });
  }),
);

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    if (!CARRIERS.has(input.carrier)) {
      return res.status(400).json({ message: "통신사를 선택해 주세요." });
    }
    if (!isValidKoreanMobile(phone)) {
      return res.status(400).json({ message: "휴대폰 번호는 01012345678 형식으로 입력해 주세요." });
    }

    const verification = await prisma.phoneVerification.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!verification || !verification.verifiedAt) {
      return res.status(400).json({ message: "휴대폰 인증을 완료해 주세요." });
    }
    if (verification.carrier !== input.carrier) {
      return res.status(400).json({ message: "인증번호를 받은 통신사와 선택한 통신사가 다릅니다." });
    }
    if (verification.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "휴대폰 인증 시간이 만료되었습니다. 다시 인증해 주세요." });
    }
    const codeOk = await bcrypt.compare(input.phoneCode, verification.codeHash);
    if (!codeOk) {
      return res.status(400).json({ message: "휴대폰 인증번호가 맞지 않습니다." });
    }

    const password = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
      data: {
        username: input.username.toLowerCase(),
        email: input.email.toLowerCase(),
        nickname: input.nickname,
        password,
        phone,
        carrier: input.carrier,
        phoneVerified: true,
      },
      select: { id: true, username: true, nickname: true, role: true, email: true },
    });
      await tx.phoneVerification.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
      return created;
    });

    // SMTP가 설정되어 있으면 가입 직후 인증 코드를 발송합니다.
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    try {
      await sendEmailVerification(user.email, code);
    } catch (error) {
      console.warn("이메일 인증 발송 실패:", error);
    }

    res.status(201).json({ user, emailVerificationSent: true });
  }),
);

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { login, password } = z.object({ login: z.string(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: login.toLowerCase() }, { email: login.toLowerCase() }],
      },
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    if (user.isBanned && (!user.banUntil || user.banUntil > new Date())) {
      return res.status(403).json({ message: user.banReason ?? "정지된 계정입니다." });
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const payload = { id: user.id, username: user.username, nickname: user.nickname, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    res.cookie("accessToken", accessToken, accessCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions);
    res.json({ user: payload });
  }),
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("accessToken", baseCookieOptions);
  res.clearCookie("refreshToken", baseCookieOptions);
  res.json({ message: "로그아웃되었습니다." });
});

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken ?? req.body.refreshToken;
    if (!token) return res.status(401).json({ message: "토큰이 없습니다." });
    const decoded = jwt.verify(token, config.jwtRefreshSecret) as { id: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, nickname: true, role: true },
    });
    if (!user) return res.status(401).json({ message: "사용자를 찾을 수 없습니다." });
    const accessToken = signAccessToken(user);
    res.cookie("accessToken", accessToken, accessCookieOptions);
    res.json({ user });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        profileImage: true,
        role: true,
        level: true,
        exp: true,
        createdAt: true,
      },
    });
    res.json({ user });
  }),
);

authRouter.get(
  "/check-username",
  asyncHandler(async (req, res) => {
    const username = String(req.query.username ?? "").toLowerCase();
    const user = await prisma.user.findUnique({ where: { username } });
    res.json({ available: Boolean(username) && !user });
  }),
);

authRouter.get(
  "/check-nickname",
  asyncHandler(async (req, res) => {
    const nickname = String(req.query.nickname ?? "");
    const user = await prisma.user.findUnique({ where: { nickname } });
    res.json({ available: Boolean(nickname) && !user });
  }),
);

authRouter.post(
  "/verify-email",
  requireAuth,
  asyncHandler(async (req, res) => {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    await sendEmailVerification(user.email, code);
    res.json({ message: "이메일 인증 코드를 발송했습니다." });
  }),
);

authRouter.post(
  "/find-password",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      const token = jwt.sign({ id: user.id, purpose: "password-reset" }, config.jwtSecret, { expiresIn: "30m" });
      const link = `${config.clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordReset(user.email, link);
    }
    // 계정 존재 여부를 노출하지 않습니다.
    res.json({ message: "가입된 이메일이라면 비밀번호 재설정 메일이 발송됩니다." });
  }),
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, password } = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
    const decoded = jwt.verify(token, config.jwtSecret) as { id: number; purpose?: string };
    if (decoded.purpose !== "password-reset") {
      return res.status(400).json({ message: "유효하지 않은 토큰입니다." });
    }
    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: decoded.id }, data: { password: hashed } });
    res.json({ message: "비밀번호가 재설정되었습니다." });
  }),
);
