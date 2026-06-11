import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  commandTimeout: 5000,
});

redis.on("error", () => {
  // Redis가 없어도 개발 서버가 죽지 않게 둡니다. 조회수 중복 방지는 메모리 캐시로 보완됩니다.
});
