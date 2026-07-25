import { useEffect, useState } from "react";

import { getJson } from "./http";

// 조직 구성원 디렉토리(GET /api/staff/org — 대표 전용). `/org-members` 화면 「구성원」 탭 소스.
// ⚠️ 배정 후보 디렉토리(lib/staff.ts)와 **다른 목록**이다: 이쪽은 dealer를 포함한 CRM 역할 전부.
// 캐시하지 않는다 — 이름·역할은 세션 중 불변이라 staff.ts가 캐시하지만, 여기 담당 고객 수는
// 배정이 바뀔 때마다 변한다. 조직 화면은 자주 여는 곳이 아니라 진입 시 1회 fetch가 싸다.
export type OrgMemberEntry = {
  id: string;
  name: string;
  role: string;
  phone: string | null; // raw(미포맷) — 표시는 formatPhone(phone-format.ts). null = 미입력 계정
  assignedCustomers: number;
  liveReceiving: boolean;
};

// 이 모듈 밖에서 부를 일이 없어 export하지 않는다(소비처는 아래 훅 하나 — knip 기준선 0).
async function fetchOrgMembers(): Promise<OrgMemberEntry[]> {
  return getJson<OrgMemberEntry[]>("/api/staff/org");
}

// 컴포넌트용: 마운트 시 로드. 실패는 빈 목록 + failed 플래그 — 조직 화면은 이 목록이 본문이라
// 배정 select(빈 목록을 disabled로 흡수)와 달리 **실패를 화면에 알려야 한다**(admin 외 역할은 403).
export function useOrgMembers(): { members: OrgMemberEntry[]; loading: boolean; failed: boolean } {
  const [members, setMembers] = useState<OrgMemberEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchOrgMembers()
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { members, loading, failed };
}
