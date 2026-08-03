import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApproveRejectActions, ChangeRequestRowCard } from "@/components/ChangeRequestRowCard";
import { useChangeRequestRows } from "@/lib/change-request-rows";
import { approveChangeRequestById, rejectChangeRequestById, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { popoverPos, popoverStyle, type PopoverPos } from "@/lib/popover-pos";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

// 행 "승인 대기" 배지(spec §7.2 확장, 2026-08-03) — 구 hover title(요청자·경과·작업 텍스트)에서
// 클릭 팝오버로 승격: 어떤 값이 바뀌는지(전→후 diff)를 행 자리에서 바로 보고, admin은 그
// 자리에서 승인/반려까지 한다(헤더 대기열 왕복 동선 제거 — 이사님 요청). manager에게는 같은
// 팝오버가 읽기 전용(diff 확인)이다.
// 셸·행 상태·카드 마크업은 대기열 팝오버와 공용 부품이다(.va-cr-* · change-request-rows ·
// ChangeRequestRowCard). 대상 라벨·점프는 없다 — 이미 그 행 위다.

/**
 * 아래 공간이 이보다 좁으면 위로 편다 — 240 = 요청 카드 1장(머리줄+diff 몇 줄+액션)이 잘리지
 * 않는 최소치. 배지는 테이블 **마지막 행**에도 사는데 항상 아래로 열면 뷰포트를 뚫고 내려가
 * 잘린다(2026-08-03 실기 — mc-master는 페이지 스크롤이 잠겨 있어 스크롤로도 못 본다).
 */
const BADGE_FLIP_BELOW = 240;

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
  const rowUi = useChangeRequestRows();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 반려 사유 타이핑 중 바깥 클릭으로 닫히지 않게(대기열 팝오버와 같은 guard).
  // anchorRef = 배지 버튼 재클릭이 pointerdown 닫기 → click 재열기로 이중 발화하지 않게(닫기는 toggle 몫).
  usePopoverDismiss(popRef, open, () => closePopover(), {
    guard: () => rowUi.hasRejecting(),
    anchorRef: btnRef,
  });

  // 스크롤이면 닫는다(2026-08-03 실기) — 좌표가 fixed(뷰포트 고정)라 표가 스크롤되면 팝오버만
  // 제자리에 남아 엉뚱한 행 위를 떠다닌다. 팝오버 **안**의 스크롤(내용이 길 때 overflow-y)은
  // 닫지 않는다. capture로 어느 스크롤 컨테이너든 잡는다(table-scroll·window 모두).
  // closePopover는 렌더마다 새 함수 — ref로 최신본만 참조해 effect가 open에만 반응하게 한다
  // (usePopoverDismiss의 onDismissRef와 같은 결).
  const closePopoverRef = useRef<() => void>(() => {});
  useEffect(() => {
    closePopoverRef.current = closePopover;
  });
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      closePopoverRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  if (!requests || requests.length === 0) return null;
  const rows = requests;

  // 닫으며 rejecting/error를 되돌린다 — 잔여 rejecting이 남으면 guard가 다음 열림의 바깥 클릭
  // 닫기를 계속 막는다(대기열 closePopover와 같은 규칙).
  function closePopover() {
    setOpen(false);
    rowUi.resetTransient();
  }

  function toggle() {
    if (open) {
      closePopover();
      return;
    }
    setPos(
      popoverPos(
        btnRef.current?.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { flipBelow: BADGE_FLIP_BELOW },
      ),
    );
    setOpen(true);
  }

  // 처리 성공 직후 — 이 행이 마지막이었으면 팝오버도 닫는다(빈 팝오버 방지). 방금 done으로
  // 바뀐 자기 행은 상태 반영 전이라 id로 제외하고 나머지만 본다.
  // 닫기는 이벤트 콜백 안에서만 한다 — 렌더/이펙트 본문 setState는 lint 기준선 위반.
  function closeIfLast(row: ChangeRequestItem) {
    if (!rows.some((r) => r.id !== row.id && !rowUi.isDone(r.id))) closePopover();
  }

  async function handleApprove(row: ChangeRequestItem) {
    if (await rowUi.run(row.id, () => approveChangeRequestById(row.id), "승인 실패")) {
      closeIfLast(row);
      onApplied();
    }
  }
  async function handleReject(row: ChangeRequestItem, reason: string) {
    rowUi.setRejectBusy(row.id);
    // 반려는 catalog 무변 — onApplied 없이 숨김만.
    if (await rowUi.run(row.id, () => rejectChangeRequestById(row.id, reason), "반려 실패", { markBusy: false })) {
      closeIfLast(row);
    }
  }

  // 전 건 처리 완료(done) — 배지·팝오버 미표시(팝오버는 closeIfLast가 이미 닫았고, 서버 재조회가
  // 곧 requests 자체를 걷어낸다).
  const visible = rows.filter((r) => !rowUi.isDone(r.id));
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
          <div className="va-cr-pop" ref={popRef} style={popoverStyle(pos)}>
            {visible.map((row) => (
              <ChangeRequestRowCard
                key={row.id}
                row={row}
                lead={<span className="va-cr-requester">{staffNames.get(row.requestedBy) ?? "알 수 없음"}</span>}
                showEmptyDiffNote
                error={rowUi.errorOf(row.id)}
              >
                {canApprove && (
                  <ApproveRejectActions
                    rows={rowUi}
                    row={row}
                    onApprove={() => void handleApprove(row)}
                    onReject={(reason) => void handleReject(row, reason)}
                  />
                )}
              </ChangeRequestRowCard>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
