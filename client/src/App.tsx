import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { RequireAdmin } from "./components/RequireAdmin";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminOverview } from "./pages/admin/AdminOverview";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminPosts } from "./pages/admin/AdminPosts";
import { AdminReports } from "./pages/admin/AdminReports";
import { AdminBoards } from "./pages/admin/AdminBoards";
import { AdminBannedWords } from "./pages/admin/AdminBannedWords";

function AdminUsersWrapper() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return <AdminUsers currentUserId={user.id} currentUserRole={user.role} />;
}

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
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsersWrapper />} />
          <Route path="posts" element={<AdminPosts />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="boards" element={<AdminBoards />} />
          <Route path="banned-words" element={<AdminBannedWords />} />
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  );
}
