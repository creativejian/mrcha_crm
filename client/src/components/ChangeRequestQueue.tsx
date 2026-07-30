import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { popoverPosFromRect, type PopoverPos } from "@/components/ProposalTrimsPopover";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { buildChangeDiff, useChangeRequestQueue, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { staffNameOf, useStaffDirectory } from "@/lib/staff";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";
import { mcMasterPath } from "@/pages/mc-master/mc-master-route";

// 관리자 승인 대기열 팝오버(PR2 Task 4, 2026-07-30) — MC 마스터 변경 승인 워크플로의 관리자
// 소비 UI. 데이터는 useChangeRequestQueue(catalog-change-requests.ts, PR2 Task 1~3)가 이미
// 갖추고 있다 — 여기는 표시·행 액션(승인/반려)·착지 점프만 담당한다.
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §7.4
// 마운트만으로 항상 로드(useChangeRequestQueue(true)) — 배지가 열지 않아도 신선도를 말해야
// 한다(딜러 명부 "보기 (N)"과 달리 여기는 캐시가 없어 매 마운트 1회 요청한다).

// 행별 UI 상태 — 서버 rows 자체는 손대지 않고(재조회 시 서버가 SSOT), 승인/반려 진행 중·직후는
// 로컬로만 표시한다. 성공(done)은 재조회 완료 전까지 행을 즉시 숨겨 잔상을 없앤다(Task 3 리뷰 지적).
type RowState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done" }
  | { phase: "error"; message: string }
  | { phase: "rejecting"; reason: string; busy: boolean };

const IDLE_STATE: RowState = { phase: "idle" };

export function ChangeRequestQueueButton({ onApplied }: { onApplied: () => void }) {
  useStaffDirectory(); // 이름 캐시 예열 — staffNameOf는 동기 조회라 렌더 전에 로드를 걸어둔다.
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const { rows, failed, reload, approve, reject } = useChangeRequestQueue(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 반려 사유를 입력하는 동안은 바깥 클릭으로 닫히지 않게 — 타이핑 중 오조작 방지.
  // (Esc는 guard 대상이 아니라 그대로 닫힌다 — usePopoverDismiss 원 동작. closePopover가 그 잔여
  // rejecting 상태를 정리한다.)
  usePopoverDismiss(popRef, open, () => closePopover(), {
    guard: () => Object.values(rowStates).some((s) => s.phase === "rejecting"),
  });

  function stateOf(id: string): RowState {
    return rowStates[id] ?? IDLE_STATE;
  }
  function setRowState(id: string, s: RowState) {
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  // 팝오버를 닫으며 rejecting/error 같은 일시 상태를 idle로 되돌린다(busy·done은 유지) — Esc로
  // 닫혔던 반려 입력이 다음 열림에도 남아 있으면 usePopoverDismiss guard가 바깥 클릭 닫기를
  // 계속 막는다(리뷰 지적). dismiss·점프 등 setOpen(false)로 닫는 모든 경로가 이걸 통해야 한다.
  function closePopover() {
    setOpen(false);
    setRowStates((prev) => {
      let changed = false;
      const next: Record<string, RowState> = {};
      for (const [id, s] of Object.entries(prev)) {
        if (s.phase === "rejecting" || s.phase === "error") {
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
    reload(); // 신선도 — 배지가 뜬 뒤 다른 관리자가 먼저 처리했을 수 있다.
  }

  async function handleApprove(row: ChangeRequestItem) {
    setRowState(row.id, { phase: "busy" });
    try {
      await approve(row.id);
      setRowState(row.id, { phase: "done" }); // 즉시 숨김 — 재조회 완료를 기다리지 않는다.
      onApplied();
    } catch (e) {
      setRowState(row.id, { phase: "error", message: e instanceof Error ? e.message : "승인 실패" });
    }
  }

  function startReject(id: string) {
    setRowState(id, { phase: "rejecting", reason: "", busy: false });
  }
  function changeReject(id: string, reason: string) {
    setRowStates((prev) => {
      const cur = prev[id];
      if (cur?.phase !== "rejecting") return prev;
      return { ...prev, [id]: { ...cur, reason } };
    });
  }
  function cancelReject(id: string) {
    setRowState(id, IDLE_STATE);
  }
  async function confirmReject(row: ChangeRequestItem) {
    const cur = rowStates[row.id];
    if (cur?.phase !== "rejecting") return;
    const reason = cur.reason.trim();
    if (!reason) return;
    setRowState(row.id, { phase: "rejecting", reason: cur.reason, busy: true });
    try {
      await reject(row.id, reason);
      setRowState(row.id, { phase: "done" }); // 즉시 숨김 — 승인과 같은 규칙.
      // 반려는 catalog 무변 — onApplied(재조회)는 승인 성공에만 건다.
    } catch (e) {
      setRowState(row.id, { phase: "error", message: e instanceof Error ? e.message : "반려 실패" });
    }
  }

  // targetBrandId만 있으면 점프 가능 — targetModelId까지 있으면 기존대로 모델(+하이라이트 트림)
  // 뷰로, 없으면(model.create — 대상 모델이 아직 없다) 브랜드의 모델 목록으로 이동한다.
  function jumpTo(row: ChangeRequestItem) {
    if (row.targetBrandId == null) return;
    const dest =
      row.targetModelId != null
        ? `${mcMasterPath(row.targetBrandId, row.targetModelId)}${
            row.targetTrimId != null ? `&hl=${row.targetTrimId}` : ""
          }`
        : mcMasterPath(row.targetBrandId, undefined);
    navigate(dest);
    closePopover();
  }

  // 성공(done) 행은 서버 rows가 아직 갱신되지 않았어도 로컬에서 먼저 걷어낸다.
  const visibleRows = rows?.filter((r) => stateOf(r.id).phase !== "done") ?? null;

  return (
    <>
      <button className="btn" onClick={toggle} ref={btnRef} type="button">
        {/* done 숨김을 반영한 visibleRows 기준 — rows.length를 쓰면 마지막 행 승인 직후 재조회
            전까지 "(1)" 잔상이 남는다(리뷰 지적). */}
        승인 대기{visibleRows != null ? ` (${visibleRows.length})` : ""}
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
            <div className="va-cr-note">대기 중인 요청이 없습니다.</div>
          )}
          {visibleRows?.map((row) => {
            const state = stateOf(row.id);
            const diff = buildChangeDiff(row);
            const canJump = row.targetBrandId != null;
            const busy = state.phase === "busy";
            return (
              <div className="va-cr-row" key={row.id}>
                <div className="va-cr-row-head">
                  <span>{staffNameOf(row.requestedBy) ?? "알 수 없음"}</span>
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
                {diff.length > 0 ? (
                  <div className="va-cr-diff">
                    {diff.map((d) => (
                      <div key={d.label}>
                        {d.label}: {d.before ?? "—"} → {d.after}
                      </div>
                    ))}
                  </div>
                ) : (
                  // update kind인데 diff가 빈 배열 = 필터 후 바뀐 필드가 없다(승인해도 catalog 무변) —
                  // 무옵션 토글(diff 없음이 기본)은 제외하고 update류만 이 안내를 보여 승인자 판단 재료로 쓴다.
                  row.kind.endsWith(".update") && <div className="va-cr-diff va-cr-diff-empty">변경 값 없음(현재 값과 동일)</div>
                )}
                {state.phase === "error" && <div className="va-cr-error">{state.message}</div>}
                {state.phase === "rejecting" ? (
                  <div className="va-cr-reject-input">
                    <input
                      value={state.reason}
                      onChange={(e) => changeReject(row.id, e.target.value)}
                      placeholder="반려 사유"
                      disabled={state.busy}
                    />
                    <button
                      type="button"
                      onClick={() => void confirmReject(row)}
                      disabled={state.busy || !state.reason.trim()}
                    >
                      확인
                    </button>
                    <button type="button" onClick={() => cancelReject(row.id)} disabled={state.busy}>
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="va-cr-actions">
                    <button type="button" onClick={() => void handleApprove(row)} disabled={busy}>
                      승인
                    </button>
                    <button type="button" onClick={() => startReject(row.id)} disabled={busy}>
                      반려
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
