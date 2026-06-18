import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider";
import { LoginPage } from "@/pages/LoginPage";

// loading: 스플래시 / 미인증: 로그인 / 인증+권한없음: 거부 / 인증+권한: children
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, authed, roleTab } = useAuth();
  if (loading) return <div className="login-page">불러오는 중…</div>;
  if (!authed) return <LoginPage />;
  if (!roleTab) return <LoginPage deniedReason />;
  return <>{children}</>;
}
