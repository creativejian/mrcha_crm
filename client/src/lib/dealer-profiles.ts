import { useEffect, useState } from "react";

import { getJson } from "./http";

// 딜러 **본인** 프로필 — Topbar 조직 라벨과 MC 마스터 브랜드 스코프가 함께 쓴다.
// dealer가 아닌 role은 서버가 자기 것만 조회하므로 자연히 null이 온다(게이트 불필요).
// enabled=false면 요청조차 보내지 않는다 — 딜러가 아닌 계정에서 낭비를 만들지 않는다.
export type DealerMe = {
  dealerUserId: string;
  brandId: number;
  brandName: string | null;
  note: string | null;
} | null;

export function useDealerMe(enabled: boolean): { me: DealerMe; loaded: boolean } {
  const [me, setMe] = useState<DealerMe>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // 실패도 loaded로 넘긴다 — 화면이 무한 로딩에 걸리지 않게 하고, 브랜드 미지정과 같은 취급
    // (안내 문구)을 받는다. 딜러가 아무것도 못 하는 상태는 관리자 브랜드 지정으로만 풀린다.
    getJson<DealerMe>("/api/dealer/me")
      .then((row) => {
        if (alive) {
          setMe(row);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { me, loaded };
}
