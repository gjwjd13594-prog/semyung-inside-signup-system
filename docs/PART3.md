# 세명 인사이드 — Part 3 (프로필 사진 승인 · 도용 방지)

> Part 1(회원/관리자), Part 2(게시글/신고)에 이어, 프로필 사진(1~5장) 업로드 + 관리자 승인 + 사진 도용 방지를 구현합니다.
> 스택: Express + Prisma + AWS S3(presigned) + sharp(이미지 해시).

---

## 0. 변경 요약

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/schema.prisma` | `ProfilePhoto` 모델, `PhotoStatus` enum, `User` 필드 추가 |
| 서버 | `server/src/lib/s3.ts` | **신규** — presigned 업로드/삭제 |
| 서버 | `server/src/lib/imageHash.ts` | **신규** — sha256 + aHash(지각 해시) + 해밍거리 |
| 서버 | `server/src/routes/photos.ts` | **신규** — 업로드·목록·삭제·대표 설정·심사 제출 |
| 서버 | `server/src/services/dedup.ts` | **신규** — 도용(중복 사진) 탐지 |
| 서버 | `server/src/middleware/profileGate.ts` | **신규** — 승인 전 기능 잠금 |
| 서버 | `server/src/routes/admin.ts` | 승인 대기 목록 / 승인 / 부적합 (도용 플래그 포함) |
| env | `server/.env.example` | S3 변수 추가 |
| 패키지 | — | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp` |

```bash
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp
```

---

## 1. `prisma/schema.prisma` (추가/변경분)

```prisma
enum PhotoStatus {
  NONE       // 사진 없음
  PENDING    // 승인 대기
  APPROVED   // 승인됨
  REJECTED   // 부적합
}

model User {
  // ... 기존 필드 (Part 1) ...
  photoStatus       PhotoStatus    @default(NONE)
  photoRejectReason String?
  datingVisible     Boolean        @default(true)   // 소개팅 노출 on/off
  photos            ProfilePhoto[]
}

model ProfilePhoto {
  id        String   @id @default(cuid())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  key       String   // S3 object key
  url       String   // 공개 URL (또는 조회용 presigned)
  sha256    String   // 정확 일치용 해시
  phash     String   // 지각 해시(aHash, 16 hex) — 유사 도용 탐지
  isPrimary Boolean  @default(false)
  order     Int      @default(0)
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([sha256])
}
```

> 적용: `npx prisma migrate dev -n add_profile_photos`

---

## 2. `server/src/lib/s3.ts` (신규)

```ts
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { config } from "../config";

const s3 = new S3Client({ region: config.s3.region });

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// 업로드용 presigned URL 발급 (클라이언트가 직접 S3로 PUT)
export async function createUploadUrl(userId: string, contentType: string) {
  if (!ALLOWED.includes(contentType)) {
    throw Object.assign(new Error("지원하지 않는 이미지 형식입니다."), { status: 400 });
  }
  const ext = contentType.split("/")[1];
  const key = `profile/${userId}/${randomUUID()}.${ext}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, ContentType: contentType }),
    { expiresIn: 60 } // 60초
  );
  const publicUrl = `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
  return { uploadUrl: url, key, publicUrl };
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}
```

> `config.s3` 는 `server/src/config.ts`에 `{ region, bucket }` 형태로 추가하세요.

---

## 3. `server/src/lib/imageHash.ts` (신규)

```ts
import sharp from "sharp";
import { createHash } from "crypto";

// 정확 일치용 sha256
export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// 지각 해시(aHash, average hash) — 64bit → 16 hex
// 리사이즈/약한 편집에도 유사하게 유지되어 '도용 의심' 탐지에 사용
export async function aHash(buffer: Buffer): Promise<string> {
  const px = await sharp(buffer).grayscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  const avg = px.reduce((s, v) => s + v, 0) / px.length;
  let bits = "";
  for (const v of px) bits += v >= avg ? "1" : "0";
  // 64bit → hex
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// 두 aHash의 해밍 거리(다른 비트 수). 작을수록 비슷함.
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
```

---

