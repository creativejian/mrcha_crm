import { useCallback, useEffect, useState } from "react";

import { getJson, sendJson } from "./http";

// 딜러 브랜드 매칭(대표 전용) — `/org-members` 「구성원」 탭이 구성원 목록과 dealerUserId로 merge한다.
// ⚠️ 저장 대상은 **crm.dealer_profiles**다. public.profiles는 앱과 합의한 read 전용 계약이라
// 브랜드·비고를 거기 쓸 수 없다(CRM 서버는 postgres 롤이라 DB가 막아주지도 않는다).
// 캐시하지 않는다: 이 화면에서 바로 편집하는 값이라 진입 시 1회 fetch가 정확하고 싸다
// (구성원 디렉토리 lib/org-members.ts가 담당 고객 수를 캐시하지 않는 것과 같은 이유).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §7.3
export type DealerProfileEntry = {
  dealerUserId: string;
  brandId: number;
  brandName: string | null; // null = 그 브랜드가 catalog에서 삭제됨(FK 미도입 — spec §3.1)
  note: string | null;
};

// 이 모듈 밖에서 부를 일이 없어 export하지 않는다(소비처는 아래 훅 하나 — knip 기준선 0).
// 실패는 빈 목록으로 흡수한다: 이 값은 조직 화면의 본문이 아니라 dealer 행의 부가 컬럼이고,
// 목록 자체의 실패는 useOrgMembers가 이미 화면에 알린다(중복 경고를 띄우지 않는다).
async function fetchDealerProfiles(): Promise<DealerProfileEntry[]> {
  return getJson<DealerProfileEntry[]>("/api/dealer/profiles").catch(() => []);
}

export function useDealerProfiles(): {
  profiles: DealerProfileEntry[];
  save: (dealerUserId: string, brandId: number, note: string | null) => Promise<void>;
} {
  const [profiles, setProfiles] = useState<DealerProfileEntry[]>([]);

  // ⚠️ setState는 **콜백 안에서** 부른다 — effect 본문에서 async 함수를 호출하면 그 함수가
  // setState를 하더라도 react-hooks/set-state-in-effect가 잡는다(lint 기준선 0).
  // alive 가드는 언마운트 후 setState 방지 — org-members.ts와 같은 형태.
  useEffect(() => {
    let alive = true;
    fetchDealerProfiles().then((rows) => {
      if (alive) setProfiles(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 저장 후 최신 목록으로 갱신(이벤트 핸들러 경로라 위 룰과 무관).
  const save = useCallback(async (dealerUserId: string, brandId: number, note: string | null) => {
    await sendJson(`/api/dealer/profiles/${dealerUserId}`, "PUT", { brandId, note });
    setProfiles(await fetchDealerProfiles());
  }, []);

  return { profiles, save };
}
