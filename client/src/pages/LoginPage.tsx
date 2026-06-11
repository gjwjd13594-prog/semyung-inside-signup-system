import { FormEvent, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", { login, password });
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      setUser(data.user);
      navigate("/");
    } catch {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="panel-soft mx-auto w-full max-w-md overflow-hidden rounded bg-white" onSubmit={submit}>
      <div className="border-b border-gray-200 bg-white p-5">
        <p className="text-sm font-black text-brand">세명 인사이드</p>
        <h1 className="mt-2 text-3xl font-black">로그인</h1>
        <p className="mt-2 text-sm text-gray-500">회원 전용 게시판, 댓글, 북마크 기능을 사용할 수 있습니다.</p>
      </div>
      <div className="space-y-4 bg-white p-5">
        <input
          autoComplete="username"
          className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
          onChange={(event) => setLogin(event.target.value)}
          placeholder="아이디 또는 이메일"
          value={login}
        />
        <input
          autoComplete="current-password"
          className="h-12 w-full rounded border border-gray-300 bg-white px-3 text-gray-950 outline-none focus:border-brand"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="비밀번호"
          type="password"
          value={password}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" /> 자동로그인
        </label>
        {error ? <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-brand font-black text-white disabled:bg-gray-300" disabled={loading} type="submit">
          {loading ? <LockKeyhole size={18} /> : <LogIn size={18} />}
          {loading ? "로그인 중..." : "로그인"}
        </button>
        <p className="text-center text-sm">
          <Link className="font-black text-brand" to="/register">회원가입</Link> · <Link className="font-black text-brand" to="/forgot-password">비밀번호 찾기</Link>
        </p>
      </div>
    </form>
  );
}
