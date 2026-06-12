import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

type Step = "phone" | "code" | "password";

export function RecoveryPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("phone");
  const [mode, setMode] = useState<"find" | "reset">("reset");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePhoneSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "find") {
        const { data } = await api.post("/api/recovery/find-account", { phone });
        setMessage(data.message);
        setStep("phone");
      } else {
        await api.post("/api/recovery/reset/send-code", { phone });
        setMessage("가입된 번호라면 인증번호가 발송됩니다.");
        setStep("code");
      }
    } catch {
      setError("처리 중 오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/recovery/reset/verify-code", { phone, code });
      setResetToken(data.resetToken);
      setStep("password");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "인증번호가 올바르지 않거나 만료됐어요.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("비밀번호가 일치하지 않아요.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/recovery/reset/confirm", { resetToken, newPassword });
      navigate("/login", { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "오류가 발생했어요. 처음부터 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel-soft mx-auto w-full max-w-md overflow-hidden rounded bg-white">
      <div className="border-b border-gray-200 bg-white p-5">
        <p className="text-sm font-black text-brand">세명 인사이드</p>
        <h1 className="mt-2 text-3xl font-black">계정 찾기</h1>
        <p className="mt-2 text-sm text-gray-500">휴대폰 번호로 계정을 확인하거나 비밀번호를 재설정할 수 있어요.</p>
      </div>

      <div className="space-y-4 bg-white p-5">
        {step === "phone" && (
          <>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded border py-2 text-sm font-bold ${mode === "find" ? "border-brand bg-brand text-white" : "border-gray-300 text-gray-700"}`}
                onClick={() => { setMode("find"); setMessage(""); setError(""); }}
                type="button"
              >
                계정 찾기
              </button>
              <button
                className={`flex-1 rounded border py-2 text-sm font-bold ${mode === "reset" ? "border-brand bg-brand text-white" : "border-gray-300 text-gray-700"}`}
                onClick={() => { setMode("reset"); setMessage(""); setError(""); }}
                type="button"
              >
                비밀번호 재설정
              </button>
            </div>
            <form onSubmit={handlePhoneSubmit} className="space-y-3">
              <input
                className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
                onChange={(e) => setPhone(e.target.value)}
                placeholder="휴대폰 번호 (숫자만)"
                type="tel"
                value={phone}
              />
              {message && <p className="rounded bg-green-50 p-3 text-sm text-green-700">{message}</p>}
              {error && <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
              <button
                className="inline-flex h-12 w-full items-center justify-center rounded bg-brand font-black text-white disabled:bg-gray-300"
                disabled={loading || !phone}
                type="submit"
              >
                {loading ? "처리 중..." : mode === "find" ? "문자로 안내받기" : "인증번호 받기"}
              </button>
            </form>
          </>
        )}

        {step === "code" && (
          <form onSubmit={handleCodeSubmit} className="space-y-3">
            <p className="text-sm text-gray-600">{message}</p>
            <input
              className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              placeholder="인증번호 6자리"
              type="text"
              value={code}
            />
            {error && <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded bg-brand font-black text-white disabled:bg-gray-300"
              disabled={loading || code.length !== 6}
              type="submit"
            >
              {loading ? "확인 중..." : "인증번호 확인"}
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <input
              autoComplete="new-password"
              className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)"
              type="password"
              value={newPassword}
            />
            <input
              autoComplete="new-password"
              className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="새 비밀번호 확인"
              type="password"
              value={confirmPassword}
            />
            {error && <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded bg-brand font-black text-white disabled:bg-gray-300"
              disabled={loading || !newPassword || !confirmPassword}
              type="submit"
            >
              {loading ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          <button className="font-bold text-brand" onClick={() => navigate("/login")} type="button">
            로그인으로 돌아가기
          </button>
        </p>
      </div>
    </div>
  );
}
