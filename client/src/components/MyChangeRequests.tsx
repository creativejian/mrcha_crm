import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { popoverPosFromRect, type PopoverPos } from "@/components/ProposalTrimsPopover";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import {
  buildChangeDiff,
  filterMyRequestVisible,
  changeRequestDest,
  useMyChangeRequests,
  type ChangeRequestItem,
} from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

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

  usePopoverDismiss(popRef, open, () => closePopover());

  function stateOf(id: string): RowState {
    return rowStates[id] ?? IDLE_STATE;
  }
  function setRowState(id: string, s: RowState) {
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  // 닫으며 error를 idle로 정리한다 — 취소 실패 행이 pending에서 벗어나면(승인 경합 404 등)
  // 재시도 버튼조차 없어 에러가 지워질 길이 없다(대기열 closePopover와 같은 규칙, rejecting 축만 없음).
  function closePopover() {
    setOpen(false);
    setRowStates((prev) => {
      let changed = false;
      const next: Record<string, RowState> = {};
      for (const [id, s] of Object.entries(prev)) {
        if (s.phase === "error") {
          changed = true;
          next[id] = IDLE_STATE;
        } else {
          next[id] = s;
        }
      }
      return changed ? next : prev;
    });
  }

  function toggle() {
    if (open) {
      closePopover();
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

  // 착지 점프 — 경로 계약은 changeRequestDest(대기열과 공용 SSOT)가 안다.
  function jumpTo(row: ChangeRequestItem) {
    const dest = changeRequestDest(row);
    if (dest == null) return;
    navigate(dest);
    closePopover();
  }

  // 행동 대상(pending)이 이력 사이에 묻히지 않게 위로 올린다 — mine=1은 상태 무관 최근 50건
  // (서버)이라 승인·반려가 쌓이면 pending이 아래로 밀린다. 같은 상태 안에서는 서버 순서
  // (createdAt desc)를 그대로 둔다(안정 정렬). .sort는 in-place라 rows 원본이 아닌
  // .filter 결과(새 배열)에만 건다.
  // 자동 소멸 필터(filterMyRequestVisible — canceled 숨김 포함) 위에 컴포넌트 로컬 done 숨김만 얹는다.
  const visibleRows =
    rows == null
      ? null
      : filterMyRequestVisible(rows, new Date())
          .filter((r) => stateOf(r.id).phase !== "done")
          .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
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
                  // 대기열 팝오버와 같은 칩 액션(.badge — 무채색 = 파괴 아님·자기 요청 철회).
                  <div className="va-cr-actions">
                    <button
                      type="button"
                      className="badge"
                      onClick={() => void handleCancel(row)}
                      disabled={state.phase === "busy"}
                    >
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
