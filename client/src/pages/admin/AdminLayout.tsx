import { NavLink, Outlet } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

const tabs = [
  { to: "/admin", label: "대시보드", end: true },
  { to: "/admin/users", label: "회원 관리" },
  { to: "/admin/posts", label: "게시글 관리" },
  { to: "/admin/reports", label: "신고 관리" },
  { to: "/admin/boards", label: "게시판 관리" },
  { to: "/admin/banned-words", label: "금지어 관리" },
];

export function AdminLayout() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="panel-soft rounded p-5 bg-white">
        <p className="flex items-center gap-2 text-sm font-black text-brand">
          <ShieldCheck size={18} /> 운영자 콘솔
        </p>
        <h1 className="mt-1 text-3xl font-black">관리자 대시보드</h1>
        <p className="mt-1 text-sm text-gray-500">회원, 게시글, 신고, 게시판, 금지어를 관리합니다.</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `px-4 py-2.5 text-sm font-medium whitespace-nowrap -mb-px border-b-2 ${
                isActive
                  ? "border-brand text-brand"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