## 4. `server/src/services/dedup.ts` (신규 — 도용 탐지)

```ts
import { prisma } from "../prisma";
import { hamming } from "../lib/imageHash";

const PHASH_THRESHOLD = 5; // 해밍거리 ≤ 5 이면 '유사' (튜닝 가능)

// 정확 일치(동일 파일) — 다른 사용자가 같은 사진을 이미 사용 중인가
export async function findExactDuplicate(sha256: string, exceptUserId: string) {
  return prisma.profilePhoto.findFirst({
    where: { sha256, userId: { not: exceptUserId } },
    include: { user: { select: { id: true, nickname: true } } },
  });
}

// 유사 일치(지각 해시) — 다른 사용자 사진과 시각적으로 거의 동일한가
export async function findSimilarOwners(phash: string, exceptUserId: string) {
  // 규모가 커지면 phash 프리픽스 인덱싱/벡터DB로 최적화. 데모 단계는 후보 스캔.
  const candidates = await prisma.profilePhoto.findMany({
    where: { userId: { not: exceptUserId } },
    select: { phash: true, user: { select: { id: true, nickname: true } } },
  });
  const hits = new Map<string, string>(); // userId -> nickname
  for (const c of candidates) {
    if (hamming(phash, c.phash) <= PHASH_THRESHOLD) hits.set(c.user.id, c.user.nickname);
  }
  return [...hits].map(([id, nickname]) => ({ id, nickname }));
}

// 한 사용자의 모든 사진에 대해 도용 의심 대상자 집계
export async function detectImpersonation(userId: string) {
  const photos = await prisma.profilePhoto.findMany({ where: { userId } });
  const owners = new Map<string, string>();
  for (const p of photos) {
    const exact = await findExactDuplicate(p.sha256, userId);
    if (exact) owners.set(exact.user.id, exact.user.nickname);
    const sim = await findSimilarOwners(p.phash, userId);
    sim.forEach((o) => owners.set(o.id, o.nickname));
  }
  return [...owners.values()]; // 의심되는 기존 사용자 닉네임 목록
}
```

---

## 5. `server/src/routes/photos.ts` (신규 — 사용자 사진 관리)

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { createUploadUrl, deleteObject } from "../lib/s3";
import { sha256, aHash } from "../lib/imageHash";
import { findExactDuplicate } from "../services/dedup";

const router = Router();
router.use(requireAuth);

const MAX_PHOTOS = 5;

// 1) 업로드 URL 발급
router.post("/upload-url", async (req, res, next) => {
  try {
    const { contentType } = req.body ?? {};
    const count = await prisma.profilePhoto.count({ where: { userId: req.user!.id } });
    if (count >= MAX_PHOTOS) return res.status(400).json({ message: "사진은 최대 5장까지 등록할 수 있어요." });
    const result = await createUploadUrl(req.user!.id, contentType);
    res.json(result);
  } catch (e) { next(e); }
});

// 2) 업로드 확정 — 클라이언트가 바이트를 서버로 보내 해시 계산 + 도용 검사 후 등록
//    (해시는 신뢰 위해 서버에서 계산. multipart 또는 base64 수신)
router.post("/confirm", async (req, res) => {
  const schema = z.object({ key: z.string(), url: z.string(), dataBase64: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "잘못된 요청입니다." });

  const { key, url, dataBase64 } = parsed.data;
  const buffer = Buffer.from(dataBase64, "base64");

  const count = await prisma.profilePhoto.count({ where: { userId: req.user!.id } });
  if (count >= MAX_PHOTOS) return res.status(400).json({ message: "사진은 최대 5장까지 등록할 수 있어요." });

  const hash = sha256(buffer);
  const phash = await aHash(buffer);

  // 🔒 도용 방지: 다른 사용자가 동일 파일을 이미 사용 중이면 등록 차단
  const exact = await findExactDuplicate(hash, req.user!.id);
  if (exact) {
    await deleteObject(key).catch(() => {});
    return res.status(409).json({ message: "이미 다른 회원이 등록한 사진이에요. 본인 사진을 등록해주세요." });
  }

  const photo = await prisma.profilePhoto.create({
    data: { userId: req.user!.id, key, url, sha256: hash, phash, isPrimary: count === 0, order: count },
  });
  res.status(201).json({ id: photo.id, url: photo.url, isPrimary: photo.isPrimary });
});

