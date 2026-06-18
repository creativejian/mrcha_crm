import { type ReactNode, createContext, useContext, useEffect, useState } from "react";

import type { RoleTab } from "@/data/roles";
import { roleTabFromClaim } from "@/data/roles";
import { getRoleClaim } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type AuthState = {
  loading: boolean;
  authed: boolean; // 세션 존재 여부
  roleTab: RoleTab | null; // null = 세션은 있으나 권한 없음(customer 등)
};

const AuthContext = createContext<AuthState>({ loading: true, authed: false, roleTab: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, authed: false, roleTab: null });

  useEffect(() => {
    let alive = true;
    async function resolve(authed: boolean) {
      const roleTab = authed ? roleTabFromClaim(await getRoleClaim()) : null;
      if (alive) setState({ loading: false, authed, roleTab });
    }
    supabase.auth.getSession().then(({ data }) => resolve(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(!!session);
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
