# 세명 인사이드 — Part 5 (Capacitor 앱 · FCM 푸시 · 계정 찾기/비밀번호 재설정)

> Part 1~4에 이어 마지막 파트입니다.
> ① React 웹앱을 Capacitor로 Android/iOS 앱으로 래핑
> ② FCM 푸시 — Part 4의 `notify()` 허브에 연결
> ③ 계정 찾기(가입 여부 확인) + SMS 인증 비밀번호 재설정

---

# A. 계정 찾기 / 비밀번호 재설정

## A-1. `prisma/schema.prisma` (추가분)

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  user      User     @relation("ResetTokens", fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  token     String   @unique   // 1회용 랜덤 토큰
  expiresAt DateTime            // 발급 후 10분
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
}

// User에 관계 추가:
// resetTokens PasswordResetToken[] @relation("ResetTokens")
```

> 적용: `npx prisma migrate dev -n add_password_reset`

## A-2. `server/src/routes/recovery.ts` (신규)

```ts
import { Router } from "express";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import { sendSms } from "../lib/solapi";            // 저장소에 이미 있는 SOLAPI 모듈 재사용
import { smsLimiter } from "../middleware/rateLimiters"; // 가입 SMS와 동일 rate limit 재사용

const router = Router();

// 인증코드 메모리 스토어(가입 SMS와 동일 패턴) — Redis 사용 중이면 그쪽으로
const codes = new Map<string, { code: string; expiresAt: number }>();

// 1) 계정 찾기 — 이 번호로 가입돼 있는지 확인
//    ⚠️ 사용자 열거(enumeration) 방지: 존재 여부와 무관하게 동일한 응답 + SMS로만 결과 통지
router.post("/find-account", smsLimiter, async (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (phone.length < 10) return res.status(400).json({ message: "올바른 번호를 입력해주세요." });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (user) {
    await sendSms(phone, `[세명인사이드] 회원 가입된 번호입니다. (닉네임: ${user.nickname})`);
  } else {
    await sendSms(phone, `[세명인사이드] 해당 번호로 가입된 계정이 없습니다.`);
  }
  // 응답은 항상 동일 — 화면에는 "문자로 안내를 보냈어요"만 표시
  res.json({ ok: true, message: "입력하신 번호로 안내 문자를 보냈어요." });
});

// 2) 비밀번호 재설정 — 인증코드 발송
router.post("/reset/send-code", smsLimiter, async (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const user = await prisma.user.findUnique({ where: { phone } });
  // 존재하지 않아도 같은 응답 (열거 방지). 존재할 때만 실제 발송.
  if (user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    codes.set(phone, { code, expiresAt: Date.now() + 5 * 60_000 });
    await sendSms(phone, `[세명인사이드] 비밀번호 재설정 인증번호: ${code} (5분 내 입력)`);
  }
  res.json({ ok: true, message: "가입된 번호라면 인증번호가 발송됩니다." });
});

// 3) 인증코드 확인 → 1회용 재설정 토큰 발급 (10분)
router.post("/reset/verify-code", async (req, res) => {
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
});

// 4) 새 비밀번호 설정 (토큰 1회용)
router.post("/reset/confirm", async (req, res) => {
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
    // 보안: 기존 세션 무효화를 위해 refresh 토큰 회전을 쓰고 있다면 여기서 폐기
  ]);
  res.json({ ok: true, message: "비밀번호가 변경됐어요. 새 비밀번호로 로그인해주세요." });
});

export default router;
```

```ts
// app.ts
app.use("/api/recovery", recoveryRoutes);
```

## A-3. 클라이언트 — 로그인 화면 하단 링크 + 재설정 플로우

```tsx
// LoginPage.tsx 하단에 추가
<div className="text-center text-sm mt-3 text-gray-500">
  <a href="/recovery" className="underline">계정 찾기 / 비밀번호 재설정</a>
