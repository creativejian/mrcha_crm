import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { popoverPosFromRect, type PopoverPos } from "@/components/ProposalTrimsPopover";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { buildChangeDiff, useMyChangeRequests, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";
import { mcMasterPath } from "@/pages/mc-master/mc-master-route";

// 팀장 "내 요청" 팝오버(PR3 Task 7, spec §7.3) — 반려 사유 확인 → 수정 → 재요청 셀프서비스.
// 대기열 팝오버(ChangeRequestQueue)와 같은 셸(.va-cr-*)이되 액션이 다르다: 승인/반려 대신
// pending 행 [취소] + rejected 행 사유 표시. 요청자가 전부 본인이라 이름 열이 없고, canceled는
// 소음이라 걸러낸다(서버 mine=1은 전 상태 최근 50건). 버튼 (N)은 pending만 센다 — 지금 걸려
// 있는 것만이 행동 대상이다.

// 행별 UI 상태 — 서버 rows는 손대지 않고(재조회 시 서버가 SSOT) 취소 진행 중·직후만 로컬 표시.
// 성공(done)은 재조회 완료 전까지 행을 즉시 숨겨 잔상을 없앤다(대기열 팝오버와 같은 규칙).
type RowState = { phase: "idle" } | { phase: "busy" } | { phase: "done" } | { phase: "error"; message: string };

const IDLE_STATE: RowState = { phase: "idle" };

const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export function MyChangeRequestsButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const { rows, failed, reload, cancel } = useMyChangeRequests(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss(popRef, open, () => setOpen(false));

  function stateOf(id: string): RowState {
    return rowStates[id] ?? IDLE_STATE;
  }
  function setRowState(id: string, s: RowState) {
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setPos(popoverPosFromRect(btnRef.current?.getBoundingClientRect()));
    setOpen(true);
    reload(); // 신선도 — 열려 있지 않은 사이 관리자가 처리했을 수 있다.
  }

  async function handleCancel(row: ChangeRequestItem) {
    setRowState(row.id, { phase: "busy" });
    try {
      await cancel(row.id);
      setRowState(row.id, { phase: "done" }); // 재조회 완료 전 즉시 숨김(대기열 팝오버와 같은 규칙).
    } catch (e) {
      setRowState(row.id, { phase: "error", message: e instanceof Error ? e.message : "취소 실패" });
    }
  }

  // 착지 점프 — ChangeRequestQueue.jumpTo와 같은 좌표 규칙(brand 쿼리 필수·트림은 hl 플래시).
  function jumpTo(row: ChangeRequestItem) {
    if (row.targetBrandId == null) return;
    const dest =
      row.targetModelId != null
        ? `${mcMasterPath(row.targetBrandId, row.targetModelId)}${
            row.targetTrimId != null ? `&hl=${row.targetTrimId}` : ""
          }`
        : mcMasterPath(row.targetBrandId, undefined);
    navigate(dest);
    setOpen(false);
  }

  const visibleRows = rows?.filter((r) => r.status !== "canceled" && stateOf(r.id).phase !== "done") ?? null;
  const pendingCount = visibleRows == null ? null : visibleRows.filter((r) => r.status === "pending").length;

  return (
    <>
      <button className="btn" onClick={toggle} ref={btnRef} type="button">
        내 요청{pendingCount != null ? ` (${pendingCount})` : ""}
      </button>
      {open && (
        <div
          className="va-cr-pop"
          ref={popRef}
          style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : undefined}
        >
          {visibleRows === null && !failed && <div className="va-cr-note">불러오는 중…</div>}
          {failed && (
            <div className="va-cr-note">
              불러오기 실패{" "}
              <button type="button" className="tiny-btn" onClick={reload}>
                다시 시도
              </button>
            </div>
          )}
          {visibleRows != null && !failed && visibleRows.length === 0 && (
            <div className="va-cr-note">요청 내역이 없습니다.</div>
          )}
          {visibleRows?.map((row) => {
            const state = stateOf(row.id);
            const diff = buildChangeDiff(row);
            const canJump = row.targetBrandId != null;
            return (
              <div className="va-cr-row" key={row.id}>
                <div className="va-cr-row-head">
                  <span className={`va-cr-status va-cr-status-${row.status}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                  {" · "}
                  <span>{waitingLabel(row.createdAt, new Date(), "전")}</span>
                  {" · "}
                  <span>{CHANGE_KIND_LABELS[row.kind]}</span>
                </div>
                {canJump ? (
                  <button type="button" className="va-cr-target" onClick={() => jumpTo(row)}>
                    {row.targetLabel}
                  </button>
                ) : (
                  <span className="va-cr-target-text">{row.targetLabel}</span>
                )}
                {diff.length > 0 && (
                  <div className="va-cr-diff">
                    {diff.map((d) => (
                      <div key={d.label}>
                        {d.label}: {d.before ?? "—"} → {d.after}
                      </div>
                    ))}
                  </div>
                )}
                {row.status === "rejected" && row.rejectReason && (
                  <div className="va-cr-reason">반려 사유: {row.rejectReason}</div>
                )}
                {state.phase === "error" && <div className="va-cr-error">{state.message}</div>}
                {row.status === "pending" && (
                  <div className="va-cr-actions">
                    <button type="button" onClick={() => void handleCancel(row)} disabled={state.phase === "busy"}>
                      취소
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
