import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import type { RoleTab } from "@/data/roles";
import { roleTabFromClaim } from "@/data/roles";
import { getRoleClaim } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type AuthState = {
  loading: boolean;
  authed: boolean; // 세션 존재 여부
  roleTab: RoleTab | null; // null = 세션은 있으나 권한 없음(customer 등)
  roleClaim: string | null; // raw user_role claim(admin/manager/staff/dealer) — 권한 헬퍼(canWriteQuote) 입력용
  userId: string | null; // session.user.id — advisor_id 매칭(견적 쓰기 권한 등)
  name: string | null; // user_metadata.full_name(없으면 email)
  avatarUrl: string | null; // user_metadata.avatar_url(https로 정규화)
};

const EMPTY: AuthState = { loading: true, authed: false, roleTab: null, roleClaim: null, userId: null, name: null, avatarUrl: null };

const AuthContext = createContext<AuthState>(EMPTY);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(EMPTY);

  useEffect(() => {
    let alive = true;
    async function resolve(session: Session | null) {
      const authed = !!session;
      // claim 조회(getClaims) 실패는 권한 없음으로 폴백한다. throw하면 loading이 영영 풀리지
      // 않아 무한 로딩이 되므로, 일시적 실패는 null로 두고 다음 onAuthStateChange에서 복구한다.
      let roleTab: RoleTab | null = null;
      let roleClaim: string | null = null;
      if (authed) {
        try {
          roleClaim = await getRoleClaim();
          roleTab = roleTabFromClaim(roleClaim);
        } catch {
          roleTab = null;
          roleClaim = null;
        }
      }
      const meta = session?.user.user_metadata as Record<string, unknown> | undefined;
      const fullName = typeof meta?.full_name === "string" ? meta.full_name : null;
      const name = fullName ?? session?.user.email ?? null;
      const rawAvatar = typeof meta?.avatar_url === "string" ? meta.avatar_url : null;
      // 카카오 CDN은 http로 내려오기도 해 HTTPS 페이지에서 mixed-content가 되므로 https로 올린다.
      const avatarUrl = rawAvatar ? rawAvatar.replace(/^http:\/\//, "https://") : null;
      if (alive) setState({ loading: false, authed, roleTab, roleClaim, userId: session?.user.id ?? null, name, avatarUrl });
    }
    // getSession 자체가 reject해도 loading을 풀어 무한 로딩을 막는다(비인증으로 처리).
    supabase.auth
      .getSession()
      .then(({ data }) => resolve(data.session))
      .catch(() => {
        if (alive) setState({ ...EMPTY, loading: false });
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- AuthProvider와 useAuth는 같은 인증 모듈로 함께 둔다
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