</div>
```

```tsx
// client/src/pages/RecoveryPage.tsx (신규) — 3단계 위저드
// step 1: 전화번호 입력 → [계정 찾기(문자 안내)] 또는 [비밀번호 재설정(코드 발송)]
// step 2: 6자리 코드 입력 → verify-code → resetToken 보관
// step 3: 새 비밀번호 + 확인 입력 → confirm → 로그인 페이지로
// (UI는 기존 RegisterPage 스타일 재사용 — Claude Code에서 기존 컴포넌트에 맞춰 생성)
```

**보안 포인트**
- 계정 존재 여부를 **화면에 절대 노출하지 않음**(열거 공격 방지) — 결과는 SMS로만
- 인증코드 5분 / 재설정 토큰 10분 + 1회용
- SMS rate limit 재사용 (번호당 발송 제한)
- 비밀번호 변경 시 기존 refresh 토큰 폐기 권장

---

# B. Capacitor 앱 래핑

## B-1. 설치 및 초기화 (client 디렉토리에서)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/push-notifications @capacitor/app @capacitor/status-bar
npx cap init "세명인사이드" "com.semyunginside.app" --web-dir=dist
npx cap add android
npx cap add ios   # macOS에서만
```

## B-2. `capacitor.config.ts`

```ts
import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.semyunginside.app",
  appName: "세명인사이드",
  webDir: "dist",
  server: {
    // 개발 중엔 로컬 서버 라이브 리로드 (배포 빌드에선 제거)
    // url: "http://192.168.0.x:5173", cleartext: true,
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};
export default config;
```

## B-3. 쿠키 인증 주의 ⚠️ (가장 흔한 함정)

Capacitor 앱은 `capacitor://localhost`(iOS) / `https://localhost`(Android) 오리진에서 돌아가므로, **httpOnly 쿠키가 크로스 오리진**이 됩니다.

서버 설정 변경:

```ts
// CORS — Capacitor 오리진 허용
app.use(cors({
  origin: [config.clientOrigin, "capacitor://localhost", "https://localhost"],
  credentials: true,
}));

// 쿠키 — 크로스 오리진 전송 허용 (HTTPS 필수)
res.cookie("accessToken", token, {
  httpOnly: true,
  secure: true,        // SameSite=None은 secure 필수
  sameSite: "none",    // ← 기존 "lax"에서 변경
  maxAge: 60 * 60 * 1000,
});
```

> 운영 API는 반드시 HTTPS여야 합니다. 그리고 Socket.io도 동일 CORS 설정 적용 (Part 4 `initSocket`의 origin 배열에 두 오리진 추가).

## B-4. 빌드 & 실행

```bash
npm run build && npx cap sync
npx cap open android   # Android Studio에서 실행/서명
npx cap open ios       # Xcode (macOS)
```

---

# C. FCM 푸시 — `notify()` 허브에 연결

## C-1. Firebase 준비

1. Firebase 콘솔에서 프로젝트 생성 → Android 앱 등록(`com.semyunginside.app`) → `google-services.json`을 `android/app/`에 배치
2. iOS는 APNs 키 업로드 + `GoogleService-Info.plist`
3. 서버용: 프로젝트 설정 → 서비스 계정 → **비공개 키(JSON)** 발급 → 서버 `.env` 경로 등록 (깃 커밋 금지)

```bash
# server
npm i firebase-admin
```

## C-2. `prisma/schema.prisma` (추가분)

```prisma
model DeviceToken {
  id        String   @id @default(cuid())
  user      User     @relation("DeviceTokens", fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  token     String   @unique
  platform  String   // android | ios
  createdAt DateTime @default(now())

  @@index([userId])
}
// User에: deviceTokens DeviceToken[] @relation("DeviceTokens")
```

## C-3. `server/src/lib/fcm.ts` (신규)

```ts
import admin from "firebase-admin";
import { prisma } from "../prisma";

admin.initializeApp({
  credential: admin.credential.cert(process.env.FIREBASE_SA_PATH!),
});

export async function pushToUser(userId: string, title: string, body?: string, data?: Record<string, string>) {
  const tokens = await prisma.deviceToken.findMany({ where: { userId } });
  if (!tokens.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title, body },
    data: data ?? {},
  });

  // 만료/무효 토큰 정리
  const invalid: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(r.error?.code ?? "")) {
      invalid.push(tokens[i].token);
    }
  });
  if (invalid.length) await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
}
```

