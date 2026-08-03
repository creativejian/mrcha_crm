import { useMemo } from "react";

import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { useModelPendingRequests, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { useStaffDirectory } from "@/lib/staff";
import { pendingTrimCellPatch, splitModelPending, type ModelPendingSplit, type PendingCellPatch } from "./pending-preview";

// 화면이 쓰는 pending 재료 한 벌(2026-08-03 분리) — 모델 단위 pending을 받아 세 갈래로 갈라
// (트림 행 배지 · 신규 트림 미리보기 · 헤더 pill) 표시 재료까지 만든다. 분류 자체는 순수
// splitModelPending(pending-preview.ts — 유닛 테스트) 몫이고, 여기는 요청자 이름·경과처럼
// 렌더 시각·디렉터리에 의존하는 합성만 얹는다.
// 시도 전에 보여 409(대상+작업당 pending 1건)를 예방하는 게 목적이라 canWrite 축이다(spec §7.2).

/** 헤더 pill 줄 — "요청자 · 3분 전 · 모델 수정". */
function pendingHeaderLines(rows: ChangeRequestItem[], staffNames: Map<string, string>, now: Date): string[] {
  return rows.map(
    (r) => `${staffNames.get(r.requestedBy) ?? "알 수 없음"} · ${waitingLabel(r.createdAt, now, "전")} · ${CHANGE_KIND_LABELS[r.kind]}`,
  );
}

export function useModelPendingView(
  modelId: string | undefined,
  canWrite: boolean,
): {
  /** 모델 전체 pending(타인 포함) — 폼 프리필의 "내 요청" 판별에도 쓰인다. */
  rows: ChangeRequestItem[];
  staffNames: Map<string, string>;
  split: ModelPendingSplit;
  headerLines: string[];
  /** 수정 pending이 있는 행의 셀 인라인 diff("→ 새값", 2026-08-03 이사님 요청). */
  patchByTrim: Map<number, PendingCellPatch>;
} {
  const { staff } = useStaffDirectory(canWrite);
  const rows = useModelPendingRequests(modelId ? Number(modelId) : null, canWrite);
  const staffNames = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  // ⚠️ 아래 셋은 일부러 useMemo로 감싸지 않는다 — 헤더 pill 경과 표기가 deps에 없는 `new Date()`
  // 에서 나오므로 memo하면 재조회 전까지 "3분 전"이 못 박힌다(ChangeRequestQueue도 렌더 시점
  // 인라인 `new Date()`를 쓴다 — 같은 축). pending은 모델당 한 자릿수라 렌더당 재계산은 무시 가능.
  const split = splitModelPending(rows);
  const headerLines = pendingHeaderLines(split.headerRequests, staffNames, new Date());
  const patchByTrim = new Map(
    [...split.byTrim].flatMap(([trimId, requests]) => {
      const patch = pendingTrimCellPatch(requests);
      return patch ? [[trimId, patch] as const] : [];
    }),
  );

  return { rows, staffNames, split, headerLines, patchByTrim };
}