// 3) 내 사진 목록
router.get("/", async (req, res) => {
  const photos = await prisma.profilePhoto.findMany({
    where: { userId: req.user!.id },
    orderBy: { order: "asc" },
    select: { id: true, url: true, isPrimary: true, order: true },
  });
  res.json({ photos });
});

// 4) 사진 삭제 (최소 1장 유지 규칙은 심사 제출 시 검증)
router.delete("/:id", async (req, res) => {
  const photo = await prisma.profilePhoto.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!photo) return res.status(404).json({ message: "사진을 찾을 수 없어요." });
  await deleteObject(photo.key).catch(() => {});
  await prisma.profilePhoto.delete({ where: { id: photo.id } });
  // 대표 사진이 삭제되면 다음 사진을 대표로 승격
  if (photo.isPrimary) {
    const next = await prisma.profilePhoto.findFirst({ where: { userId: req.user!.id }, orderBy: { order: "asc" } });
    if (next) await prisma.profilePhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  res.json({ ok: true });
});

// 5) 대표 사진 변경
router.patch("/:id/primary", async (req, res) => {
  const photo = await prisma.profilePhoto.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!photo) return res.status(404).json({ message: "사진을 찾을 수 없어요." });
  await prisma.$transaction([
    prisma.profilePhoto.updateMany({ where: { userId: req.user!.id }, data: { isPrimary: false } }),
    prisma.profilePhoto.update({ where: { id: photo.id }, data: { isPrimary: true } }),
  ]);
  res.json({ ok: true });
});

// 6) 심사 제출 — 1장 이상이어야 PENDING 전환
router.post("/submit-review", async (req, res) => {
  const count = await prisma.profilePhoto.count({ where: { userId: req.user!.id } });
  if (count < 1) return res.status(400).json({ message: "사진을 1장 이상 등록해주세요." });
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { photoStatus: "PENDING", photoRejectReason: null },
  });
  res.json({ ok: true, photoStatus: "PENDING" });
});

export default router;
```

### 라우터 등록 (`app.ts`)

```ts
import photoRoutes from "./routes/photos";
app.use("/api/photos", photoRoutes);
```

---

## 6. `server/src/middleware/profileGate.ts` (신규 — 승인 전 기능 잠금)

```ts
import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";

// 프로필 사진이 APPROVED인 사용자만 통과. 소개팅/번개/과팅/채팅 라우트에 적용.
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
```

```ts
// 사용 예: 기능 라우터에 게이트 적용
import { requireApprovedProfile } from "../middleware/profileGate";
app.use("/api/dating", requireAuth, requireApprovedProfile, datingRoutes);
app.use("/api/meetups", requireAuth, requireApprovedProfile, meetupRoutes);
```

---

## 7. `server/src/routes/admin.ts` (추가분 — 승인 검수)

```ts
import { detectImpersonation } from "../services/dedup";

// 승인 대기 프로필 목록 (사진 + 도용 의심 플래그)
router.get("/profiles/pending", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { photoStatus: "PENDING" },
    select: {
      id: true, nickname: true, gender: true, year: true, dept: true,
      phone: true, intro: true,
      photos: { orderBy: { order: "asc" }, select: { id: true, url: true, isPrimary: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 각 사용자별 도용 의심 대상 집계
  const withFlags = await Promise.all(
    users.map(async (u) => ({
      ...u,
      phone: maskPhone(u.phone),                 // 목록은 마스킹
      impersonationSuspects: await detectImpersonation(u.id),
    }))
  );
  res.json({ items: withFlags });
});

// 단건 상세 (관리자는 전화번호 원문 열람 가능)
router.get("/profiles/:userId", async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: {
      id: true, nickname: true, gender: true, year: true, dept: true, intro: true,
      phone: true, photoStatus: true,
      photos: { orderBy: { order: "asc" }, select: { id: true, url: true, isPrimary: true } },
    },
  });
  if (!u) return res.status(404).json({ message: "사용자를 찾을 수 없어요." });
  const suspects = await detectImpersonation(u.id);
  res.json({ ...u, impersonationSuspects: suspects }); // 전화번호 원문 — 열람 로그 기록
});

