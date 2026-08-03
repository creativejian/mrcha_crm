import type { ReactNode } from "react";

import type { ChangeRequestRows } from "@/lib/change-request-rows";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { buildChangeDiff, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";

// 변경 요청 팝오버 3벌이 공유하는 **행 카드**(2026-08-03 통합) — 머리줄(· 로 이은 메타) ·
// 대상 라벨 · diff · 반려 사유 · 에러 · 액션의 골격과 .va-cr-* 클래스가 셋 다 같았다.
// 벌마다 다른 것은 슬롯으로만 남긴다: 머리줄 첫 조각(lead — 요청자 이름 / 상태 배지),
// 점프 가능 여부(onJump 없으면 대상 줄 자체를 그리지 않는다 — 행 배지는 이미 그 행 위다),
// 액션(children).
//
// 경과 표기는 렌더 시점 `new Date()`다 — memo하면 재조회 전까지 "3분 전"이 못 박힌다.

export function ChangeRequestRowCard({
  row,
  lead,
  onJump,
  showEmptyDiffNote = false,
  error,
  children,
}: {
  row: ChangeRequestItem;
  /** 머리줄 첫 조각 — 요청자 이름(대기열·배지) 또는 상태 배지(내 요청). */
  lead: ReactNode;
  /** 있으면 대상 라벨 줄을 그린다(점프 불가 = 텍스트). 없으면 줄 자체가 없다. */
  onJump?: (row: ChangeRequestItem) => void;
  /** update류인데 diff가 비면 "현재 값과 동일" 안내 — 승인자 판단 재료라 승인 화면만 켠다. */
  showEmptyDiffNote?: boolean;
  /** 행 액션 실패 메시지(액션 바로 위) — 다음 열림 때 정리는 rows.resetTransient 몫. */
  error?: string | null;
  /** 액션 영역(승인/반려 · 취소). */
  children?: ReactNode;
}) {
  const diff = buildChangeDiff(row);
  const canJump = onJump != null && row.targetBrandId != null;
  return (
    <div className="va-cr-row">
      <div className="va-cr-row-head">
        {lead}
        {" · "}
        <span>{waitingLabel(row.createdAt, new Date(), "전")}</span>
        {" · "}
        <span>{CHANGE_KIND_LABELS[row.kind]}</span>
      </div>
      {onJump != null &&
        (canJump ? (
          <button type="button" className="va-cr-target" onClick={() => onJump(row)}>
            {row.targetLabel}
          </button>
        ) : (
          // 대상이 카탈로그에서 사라졌거나(loose id) 아직 없는 요청(model.create) — 갈 곳이 없다.
          <span className="va-cr-target-text">{row.targetLabel}</span>
        ))}
      {diff.length > 0 ? (
        <div className="va-cr-diff">
          {diff.map((d) => (
            <div key={d.label}>
              {d.label}: {d.before ?? "—"} → {d.after}
            </div>
          ))}
        </div>
      ) : (
        // 무옵션 토글은 diff 없음이 기본이라 제외하고 update류만 안내한다.
        showEmptyDiffNote &&
        row.kind.endsWith(".update") && <div className="va-cr-diff va-cr-diff-empty">변경 값 없음(현재 값과 동일)</div>
      )}
      {row.status === "rejected" && row.rejectReason && (
        <div className="va-cr-reason">반려 사유: {row.rejectReason}</div>
      )}
      {error != null && <div className="va-cr-error">{error}</div>}
      {children}
    </div>
  );
}

// 목록 자리의 로딩·실패·빈 상태(헤더 버튼 팝오버 2벌 공용) — 빈 문구만 다르다.
export function ChangeRequestNotes({
  rows,
  failed,
  onReload,
  emptyText,
}: {
  /** null = 아직 로딩(첫 응답 전). */
  rows: unknown[] | null;
  failed: boolean;
  onReload: () => void;
  emptyText: string;
}) {
  return (
    <>
      {rows === null && !failed && <div className="va-cr-note">불러오는 중…</div>}
      {failed && (
        <div className="va-cr-note">
          불러오기 실패{" "}
          <button type="button" className="tiny-btn" onClick={onReload}>
            다시 시도
          </button>
        </div>
      )}
      {rows != null && !failed && rows.length === 0 && <div className="va-cr-note">{emptyText}</div>}
    </>
  );
}

// 승인/반려 액션(관리자 대기열 · 행 배지 공용) — 반려는 사유가 필수라 같은 자리에서 인라인
// 입력으로 바뀐다. 액션은 고객 목록 칩(.badge — customer-list.css 1벌 룰)을 그대로 입는다
// (2026-07-31 유슨생: 무클래스 버튼이 평문처럼 읽혀 행 액션으로 안 보였다).
export function ApproveRejectActions({
  rows,
  row,
  onApprove,
  onReject,
}: {
  rows: ChangeRequestRows;
  row: ChangeRequestItem;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const state = rows.stateOf(row.id);
  if (state.phase === "rejecting") {
    const reason = state.reason.trim();
    return (
      <div className="va-cr-reject-input">
        <input
          value={state.reason}
          onChange={(e) => rows.changeReject(row.id, e.target.value)}
          placeholder="반려 사유"
          disabled={state.busy}
          // 반려를 누른 의도 = 사유 입력 — 바로 타이핑하게 포커스(포커스 링이 곧 "여기 입력"
          // 신호다. 2026-07-31 실기: 클릭 전엔 입력칸인지 안 읽혔다).
          autoFocus
        />
        <button
          type="button"
          className="badge red"
          onClick={() => onReject(reason)}
          disabled={state.busy || !reason}
        >
          확인
        </button>
        <button
          type="button"
          className="badge"
          onClick={() => rows.cancelReject(row.id)}
          disabled={state.busy}
        >
          취소
        </button>
      </div>
    );
  }
  const busy = state.phase === "busy";
  return (
    <div className="va-cr-actions">
      <button type="button" className="badge green" onClick={onApprove} disabled={busy}>
        승인
      </button>
      <button type="button" className="badge red" onClick={() => rows.startReject(row.id)} disabled={busy}>
        반려
      </button>
    </div>
  );
}
