import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (user) { setChecked(true); return; }
    api.get("/api/auth/me")
      .then((r) => setUser(r.data.user))
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="p-10 text-center text-gray-400">확인 중...</div>;
  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER")) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
