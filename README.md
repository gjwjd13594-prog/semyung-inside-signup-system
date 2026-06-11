# 세명 인사이드 회원가입 시스템

Claude 같은 앱 개발 도구가 세명 인사이드의 회원가입 시스템을 다른 프로젝트에 이식할 수 있도록 정리한 공개용 패키지입니다.

비밀키나 실제 `.env` 값은 포함하지 않았고, `server/.env.example`만 포함했습니다.

## Claude에게 이렇게 요청하세요

아래 GitHub 저장소의 세명 인사이드 회원가입 시스템을 기준으로 내 앱에 같은 회원가입 시스템을 구현해줘. 아이디/닉네임 중복확인, 비밀번호 확인, 통신사 선택, 휴대폰 인증번호 문자 발송/확인, 필수 약관 동의, bcrypt 저장, httpOnly 쿠키 로그인 구조를 유지해줘. SMS API 키는 클라이언트에 노출하지 말고 서버 환경변수에서만 사용해줘.

## 핵심 기능

- 아이디 중복 확인: `GET /api/auth/check-username`
- 닉네임 중복 확인: `GET /api/auth/check-nickname`
- 비밀번호 확인: 8자 이상, 비밀번호/확인 일치
- 통신사 선택: SKT, KT, LG U+, 알뜰폰
- 휴대폰 번호 정리: `01012345678` 형식
- 휴대폰 인증번호 문자 발송: `POST /api/auth/phone/send-code`
- 인증번호 확인: `POST /api/auth/phone/verify-code`
- 회원가입: `POST /api/auth/register`
- 비밀번호 bcrypt 해싱 저장
- 인증번호 bcrypt 해싱 저장
- 인증번호 5분 만료, 오입력 5회 제한
- 로그인 쿠키: httpOnly accessToken / refreshToken
- SMS API 키는 서버 환경변수에서만 사용

## 주요 파일

- `client/src/pages/RegisterPage.tsx`: 회원가입 UI와 프론트 검증 흐름
- `client/src/pages/LoginPage.tsx`: 로그인 UI
- `client/src/api/client.ts`: axios API 클라이언트
- `client/src/store/auth.ts`: 로그인 사용자 상태
- `server/src/routes/auth.ts`: 회원가입, 로그인, 휴대폰 인증 API
- `server/src/utils/phone.ts`: 휴대폰 번호 정규화/검증
- `server/src/utils/sms.ts`: SOLAPI 문자 발송
- `server/src/utils/mailer.ts`: 이메일 발송
- `server/src/middleware/auth.ts`: JWT/cookie 인증
- `server/src/middleware/rateLimiters.ts`: 로그인/문자 인증 rate limit
- `server/src/config.ts`: 환경변수 구성
- `server/src/prisma.ts`: Prisma client
- `prisma/schema.prisma`: User, PhoneVerification DB 모델
- `server/.env.example`: 필요한 환경변수 예시

## 필요한 환경변수

```env
DATABASE_URL=
REDIS_URL=
RATE_LIMIT_REDIS=true
JWT_SECRET=
JWT_REFRESH_SECRET=
CLIENT_URL=
SERVER_URL=
CORS_ORIGINS=
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER_PHONE=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

## DB 핵심 모델

`User`에는 `username`, `email`, `password`, `nickname`, `phone`, `carrier`, `phoneVerified`가 필요합니다.

`PhoneVerification`에는 `phone`, `carrier`, `codeHash`, `attempts`, `expiresAt`, `verifiedAt`, `consumedAt`가 필요합니다.

## 보안 주의사항

- 비밀번호 원문 저장 금지
- 인증번호 원문 저장 금지
- SOLAPI 키 클라이언트 노출 금지
- 인증번호 발송과 로그인에는 rate limit 필수
- 운영환경에서는 HTTPS와 secure cookie 사용
- 관리자 화면에서 전화번호는 기본 마스킹 권장

## 이식 시 수정할 부분

- Prisma import 경로
- API baseURL
- 라우터 등록 경로
- SMS 발신번호와 SOLAPI 환경변수
- 사이트명/약관 문구
