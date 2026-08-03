import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  ApproveRejectActions,
  ChangeRequestNotes,
  ChangeRequestRowCard,
} from "@/components/ChangeRequestRowCard";
import { useChangeRequestRows } from "@/lib/change-request-rows";
import { changeRequestDest, useChangeRequestQueue, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { popoverPosFromRect, popoverStyle, type PopoverPos } from "@/lib/popover-pos";
import { staffNameOf, useStaffDirectory } from "@/lib/staff";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

// 관리자 승인 대기열 팝오버(PR2 Task 4, 2026-07-30) — MC 마스터 변경 승인 워크플로의 관리자
// 소비 UI. 데이터는 useChangeRequestQueue(catalog-change-requests.ts, PR2 Task 1~3)가 이미
// 갖추고 있고, 행 상태 머신·카드 마크업은 공용 부품(change-request-rows · ChangeRequestRowCard)
// 몫이다 — 여기는 이 팝오버만의 것(열림·신선도 재조회·점프)만 남긴다.
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §7.4
// 마운트만으로 항상 로드(useChangeRequestQueue(true)) — 배지가 열지 않아도 신선도를 말해야
// 한다(딜러 명부 "보기 (N)"과 달리 여기는 캐시가 없어 매 마운트 1회 요청한다).

export function ChangeRequestQueueButton({ onApplied }: { onApplied: () => void }) {
  useStaffDirectory(); // 이름 캐시 예열 — staffNameOf는 동기 조회라 렌더 전에 로드를 걸어둔다.
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const rowUi = useChangeRequestRows();
  const { rows, failed, reload, approve, reject } = useChangeRequestQueue(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 반려 사유를 입력하는 동안은 바깥 클릭으로 닫히지 않게 — 타이핑 중 오조작 방지.
  // (Esc는 guard 대상이 아니라 그대로 닫힌다 — usePopoverDismiss 원 동작. closePopover가 그 잔여
  // rejecting 상태를 정리한다.)
  usePopoverDismiss(popRef, open, () => closePopover(), {
    guard: () => rowUi.hasRejecting(),
    anchorRef: btnRef, // 버튼 재클릭 이중 발화 방지(닫기는 toggle 몫 — 2026-08-03)
  });

  // 닫으며 rejecting/error를 되돌린다 — Esc로 닫혔던 반려 입력이 다음 열림에도 남아 있으면
  // guard가 바깥 클릭 닫기를 계속 막는다. setOpen(false)로 닫는 모든 경로가 이걸 통해야 한다.
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
    reload(); // 신선도 — 배지가 뜬 뒤 다른 관리자가 먼저 처리했을 수 있다.
  }

  async function handleApprove(row: ChangeRequestItem) {
    if (await rowUi.run(row.id, () => approve(row.id), "승인 실패")) onApplied();
  }
  async function handleReject(row: ChangeRequestItem, reason: string) {
    rowUi.setRejectBusy(row.id);
    // 반려는 catalog 무변 — onApplied(재조회)는 승인 성공에만 건다.
    await rowUi.run(row.id, () => reject(row.id, reason), "반려 실패", { markBusy: false });
  }

  // targetBrandId만 있으면 점프 가능 — targetModelId까지 있으면 기존대로 모델(+하이라이트 트림)
  // 뷰로, 없으면(model.create — 대상 모델이 아직 없다) 브랜드의 모델 목록으로 이동한다.
  // 그 인코딩 규칙 자체는 changeRequestDest(내 요청 팝오버와 공용 SSOT)가 소유한다.
  function jumpTo(row: ChangeRequestItem) {
    const dest = changeRequestDest(row);
    if (dest == null) return;
    navigate(dest);
    closePopover();
  }

  // 성공(done) 행은 서버 rows가 아직 갱신되지 않았어도 로컬에서 먼저 걷어낸다.
  const visibleRows = rows?.filter((r) => !rowUi.isDone(r.id)) ?? null;

  return (
    <>
      <button className="btn" onClick={toggle} ref={btnRef} type="button">
        {/* done 숨김을 반영한 visibleRows 기준 — rows.length를 쓰면 마지막 행 승인 직후 재조회
            전까지 "(1)" 잔상이 남는다(리뷰 지적). */}
        승인 대기{visibleRows != null ? ` (${visibleRows.length})` : ""}
      </button>
      {open && (
        <div className="va-cr-pop" ref={popRef} style={popoverStyle(pos)}>
          <ChangeRequestNotes
            rows={visibleRows}
            failed={failed}
            onReload={reload}
            emptyText="대기 중인 요청이 없습니다."
          />
          {visibleRows?.map((row) => (
            <ChangeRequestRowCard
              key={row.id}
              row={row}
              lead={<span className="va-cr-requester">{staffNameOf(row.requestedBy) ?? "알 수 없음"}</span>}
              onJump={jumpTo}
              showEmptyDiffNote
              error={rowUi.errorOf(row.id)}
            >
              <ApproveRejectActions
                rows={rowUi}
                row={row}
                onApprove={() => void handleApprove(row)}
                onReject={(reason) => void handleReject(row, reason)}
              />
            </ChangeRequestRowCard>
          ))}
        </div>
      )}
    </>
  );
}
