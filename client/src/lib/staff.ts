import { useEffect, useState } from "react";

import { getJson } from "./http";

// 직원 디렉토리(GET /api/staff — profiles CRM 역할). 담당자 배정 select의 후보 목록으로,
// 배정 저장이 advisorId(uuid)를 동봉해야 역할 scope(staff=본인 담당)가 성립한다(#176).
// 세션 내 캐시: 직원 목록은 세션 중 사실상 불변이라 TTL 없이 1회 fetch + inflight dedupe.
export type StaffEntry = { id: string; name: string; role: string };

let cache: StaffEntry[] | null = null;
let inflight: Promise<StaffEntry[]> | null = null;

export async function fetchStaffDirectory(): Promise<StaffEntry[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = getJson<StaffEntry[]>("/api/staff")
    .then((rows) => {
      cache = rows;
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// 배정 저장 시 select 값(advisorId) → 표시명 동기 해석. 편집기가 디렉토리 로드 후에만
// 옵션을 렌더하므로 제출 시점엔 캐시가 항상 따뜻하다 — 미로드(null)면 호출부가 저장을 막는다.
export function staffNameOf(id: string): string | null {
  return cache?.find((s) => s.id === id)?.name ?? null;
}

// 테스트 전용 — 모듈 캐시 초기화(케이스 간 오염 방지).
export function resetStaffDirectoryCache(): void {
  cache = null;
  inflight = null;
}

// 컴포넌트용: 마운트 시 디렉토리 로드. 실패는 빈 목록(호출부가 disabled 처리) — 배정은
// 재시도 가능한 보조 동작이라 에러 UI를 띄우지 않는다.
export function useStaffDirectory(): { staff: StaffEntry[]; loading: boolean } {
  const [staff, setStaff] = useState<StaffEntry[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  useEffect(() => {
    let alive = true;
    fetchStaffDirectory()
      .then((rows) => {
        if (alive) setStaff(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { staff, loading };
}
