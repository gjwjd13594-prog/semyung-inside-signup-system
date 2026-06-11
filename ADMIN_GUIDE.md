# 관리자 화면과 관리자 계정 시스템

이 문서는 세명 인사이드 관리자 시스템을 다른 앱에 이식할 때 필요한 구조를 정리한 문서입니다.

## 포함된 관리자 기능

- 관리자 페이지: `client/src/pages/AdminPage.tsx`
- 관리자 API: `server/src/routes/admin.ts`
- 관리자 계정 생성 seed: `server/src/seed.ts`
- 관리자 권한 인증: `server/src/middleware/auth.ts`
- 서버 점검/로그 기능:
  - `server/src/utils/serverLogs.ts`
  - `server/src/middleware/requestLogger.ts`
  - `server/src/middleware/firewall.ts`
  - `server/src/utils/errors.ts`
- DB 모델: `prisma/schema.prisma`

## 관리자 페이지에서 제공하는 기능

- 서버 전체 점검
  - API 서버
  - Database
  - Redis
  - 이미지 저장소
  - SMTP
  - SOLAPI
  - JWT 시크릿
  - 보안 설정
- 서버 로그 조회
  - 최근 API 요청
  - 오류
  - 방화벽 차단
  - 관리자 작업 기록
- 회원 관리
  - 회원 검색
  - 권한 변경
  - 정지/정지 해제
  - 휴대폰 번호/이메일 마스킹
- 개인정보 열람 로그
  - 관리자만 원문 확인 가능
  - 열람 사유 기록
- 게시글 관리
  - 공지 고정
  - 삭제
- 신고 관리
  - 처리 완료
  - 기각
- 게시판 관리
  - 게시판 생성
  - 게시판 목록 조회
- 금지어 관리
  - 금지어 추가/삭제

## 관리자 계정 생성 방법

공개 저장소에는 실제 관리자 비밀번호를 넣지 않습니다.

`server/.env`에 아래 값을 설정한 뒤 seed를 실행합니다.

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
ADMIN_EMAIL=admin@example.local
ADMIN_NICKNAME=관리자
```

실행:

```bash
npm run seed --prefix server
```

또는 server 폴더에서:

```bash
npm run seed
```

`ADMIN_PASSWORD`가 비어 있으면 seed는 실패합니다. 이 동작은 공개 저장소에 실수로 기본 관리자 비밀번호가 퍼지는 것을 막기 위한 안전장치입니다.
실제 비밀번호는 GitHub에 올리지 말고 로컬 `.env` 또는 배포 서비스 환경변수에서만 입력하세요.

## 서버에 관리자 API 연결하기

Express 서버에서 아래처럼 연결합니다.

```ts
import { adminRouter } from "./routes/admin.js";
import { adminLimiter, apiLimiter, globalLimiter } from "./middleware/rateLimiters.js";
import { optionalAuth } from "./middleware/auth.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { firewall } from "./middleware/firewall.js";

app.use(globalLimiter);
app.use(firewall);
app.use(optionalAuth);
app.use(requestLogger);

app.use("/api", apiLimiter);
app.use("/api/admin", adminLimiter, adminRouter);
```

`adminRouter` 내부에서 `requireAuth`와 `requireRole([ADMIN, MANAGER])`를 적용하므로, 로그인하지 않은 사용자는 관리자 API를 실행할 수 없습니다.

## 프론트 라우터에 관리자 페이지 연결하기

React Router 예시:

```tsx
import { AdminPage } from "./pages/AdminPage";

<Route element={<AdminPage />} path="/admin" />
```

관리자 페이지는 현재 로그인한 사용자의 role이 `ADMIN` 또는 `MANAGER`일 때만 내부 기능을 보여줍니다.

## 권한 정책

- `USER`: 일반 회원
- `MANAGER`: 게시판/신고/게시글 관리 가능
- `ADMIN`: 전체 기능 가능
  - 회원 권한 변경
  - 개인정보 원문 열람
  - 서버 로그 조회

## 개인정보 보호 방식

관리자 회원 목록에서는 이메일과 휴대폰 번호를 기본적으로 마스킹합니다.

ADMIN이 원문 확인을 누르면 사유 입력을 받고, `AdminPrivacyAccessLog` 테이블에 기록합니다.

## 필요한 DB 모델

관리자 기능은 아래 모델을 사용합니다.

- `User`
- `AdminPrivacyAccessLog`
- `Board`
- `Category`
- `Post`
- `Comment`
- `Report`
- `BannedWord`

전체 모델은 `prisma/schema.prisma`에 들어 있습니다.

## 주의사항

- 실제 운영 관리자 비밀번호는 절대 GitHub에 올리지 마세요.
- `ADMIN_PASSWORD`는 배포 환경변수에서만 관리하세요.
- 서버 로그에는 토큰, 쿠키, 비밀번호, API 키 같은 민감값이 저장되지 않도록 `serverLogs.ts`에서 redaction 처리합니다.
- 개인정보 원문 열람은 ADMIN 전용으로 제한하는 것을 권장합니다.