// 승인
router.patch("/profiles/:userId/approve", async (req, res) => {
  await prisma.user.update({
    where: { id: req.params.userId },
    data: { photoStatus: "APPROVED", photoRejectReason: null },
  });
  await prisma.adminAuditLog.create({ data: { actorId: req.user!.id, action: "PROFILE_APPROVE", targetId: req.params.userId } });
  res.json({ ok: true });
});

// 부적합 (사유 필수)
router.patch("/profiles/:userId/reject", async (req, res) => {
  const { reason } = req.body ?? {};
  if (!reason) return res.status(400).json({ message: "부적합 사유를 입력해주세요." });
  await prisma.user.update({
    where: { id: req.params.userId },
    data: { photoStatus: "REJECTED", photoRejectReason: reason },
  });
  await prisma.adminAuditLog.create({ data: { actorId: req.user!.id, action: "PROFILE_REJECT", targetId: req.params.userId, memo: reason } });
  res.json({ ok: true });
});
```

> `maskPhone` 은 Part 1의 `utils/mask.ts` 를 그대로 사용합니다.

---

## 8. `server/.env.example` (추가분)

```
# 프로필 사진 저장용 S3
AWS_REGION=ap-northeast-2
S3_BUCKET=semyunginside-profile
# (S3 권한은 IAM 역할/키로 부여)
```

---

## 9. 클라이언트 업로드 흐름 (`client/src/api/photos.ts`)

```ts
import { api } from "./client";

export const photoApi = {
  list: () => api.get("/photos").then((r) => r.data.photos),

  // 1) presigned URL → 2) S3 PUT → 3) confirm(서버 해시·도용검사)
  upload: async (file: File) => {
    const { data } = await api.post("/photos/upload-url", { contentType: file.type });
    await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    const dataBase64 = await fileToBase64(file);
    return api.post("/photos/confirm", { key: data.key, url: data.publicUrl, dataBase64 }).then((r) => r.data);
  },

  remove: (id: string) => api.delete(`/photos/${id}`),
  setPrimary: (id: string) => api.patch(`/photos/${id}/primary`),
  submitReview: () => api.post("/photos/submit-review"),
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
```

---

## 적용 순서

1. 패키지 설치 → `schema.prisma` 반영 → `npx prisma migrate dev -n add_profile_photos`
2. `.env`에 `AWS_REGION`, `S3_BUCKET` 추가, `config.s3` 작성
3. `lib/s3.ts`, `lib/imageHash.ts`, `services/dedup.ts`, `routes/photos.ts`, `middleware/profileGate.ts` 추가
4. `admin.ts`에 승인 검수 라우트 추가, 기능 라우터에 `requireApprovedProfile` 적용
5. 클라: `api/photos.ts`로 업로드 → 심사 제출 → 관리자 승인 후 기능 해제

---

## 보안·운영 메모

- **해시는 항상 서버에서 계산** — 클라이언트 값 신뢰 금지(도용 우회 방지).
- **정확 일치(sha256)**: 동일 파일 차단. **유사 일치(aHash)**: 리사이즈·약한 편집 도용을 관리자에게 ⚠️ 경고로 노출(자동 차단보다 사람 검토 권장).
- aHash는 가볍지만 한계가 있어요. 정확도가 중요하면 **pHash(DCT 기반)** 또는 **얼굴 임베딩(FaceNet 등) + 벡터DB**로 업그레이드하고, `phash` 컬럼을 임베딩으로 교체하면 됩니다.
- 전화번호 원문은 관리자 상세 조회에서만 반환하고 `AdminAuditLog`에 **열람 기록**을 남기는 것을 권장합니다.
- S3 객체는 비공개 버킷 + 조회용 presigned URL을 쓰면 사진 무단 수집을 더 줄일 수 있어요.
