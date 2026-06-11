import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, MessageSquareText, ShieldCheck, UserPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";

type CheckState = "idle" | "available" | "taken" | "invalid";
type PhoneState = "idle" | "sent" | "verified" | "error";

const carriers = [
  ["SKT", "SKT"],
  ["KT", "KT"],
  ["LGU", "LG U+"],
  ["SKT_MVNO", "SKT 알뜰폰"],
  ["KT_MVNO", "KT 알뜰폰"],
  ["LGU_MVNO", "LG U+ 알뜰폰"],
] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    email: "",
    nickname: "",
    password: "",
    passwordConfirm: "",
    carrier: "",
    phone: "",
    phoneCode: "",
  });
  const [agreements, setAgreements] = useState({
    terms: false,
    privacy: false,
    phoneVerification: false,
    marketing: false,
  });
  const [usernameCheck, setUsernameCheck] = useState<CheckState>("idle");
  const [nicknameCheck, setNicknameCheck] = useState<CheckState>("idle");
  const [phoneState, setPhoneState] = useState<PhoneState>("idle");
  const [phoneMessage, setPhoneMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  const passwordOk = form.password.length >= 8 && form.password === form.passwordConfirm;
  const requiredAgreed = agreements.terms && agreements.privacy && agreements.phoneVerification;
  const allAgreed = requiredAgreed && agreements.marketing;
  const normalizedPhone = useMemo(() => normalizePhone(form.phone), [form.phone]);
  const phoneReady = form.carrier && isValidPhone(normalizedPhone) && agreements.privacy && agreements.phoneVerification;
  const canSubmit =
    requiredAgreed &&
    passwordOk &&
    usernameCheck === "available" &&
    nicknameCheck === "available" &&
    phoneState === "verified";

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "username") setUsernameCheck("idle");
    if (field === "nickname") setNicknameCheck("idle");
    if (field === "phone" || field === "carrier") {
      setPhoneState("idle");
      setPhoneMessage("");
    }
  }

  function setAgreement(field: keyof typeof agreements, value: boolean) {
    setAgreements((current) => ({ ...current, [field]: value }));
  }

  function setAllAgreements(value: boolean) {
    setAgreements({ terms: value, privacy: value, phoneVerification: value, marketing: value });
  }

  async function checkUsername() {
    const username = form.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{4,20}$/.test(username)) {
      setUsernameCheck("invalid");
      return;
    }
    const { data } = await api.get<{ available: boolean }>("/api/auth/check-username", { params: { username } });
    setUsernameCheck(data.available ? "available" : "taken");
  }

  async function checkNickname() {
    const nickname = form.nickname.trim();
    if (nickname.length < 2 || nickname.length > 20) {
      setNicknameCheck("invalid");
      return;
    }
    const { data } = await api.get<{ available: boolean }>("/api/auth/check-nickname", { params: { nickname } });
    setNicknameCheck(data.available ? "available" : "taken");
  }

  async function sendPhoneCode() {
    setError("");
    setPhoneMessage("");
    if (!phoneReady) {
      setPhoneState("error");
      setPhoneMessage("통신사, 휴대폰 번호, 개인정보/인증 동의를 확인해 주세요.");
      return;
    }
    setSendingCode(true);
    try {
      await api.post("/api/auth/phone/send-code", {
        phone: normalizedPhone,
        carrier: form.carrier,
        privacyAgreed: agreements.privacy,
        phoneVerificationAgreed: agreements.phoneVerification,
      });
      setForm((current) => ({ ...current, phone: normalizedPhone }));
      setPhoneState("sent");
      setPhoneMessage("인증번호를 문자로 보냈습니다. 5분 안에 입력해 주세요.");
    } catch (error: any) {
      setPhoneState("error");
      setPhoneMessage(error?.response?.data?.message ?? "인증번호 발송에 실패했습니다.");
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyPhoneCode() {
    setError("");
    if (!/^\d{6}$/.test(form.phoneCode)) {
      setPhoneState("error");
      setPhoneMessage("인증번호 6자리를 입력해 주세요.");
      return;
    }
    setVerifyingCode(true);
    try {
      await api.post("/api/auth/phone/verify-code", {
        phone: normalizedPhone,
        code: form.phoneCode,
      });
      setPhoneState("verified");
      setPhoneMessage("휴대폰 인증이 완료되었습니다.");
    } catch (error: any) {
      setPhoneState("error");
      setPhoneMessage(error?.response?.data?.message ?? "인증번호 확인에 실패했습니다.");
    } finally {
      setVerifyingCode(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!canSubmit) {
      setError("중복 확인, 휴대폰 인증, 비밀번호 확인, 필수 약관 동의를 모두 완료해 주세요.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/register", {
        username: form.username.trim().toLowerCase(),
        email: form.email.trim().toLowerCase(),
        nickname: form.nickname.trim(),
        password: form.password,
        phone: normalizedPhone,
        carrier: form.carrier,
        phoneCode: form.phoneCode,
      });
      navigate("/login");
    } catch (error: any) {
      setError(error?.response?.data?.message ?? "회원가입에 실패했습니다. 입력값을 다시 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="panel-soft mx-auto max-w-3xl overflow-hidden rounded" onSubmit={submit}>
      <div className="border-b border-gray-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-black text-brand">세명 인사이드</p>
        <h1 className="mt-2 text-3xl font-black">회원가입</h1>
        <p className="mt-2 text-sm text-gray-500">아이디 중복 확인과 휴대폰 인증을 완료하면 가입할 수 있습니다.</p>
      </div>

      <div className="space-y-5 p-5">
        <section className="space-y-3">
          <h2 className="font-black">기본 정보</h2>
          <input className="h-12 w-full rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("email", e.target.value)} placeholder="이메일" value={form.email} />
          <div className="flex gap-2">
            <input className="h-12 flex-1 rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("username", e.target.value)} placeholder="아이디 4~20자, 영문/숫자/_" value={form.username} />
            <button className="rounded bg-gray-900 px-4 font-black text-white" onClick={checkUsername} type="button">중복확인</button>
          </div>
          <CheckMessage state={usernameCheck} available="사용 가능한 아이디입니다." taken="이미 사용중인 아이디입니다." invalid="아이디는 영문 소문자, 숫자, _ 조합 4~20자입니다." />
          <div className="flex gap-2">
            <input className="h-12 flex-1 rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("nickname", e.target.value)} placeholder="닉네임 2~20자" value={form.nickname} />
            <button className="rounded bg-gray-900 px-4 font-black text-white" onClick={checkNickname} type="button">중복확인</button>
          </div>
          <CheckMessage state={nicknameCheck} available="사용 가능한 닉네임입니다." taken="이미 사용중인 닉네임입니다." invalid="닉네임은 2~20자로 입력해 주세요." />
          <input className="h-12 w-full rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("password", e.target.value)} placeholder="비밀번호 8자 이상" type="password" value={form.password} />
          <input className="h-12 w-full rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("passwordConfirm", e.target.value)} placeholder="비밀번호 확인" type="password" value={form.passwordConfirm} />
          <p className={passwordOk ? "text-sm font-bold text-emerald-700" : "text-sm font-bold text-red-600"}>
            {passwordOk ? "비밀번호가 일치합니다." : "비밀번호는 8자 이상이며 두 입력값이 같아야 합니다."}
          </p>
        </section>

        <section className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-brand" size={20} />
            <h2 className="font-black">휴대폰 인증</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <select className="h-12 rounded border px-3 dark:border-neutral-700 dark:bg-neutral-900" onChange={(e) => setField("carrier", e.target.value)} value={form.carrier}>
              <option value="">통신사 선택</option>
              {carriers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input
              className="h-12 rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900"
              inputMode="numeric"
              onBlur={() => setField("phone", normalizedPhone)}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="01012345678"
              value={form.phone}
            />
            <button className="inline-flex h-12 items-center justify-center gap-2 rounded bg-gray-900 px-4 font-black text-white disabled:bg-gray-300" disabled={sendingCode} onClick={sendPhoneCode} type="button">
              <MessageSquareText size={17} />
              {sendingCode ? "발송중" : "인증번호 받기"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="h-12 flex-1 rounded border px-3 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900"
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setField("phoneCode", e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="인증번호 6자리"
              value={form.phoneCode}
            />
            <button className="rounded bg-brand px-4 font-black text-white disabled:bg-gray-300" disabled={verifyingCode || phoneState === "verified"} onClick={verifyPhoneCode} type="button">
              {phoneState === "verified" ? "인증완료" : verifyingCode ? "확인중" : "인증확인"}
            </button>
          </div>
          {phoneMessage ? <p className={`text-sm font-bold ${phoneState === "verified" || phoneState === "sent" ? "text-emerald-700" : "text-red-600"}`}>{phoneMessage}</p> : null}
        </section>

        <section className="space-y-2 rounded border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="block font-black">
            <input checked={allAgreed} className="mr-2" onChange={(e) => setAllAgreements(e.target.checked)} type="checkbox" />
            모두 동의하기
          </label>
          <Agreement checked={agreements.terms} label="이용약관 동의 필수" onChange={(value) => setAgreement("terms", value)} to="/terms" />
          <Agreement checked={agreements.privacy} label="개인정보 수집 및 이용 동의 필수" onChange={(value) => setAgreement("privacy", value)} to="/privacy" />
          <Agreement checked={agreements.phoneVerification} label="휴대폰 인증 문자 발송 동의 필수" onChange={(value) => setAgreement("phoneVerification", value)} />
          <Agreement checked={agreements.marketing} label="이벤트/마케팅 정보 수신 동의 선택" onChange={(value) => setAgreement("marketing", value)} />
        </section>

        <div className="grid gap-2 text-xs text-gray-500 sm:grid-cols-4">
          <JoinStep done={usernameCheck === "available"} label="아이디 확인" />
          <JoinStep done={nicknameCheck === "available"} label="닉네임 확인" />
          <JoinStep done={phoneState === "verified"} label="휴대폰 인증" />
          <JoinStep done={passwordOk && requiredAgreed} label="비밀번호/약관" />
        </div>

        {error ? <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-brand font-black text-white disabled:bg-gray-300" disabled={!canSubmit || loading} type="submit">
          <UserPlus size={18} />
          {loading ? "가입 처리 중..." : "가입하기"}
        </button>
      </div>
    </form>
  );
}

function Agreement({ checked, label, onChange, to }: { checked: boolean; label: string; onChange: (value: boolean) => void; to?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-2 text-sm dark:bg-neutral-950">
      <span>
        <input checked={checked} className="mr-2" onChange={(e) => onChange(e.target.checked)} type="checkbox" />
        {label}
      </span>
      {to ? <Link className="shrink-0 font-bold text-brand" to={to}>보기</Link> : null}
    </label>
  );
}

function JoinStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded border px-3 py-2 font-bold ${done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"}`}>
      <CheckCircle2 size={15} />
      {label}
    </div>
  );
}

function CheckMessage({ state, available, taken, invalid }: { state: CheckState; available: string; taken: string; invalid: string }) {
  if (state === "idle") return null;
  const text = state === "available" ? available : state === "taken" ? taken : invalid;
  const className = state === "available" ? "text-emerald-700" : "text-red-600";
  return <p className={`text-sm font-bold ${className}`}>{text}</p>;
}

function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("8210") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("10") && digits.length === 10) return `0${digits}`;
  return digits;
}

function isValidPhone(phone: string) {
  return /^010\d{8}$/.test(phone);
}
