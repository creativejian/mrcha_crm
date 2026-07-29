import { useCallback, useEffect, useState } from "react";

import { getJson, sendVoid } from "./http";

// 딜러 명부(조직 화면의 별도 "딜러" 테이블 — 2026-07-28 유슨생) — **admin 전용 API**.
//
// 구성원 테이블과 나눈 이유: 딜러는 역할·담당 고객·접근 범위·상담 수신이 전부 무의미한데
// (배정 후보에서도 제외된다) 한 표에 섞여 있어 그 칸들이 `—`·"해당 없음"으로 채워졌다.
// 반대로 브랜드·비고는 딜러 행에만 의미가 있어 구성원 쪽에서 빈 칸이었다.
//
// 목록 기준은 **합집합**이다(서버 listDealerRoster): role이 내려간 딜러도 남아야 그 사람의
// 데이터를 정리할 수 있다 — 사라지면 삭제 버튼을 누를 행 자체가 없어진다.
export type DealerRosterEntry = {
  dealerUserId: string;
  name: string | null;
  phone: string | null;
  /** false = 앱에서 role이 내려갔다(퇴사·전환). 행은 남지만 "현재 딜러 아님"으로 표시한다. */
  isDealer: boolean;
  brandId: number | null;
  /** null = 브랜드 미지정, 또는 그 브랜드가 catalog에서 삭제됨(brandId가 있는데 이름이 null). */
  brandName: string | null;
  note: string | null;
  /** 삭제 확인 팝업이 "지울 N건"을 보여주는 데 쓴다. */
  proposalCount: number;
};

// 이 모듈 밖에서 부를 일이 없어 export하지 않는다(소비처는 아래 훅 하나 — knip 기준선 0).
async function fetchRoster(): Promise<DealerRosterEntry[]> {
  return getJson<DealerRosterEntry[]>("/api/dealer/roster");
}

// 입력 트림 1행(명부 "보기 (N)" 팝오버 — 2026-07-29 유슨생). catalog 이름들이 null이면
// 트림이 카탈로그에서 삭제된 것(loose id) — 화면은 "삭제된 트림"으로 표기하고 이동은 막는다.
export type DealerProposalTrim = {
  trimId: number;
  financialAmount: number | null;
  partnerAmount: number | null;
  cashAmount: number | null;
  updatedAt: string;
  trimName: string | null;
  mcCode: string | null;
  /** 행 클릭 이동(/mc-master/:modelId?brand=)용 — null이면 이동 불가(삭제된 트림). */
  modelId: number | null;
  modelName: string | null;
  brandId: number | null;
  brandName: string | null;
};

// 팝오버가 열릴 때마다 on-demand로 받는다(명부 로드에 얹지 않는다 — 딜러 수 × 제안 수 페이로드).
export async function fetchDealerProposalTrims(dealerUserId: string): Promise<DealerProposalTrim[]> {
  return getJson<DealerProposalTrim[]>(`/api/dealer/profiles/${dealerUserId}/proposals`);
}

export function useDealerRoster(): {
  roster: DealerRosterEntry[];
  loading: boolean;
  failed: boolean;
  /** 제안만 삭제(브랜드 매칭은 남는다) → 딜러가 다시 입력할 수 있다. */
  deleteProposals: (dealerUserId: string) => Promise<void>;
  /** 딜러 해제 — 제안 + 브랜드 매칭. ⚠️ 앱의 role은 그대로다(CRM은 profiles를 못 쓴다). */
  releaseDealer: (dealerUserId: string) => Promise<void>;
  /** 브랜드·비고 저장 — 명부가 브랜드명·제안 수를 함께 들고 있어 저장 후 다시 읽는다. */
  saveProfile: (dealerUserId: string, brandId: number, note: string | null) => Promise<void>;
} {
  const [roster, setRoster] = useState<DealerRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // ⚠️ setState는 **콜백 안에서** 부른다 — effect 본문에서 async 함수를 호출하면 그 함수가
  // setState를 하더라도 react-hooks/set-state-in-effect가 잡는다(기준선 0).
  useEffect(() => {
    let alive = true;
    fetchRoster()
      .then((rows) => {
        if (alive) setRoster(rows);
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

  const reload = useCallback(async () => {
    setRoster(await fetchRoster());
  }, []);

  // 삭제 후에는 **목록 전체를 다시 받는다**: 제안 수가 0이 되고, 해제면 행이 사라지거나 브랜드가
  // 비워진다(role이 dealer면 행은 남는다). 응답으로 부분 갱신하면 그 분기를 클라가 또 계산해야 한다.
  // 실패는 그대로 throw — 호출한 화면이 알려야 한다(삼키면 지워진 줄 안다).
  const deleteProposals = useCallback(
    async (dealerUserId: string) => {
      await sendVoid(`/api/dealer/profiles/${dealerUserId}/proposals`, "DELETE");
      await reload();
    },
    [reload],
  );

  const releaseDealer = useCallback(
    async (dealerUserId: string) => {
      await sendVoid(`/api/dealer/profiles/${dealerUserId}`, "DELETE");
      await reload();
    },
    [reload],
  );

  const saveProfile = useCallback(
    async (dealerUserId: string, brandId: number, note: string | null) => {
      await sendVoid(`/api/dealer/profiles/${dealerUserId}`, "PUT", { brandId, note });
      await reload();
    },
    [reload],
  );

  return { roster, loading, failed, deleteProposals, releaseDealer, saveProfile };
}