## C-4. `notify()` 허브에 한 줄 연결 (Part 4의 services/notify.ts 수정)

```ts
import { pushToUser } from "../lib/fcm";

export async function notify(userId: string, input: NotifyInput) {
  const n = await prisma.notification.create({ data: { userId, ...input } });
  const { io } = await import("../socket");
  io.to(`user:${userId}`).emit("notification:new", n);

  // ▼ 추가: 앱 푸시 (소켓 미접속 사용자에게 도달)
  await pushToUser(userId, input.title, input.body, { refId: input.refId ?? "", type: input.type }).catch(() => {});
  return n;
}
```

이걸로 **참여 신청 / 승인 / 새 메시지 / 매칭 / 프로필 승인** 푸시가 전부 자동으로 나갑니다 — Part 4에서 알림을 한 함수로 모아둔 이유.

## C-5. 디바이스 토큰 등록 API + 클라이언트

```ts
// server/src/routes/devices.ts (신규)
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.post("/token", async (req, res) => {
  const { token, platform } = req.body ?? {};
  if (!token) return res.status(400).json({ message: "토큰이 필요합니다." });
  await prisma.deviceToken.upsert({
    where: { token },
    update: { userId: req.user!.id, platform: platform ?? "android" },
    create: { userId: req.user!.id, token, platform: platform ?? "android" },
  });
  res.json({ ok: true });
});

router.delete("/token", async (req, res) => {  // 로그아웃 시 호출
  const { token } = req.body ?? {};
  if (token) await prisma.deviceToken.deleteMany({ where: { token, userId: req.user!.id } });
  res.json({ ok: true });
});

export default router;
// app.ts: app.use("/api/devices", deviceRoutes);
```

```ts
// client/src/lib/push.ts (신규) — 로그인 성공 후 호출
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "../api/client";

export async function initPush() {
  if (!Capacitor.isNativePlatform()) return; // 웹에선 스킵

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;

  await PushNotifications.register();

  PushNotifications.addListener("registration", ({ value }) => {
    api.post("/devices/token", { token: value, platform: Capacitor.getPlatform() });
  });

  // 푸시 탭 → 해당 화면으로 이동 (refId/type 데이터 활용)
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const { type, refId } = action.notification.data ?? {};
    if (type === "NEW_MESSAGE" && refId) window.location.href = `/chats/${refId}`;
    else if (type === "JOIN_REQUEST" && refId) window.location.href = `/meetups/${refId}`;
    else window.location.href = "/notifications";
  });
}
```

---

# 적용 순서 (Part 5)

1. **A 계정찾기**: schema 반영 → migrate → `recovery.ts` 등록 → `RecoveryPage` 추가 + 로그인 링크
2. **B Capacitor**: 설치 → init → 쿠키 `sameSite:"none"` + CORS 오리진 추가 → 빌드 → `cap sync`
3. **C 푸시**: Firebase 설정 → `fcm.ts` + `devices.ts` → `notify()`에 pushToUser 연결 → 클라 `initPush()` 로그인 후 호출
4. 실기기 테스트: 신청→방장 푸시 / 승인→신청자 푸시 / 백그라운드 메시지 푸시 / 비밀번호 재설정 전체 플로우

# 스토어 제출 전 체크리스트

- [ ] 관리자 비밀번호 변경 + seed(.env) 방식 전환 (코드/대화에 노출된 기존 비밀번호 폐기)
- [ ] 이용권 판매 → 인앱결제(Google Play Billing / StoreKit) 전환 — 디지털 재화는 PG 직결제 불가
- [ ] 개인정보처리방침 URL 준비 (스토어 등록 필수)
- [ ] 사진 포함 앱 → Play Console '데이터 보안' 섹션, App Store '개인정보 영양표' 작성
- [ ] 차단 기능 구현 — 매칭류 앱은 신고+차단이 스토어 심사에서 사실상 필수 (특히 iOS UGC 가이드라인 1.2)
- [ ] 만 14세 확인 / 통신판매업 신고(유료 결제 시)
