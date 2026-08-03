import { useState } from "react";

// 변경 요청 팝오버 3벌(관리자 승인 대기열 · 팀장 내 요청 · 행 승인 대기 배지)이 공유하는
// **행별 UI 상태 머신**(2026-08-03 통합). 서버 rows 자체는 손대지 않고(재조회 시 서버가 SSOT)
// 진행 중·직후만 로컬로 표시한다는 규약이 셋 다 같았고, 세 벌이 각자 같은 코드를 들고 있었다.
//   - 성공(done)은 재조회 완료 전까지 행을 즉시 숨겨 잔상을 없앤다.
//   - 닫을 때 rejecting·error는 idle로 정리한다(resetTransient) — 잔여 rejecting이 남으면
//     usePopoverDismiss guard가 다음 열림의 바깥 클릭 닫기를 계속 막는다.
// 반려 사유 입력(rejecting)은 승인/반려를 하는 두 곳만 쓴다 — 쓰지 않는 팝오버(내 요청)에서는
// 그 축이 생기지 않으므로 resetTransient가 error만 정리하던 구 동작과 결과가 같다.

// 소비처는 rows.stateOf(...)로만 만나므로 이름을 밖에 내보내지 않는다(knip 기준선 0).
type ChangeRequestRowState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done" }
  | { phase: "error"; message: string }
  | { phase: "rejecting"; reason: string; busy: boolean };

const IDLE_STATE: ChangeRequestRowState = { phase: "idle" };

export type ChangeRequestRows = {
  stateOf: (id: string) => ChangeRequestRowState;
  /** 이 행이 done(로컬 숨김 대상)인가 — 목록 필터용. */
  isDone: (id: string) => boolean;
  /** 액션 실패 메시지(없으면 null) — 카드의 error 슬롯. */
  errorOf: (id: string) => string | null;
  /** 반려 사유를 입력 중인 행이 하나라도 있는가 — usePopoverDismiss guard(타이핑 중 닫힘 방지). */
  hasRejecting: () => boolean;
  startReject: (id: string) => void;
  changeReject: (id: string, reason: string) => void;
  cancelReject: (id: string) => void;
  /** 반려 확인 — 입력 UI를 유지한 채 진행 중 표시만 켠다(입력칸이 사라지면 무슨 사유였는지 사라진다). */
  setRejectBusy: (id: string) => void;
  /** 닫을 때의 일시 상태 정리(busy·done은 유지). */
  resetTransient: () => void;
  /**
   * 행 액션 1회 — 진행 중 표시 → 성공하면 done(true 반환) / 실패하면 error(false).
   * markBusy=false는 호출부가 이미 표시를 켠 경우(반려 확인)다.
   */
  run: (
    id: string,
    action: () => Promise<unknown>,
    failMessage: string,
    opts?: { markBusy?: boolean },
  ) => Promise<boolean>;
};

export function useChangeRequestRows(): ChangeRequestRows {
  const [states, setStates] = useState<Record<string, ChangeRequestRowState>>({});

  const stateOf = (id: string) => states[id] ?? IDLE_STATE;
  const set = (id: string, s: ChangeRequestRowState) => setStates((prev) => ({ ...prev, [id]: s }));

  return {
    stateOf,
    isDone: (id) => stateOf(id).phase === "done",
    errorOf: (id) => {
      const s = stateOf(id);
      return s.phase === "error" ? s.message : null;
    },
    hasRejecting: () => Object.values(states).some((s) => s.phase === "rejecting"),
    startReject: (id) => set(id, { phase: "rejecting", reason: "", busy: false }),
    changeReject: (id, reason) =>
      setStates((prev) => {
        const cur = prev[id];
        if (cur?.phase !== "rejecting") return prev;
        return { ...prev, [id]: { ...cur, reason } };
      }),
    cancelReject: (id) => set(id, IDLE_STATE),
    setRejectBusy: (id) =>
      setStates((prev) => {
        const cur = prev[id];
        if (cur?.phase !== "rejecting") return prev;
        return { ...prev, [id]: { ...cur, busy: true } };
      }),
    resetTransient: () =>
      setStates((prev) => {
        let changed = false;
        const next: Record<string, ChangeRequestRowState> = {};
        for (const [id, s] of Object.entries(prev)) {
          if (s.phase === "rejecting" || s.phase === "error") {
            changed = true;
            next[id] = IDLE_STATE;
          } else {
            next[id] = s;
          }
        }
        return changed ? next : prev;
      }),
    run: async (id, action, failMessage, opts) => {
      if (opts?.markBusy !== false) set(id, { phase: "busy" });
      try {
        await action();
        set(id, { phase: "done" });
        return true;
      } catch (e) {
        set(id, { phase: "error", message: e instanceof Error ? e.message : failMessage });
        return false;
      }
    },
  };
}
