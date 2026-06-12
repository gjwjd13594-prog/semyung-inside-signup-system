import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import { parse as parseCookie } from "cookie";
import { config } from "../config.js";
import { registerChatHandlers } from "./chat.js";

export let io: Server;

export function initSocket(server: http.Server) {
  io = new Server(server, {
    cors: { origin: config.allowedOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || "";
      const { accessToken } = parseCookie(raw);
      if (!accessToken) return next(new Error("UNAUTHORIZED"));
      const payload = jwt.verify(accessToken, config.jwtSecret) as { id: number; role: string };
      socket.data.userId = payload.id;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    registerChatHandlers(io, socket);
  });

  return io;
}
