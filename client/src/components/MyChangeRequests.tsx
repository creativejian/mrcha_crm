import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { ChangeRequestNotes, ChangeRequestRowCard } from "@/components/ChangeRequestRowCard";
import { useChangeRequestRows } from "@/lib/change-request-rows";
import {
  changeRequestDest,
  filterMyRequestVisible,
  useMyChangeRequests,
  type ChangeRequestItem,
} from "@/lib/catalog-change-requests";
import { popoverPosFromRect, popoverStyle, type PopoverPos } from "@/lib/popover-pos";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

// 팀장 "내 요청" 팝오버(PR3 Task 7, spec §7.3) — 반려 사유 확인 → 수정 → 재요청 셀프서비스.
// 대기열 팝오버(ChangeRequestQueue)와 같은 셸·같은 행 카드(ChangeRequestRowCard)를 쓰되 액션이
// 다르다: 승인/반려 대신 pending 행 [취소]. 요청자가 전부 본인이라 이름 자리에는 상태 배지가
// 들어가고, canceled는 소음이라 걸러낸다(서버 mine=1은 전 상태 최근 50건). 버튼 (N)은 pending만
// 센다 — 지금 걸려 있는 것만이 행동 대상이다. 반려 사유 줄은 카드가 status로 알아서 낸다.

const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export function MyChangeRequestsButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const rowUi = useChangeRequestRows();
  const { rows, failed, reload, cancel } = useMyChangeRequests(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // anchorRef = 버튼 재클릭 이중 발화 방지(닫기는 toggle 몫 — 2026-08-03).
  usePopoverDismiss(popRef, open, () => closePopover(), { anchorRef: btnRef });

  // 닫으며 error를 idle로 정리한다 — 취소 실패 행이 pending에서 벗어나면(승인 경합 404 등)
  // 재시도 버튼조차 없어 에러가 지워질 길이 없다(대기열과 같은 규칙, 반려 입력 축만 없다).
  function closePopover() {
    setOpen(false);
    rowUi.resetTransient();
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
          .filter((r) => !rowUi.isDone(r.id))
          .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  const pendingCount = visibleRows == null ? null : visibleRows.filter((r) => r.status === "pending").length;

  return (
    <>
      <button className="btn" onClick={toggle} ref={btnRef} type="button">
        내 요청{pendingCount != null ? ` (${pendingCount})` : ""}
      </button>
      {open && (
        <div className="va-cr-pop" ref={popRef} style={popoverStyle(pos)}>
          <ChangeRequestNotes rows={visibleRows} failed={failed} onReload={reload} emptyText="요청 내역이 없습니다." />
          {visibleRows?.map((row) => (
            <ChangeRequestRowCard
              key={row.id}
              row={row}
              lead={
                <span className={`va-cr-status va-cr-status-${row.status}`}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              }
              onJump={jumpTo}
              error={rowUi.errorOf(row.id)}
            >
              {row.status === "pending" && (
                // 대기열 팝오버와 같은 칩 액션(.badge — 무채색 = 파괴 아님·자기 요청 철회).
                <div className="va-cr-actions">
                  <button
                    type="button"
                    className="badge"
                    onClick={() => void rowUi.run(row.id, () => cancel(row.id), "취소 실패")}
                    disabled={rowUi.stateOf(row.id).phase === "busy"}
                  >
                    취소
                  </button>
                </div>
              )}
            </ChangeRequestRowCard>
          ))}
        </div>
      )}
    </>
  );
}
