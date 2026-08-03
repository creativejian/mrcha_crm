import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { popoverPosFromRect, type PopoverPos } from "@/components/ProposalTrimsPopover";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { approveChangeRequestById, buildChangeDiff, rejectChangeRequestById, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

// 행 "승인 대기" 배지(spec §7.2 확장, 2026-08-03) — 구 hover title(요청자·경과·작업 텍스트)에서
// 클릭 팝오버로 승격: 어떤 값이 바뀌는지(전→후 diff)를 행 자리에서 바로 보고, admin은 그
// 자리에서 승인/반려까지 한다(헤더 대기열 왕복 동선 제거 — 이사님 요청). manager에게는 같은
// 팝오버가 읽기 전용(diff 확인)이다.
// 셸·행 상태 규약은 ChangeRequestQueue를 따른다(.va-cr-* 스타일 · 성공(done) 즉시 숨김 ·
// 반려 인라인 사유 입력 · 닫힐 때 일시 상태 정리). 대상 라벨·점프는 없다 — 이미 그 행 위다.

type RowState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done" }
  | { phase: "error"; message: string }
  | { phase: "rejecting"; reason: string; busy: boolean };

const IDLE_STATE: RowState = { phase: "idle" };

export function PendingRequestBadge({
  label = "승인 대기",
  requests,
  staffNames,
  canApprove,
  onApplied,
}: {
  /** 배지 문구 — 기존 행은 "승인 대기", 미리보기 행(신규 트림)은 "승인 대기(신규)". */
  label?: string;
  /** 이 행에 걸린 pending 요청들(없으면 배지 미표시) — MCMasterPage가 모델 단위로 분류해 내려준다. */
  requests: ChangeRequestItem[] | undefined;
  staffNames: Map<string, string>;
  /** admin(canEdit)만 true — 승인/반려 버튼 노출. 서버도 admin 게이트라 이중 방어다. */
  canApprove: boolean;
  /** 승인 성공 직후(재조회 유발) — MCMasterPage handleQueueApplied(카탈로그 재조회). */
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 반려 사유 타이핑 중 바깥 클릭으로 닫히지 않게(대기열 팝오버와 같은 guard).
  usePopoverDismiss(popRef, open, () => closePopover(), {
    guard: () => Object.values(rowStates).some((s) => s.phase === "rejecting"),
  });

  if (!requests || requests.length === 0) return null;

  function stateOf(id: string): RowState {
    return rowStates[id] ?? IDLE_STATE;
  }
  function setRowState(id: string, s: RowState) {
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  // 닫으며 rejecting/error를 idle로 정리(busy·done 유지) — 잔여 rejecting이 남으면 guard가
  // 다음 열림의 바깥 클릭 닫기를 계속 막는다(ChangeRequestQueue closePopover와 같은 규칙).
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
  }

  // 처리 성공 공통 — 행을 done으로 숨기고, 마지막 행이었으면 팝오버도 닫는다(빈 팝오버 방지).
  // 닫기는 이벤트 콜백 안에서만 한다 — 렌더/이펙트 본문 setState는 lint 기준선 위반.
  function markDoneAndMaybeClose(row: ChangeRequestItem) {
    setRowState(row.id, { phase: "done" }); // 재조회 완료 전 즉시 숨김(대기열 팝오버와 같은 규칙).
    const othersVisible = (requests ?? []).some((r) => r.id !== row.id && stateOf(r.id).phase !== "done");
    if (!othersVisible) closePopover();
  }

  async function handleApprove(row: ChangeRequestItem) {
    setRowState(row.id, { phase: "busy" });
    try {
      await approveChangeRequestById(row.id);
      markDoneAndMaybeClose(row);
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
  async function confirmReject(row: ChangeRequestItem) {
    const cur = rowStates[row.id];
    if (cur?.phase !== "rejecting") return;
    const reason = cur.reason.trim();
    if (!reason) return;
    setRowState(row.id, { phase: "rejecting", reason: cur.reason, busy: true });
    try {
      await rejectChangeRequestById(row.id, reason);
      markDoneAndMaybeClose(row); // 반려는 catalog 무변 — onApplied 없이 숨김만.
    } catch (e) {
      setRowState(row.id, { phase: "error", message: e instanceof Error ? e.message : "반려 실패" });
    }
  }

  // 전 건 처리 완료(done) — 배지·팝오버 미표시(팝오버는 markDoneAndMaybeClose가 이미 닫았고,
  // 서버 재조회가 곧 requests 자체를 걷어낸다).
  const visible = requests.filter((r) => stateOf(r.id).phase !== "done");
  if (visible.length === 0) return null;

  return (
    <>
      <button type="button" className="va-cr-badge va-cr-badge-btn" onClick={toggle} ref={btnRef}>
        {label}
      </button>
      {/* ⚠️ portal 필수(2026-08-03 실기 버그): 이 배지는 트림명 sticky 셀(z-index 2 — 쌓임 맥락)
          안에 살아서, 팝오버를 제자리에 두면 fixed여도 그 맥락에 갇혀 **다른 행의 sticky 셀이
          위를 덮는다**(왼쪽이 잘려 보임). body로 탈출시키면 z-index 70이 전역에서 유효하다.
          헤더의 대기열 팝오버는 sticky 밖이라 portal이 필요 없다(Topbar 알림 portal 선례). */}
      {open &&
        createPortal(
          <div className="va-cr-pop" ref={popRef} style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : undefined}>
            {visible.map((row) => {
              const state = stateOf(row.id);
              const diff = buildChangeDiff(row);
              const busy = state.phase === "busy";
              return (
                <div className="va-cr-row" key={row.id}>
                  <div className="va-cr-row-head">
                    <span className="va-cr-requester">{staffNames.get(row.requestedBy) ?? "알 수 없음"}</span>
                    {" · "}
                    <span>{waitingLabel(row.createdAt, new Date(), "전")}</span>
                    {" · "}
                    <span>{CHANGE_KIND_LABELS[row.kind]}</span>
                  </div>
                  {diff.length > 0 ? (
                    <div className="va-cr-diff">
                      {diff.map((d) => (
                        <div key={d.label}>
                          {d.label}: {d.before ?? "—"} → {d.after}
                        </div>
                      ))}
                    </div>
                  ) : (
                    // 대기열 팝오버와 같은 규칙: update류의 빈 diff = 승인해도 catalog 무변(안내),
                    // 무옵션 토글은 kind 라벨이 전부라 안내 없음.
                    row.kind.endsWith(".update") && <div className="va-cr-diff va-cr-diff-empty">변경 값 없음(현재 값과 동일)</div>
                  )}
                  {state.phase === "error" && <div className="va-cr-error">{state.message}</div>}
                  {canApprove &&
                    (state.phase === "rejecting" ? (
                      <div className="va-cr-reject-input">
                        <input
                          value={state.reason}
                          onChange={(e) => changeReject(row.id, e.target.value)}
                          placeholder="반려 사유"
                          disabled={state.busy}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="badge red"
                          onClick={() => void confirmReject(row)}
                          disabled={state.busy || !state.reason.trim()}
                        >
                          확인
                        </button>
                        <button type="button" className="badge" onClick={() => setRowState(row.id, IDLE_STATE)} disabled={state.busy}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="va-cr-actions">
                        <button type="button" className="badge green" onClick={() => void handleApprove(row)} disabled={busy}>
                          승인
                        </button>
                        <button type="button" className="badge red" onClick={() => startReject(row.id)} disabled={busy}>
                          반려
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
