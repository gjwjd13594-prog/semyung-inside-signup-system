import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminPage } from "./pages/AdminPage";
import { RequireAdmin } from "./components/RequireAdmin";

export function App() {
  const loadMe = useAuthStore((s) => s.loadMe);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <div className="max-w-6xl mx-auto px-4 py-6">
                <AdminPage />
              </div>
            </RequireAdmin>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  );
}
