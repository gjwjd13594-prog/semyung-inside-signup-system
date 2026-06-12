import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import http from "http";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { photoRouter } from "./routes/photos.js";
import { meetupRouter } from "./routes/meetups.js";
import { chatRouter } from "./routes/chats.js";
import { recoveryRouter } from "./routes/recovery.js";
import { devicesRouter } from "./routes/devices.js";
import { globalLimiter, apiLimiter, adminLimiter } from "./middleware/rateLimiters.js";
import { firewall } from "./middleware/firewall.js";
import { optionalAuth } from "./middleware/auth.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { initSocket } from "./socket/index.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(globalLimiter);
app.use(firewall);
app.use(optionalAuth);
app.use(requestLogger);

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/api", apiLimiter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminLimiter, adminRouter);
app.use("/api/photos", photoRouter);
app.use("/api/meetups", meetupRouter);
app.use("/api/chats", chatRouter);
app.use("/api/recovery", recoveryRouter);
app.use("/api/devices", devicesRouter);

const server = http.createServer(app);
initSocket(server);

server.listen(config.port, () => {
  console.log(`[server] listening on port ${config.port}`);
});

export { app, server };
