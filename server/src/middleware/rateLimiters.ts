import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { RedisRateLimitStore } from "../utils/redisRateLimitStore.js";

function store(name: string) {
  return config.rateLimit.useRedis ? new RedisRateLimitStore(name) : undefined;
}

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  store: store("global"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  store: store("api"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "API 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

export const adminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  store: store("admin"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "관리자 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: store("login"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." },
});

export const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: store("post"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "글쓰기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

export const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  store: store("comment"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "댓글 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
});

export const phoneVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  store: store("phone-verification"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "인증번호 요청이 너무 많습니다. 10분 후 다시 시도해 주세요." },
});
