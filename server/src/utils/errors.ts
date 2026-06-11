import { Prisma } from "../../generated/prisma/index.js";
import { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { appendServerLog } from "./serverLogs.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ message: `요청한 경로를 찾을 수 없습니다: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "입력값을 확인해 주세요.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  if (error instanceof MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "파일 크기가 너무 큽니다." : "파일 업로드 요청을 확인해 주세요.";
    return res.status(400).json({ message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return res.status(409).json({ message: "이미 사용 중인 값입니다." });
    if (error.code === "P2025") return res.status(404).json({ message: "요청한 데이터를 찾을 수 없습니다." });
  }

  const message = error instanceof Error ? error.message : "서버 오류가 발생했습니다.";
  const isExpectedClientError = /지원하지 않는|환경변수가 필요|찾을 수 없습니다|올바르지 않습니다|권한이 없습니다/.test(message);
  if (isExpectedClientError) {
    return res.status(400).json({ message });
  }

  appendServerLog({
    level: "error",
    source: "error-handler",
    message,
    method: req.method,
    path: req.originalUrl,
    statusCode: 500,
    ip: req.ip || req.socket.remoteAddress,
    userId: req.user?.id,
    meta: { name: error instanceof Error ? error.name : "UnknownError" },
  });
  console.error(error);
  res.status(500).json({ message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
};
