import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../../generated/prisma/index.js";
import { config } from "../config.js";
import { prisma } from "../prisma.js";

export type AuthUser = {
  id: number;
  username: string;
  nickname: string;
  role: UserRole;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "30m" });
}

export function signRefreshToken(user: AuthUser) {
  return jwt.sign({ id: user.id }, config.jwtRefreshSecret, { expiresIn: "14d" });
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    await attachAuthUser(req);
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    await attachAuthUser(req);
    if (!req.user) return res.status(401).json({ message: "로그인이 필요합니다." });
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "로그인이 필요합니다." });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: "권한이 없습니다." });
    next();
  };
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    await attachAuthUser(req);
    if (!req.user) return res.status(401).json({ message: "로그인이 필요합니다." });
    if (req.user.role !== UserRole.ADMIN) return res.status(403).json({ message: "관리자 권한이 필요합니다." });
    next();
  } catch (error) {
    next(error);
  }
}

function readToken(req: Request) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies?.accessToken;
}

async function attachAuthUser(req: Request) {
  const token = readToken(req);
  if (!token) return;

  const decoded = verifyAccessToken(token);
  if (!decoded) return;

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, username: true, nickname: true, role: true, isBanned: true, banUntil: true },
  });
  if (user && !isCurrentlyBanned(user)) {
    req.user = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    };
  }
}

function verifyAccessToken(token: string) {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    return null;
  }
}

function isCurrentlyBanned(user: { isBanned: boolean; banUntil: Date | null }) {
  if (!user.isBanned) return false;
  if (!user.banUntil) return true;
  return user.banUntil.getTime() > Date.now();
}
