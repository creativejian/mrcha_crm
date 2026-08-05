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

// 전체 승인 진행 상태 — 실행 중 진행률과 종료 후 요약을 같은 값으로 말한다(둘을 따로 두면
// "끝났는데 진행률이 남아 있는" 어긋난 상태가 생긴다).
type BulkApprove = { running: boolean; done: number; failed: number; total: number };

export function ChangeRequestQueueButton({ onApplied }: { onApplied: () => void }) {
  useStaffDirectory(); // 이름 캐시 예열 — staffNameOf는 동기 조회라 렌더 전에 로드를 걸어둔다.
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [bulk, setBulk] = useState<BulkApprove | null>(null);
  const rowUi = useChangeRequestRows();
  const { rows, failed, reload, approve, reject } = useChangeRequestQueue(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 반려 사유를 입력하는 동안은 바깥 클릭으로 닫히지 않게 — 타이핑 중 오조작 방지.
  // 전체 승인이 도는 동안도 같다(진행률이 유일한 진행 표시라, 실수로 닫으면 어디까지 됐는지 못 본다).
  // (Esc는 guard 대상이 아니라 그대로 닫힌다 — usePopoverDismiss 원 동작. 그때도 루프는 계속 돌고
  // bulk 상태가 컴포넌트에 남아 있어 다시 열면 진행률을 이어서 본다. closePopover가 잔여
  // rejecting 상태를 정리한다.)
  usePopoverDismiss(popRef, open, () => closePopover(), {
    guard: () => rowUi.hasRejecting() || bulk?.running === true,
    anchorRef: btnRef, // 버튼 재클릭 이중 발화 방지(닫기는 toggle 몫 — 2026-08-03)
  });

  // 닫으며 rejecting/error를 되돌린다 — Esc로 닫혔던 반려 입력이 다음 열림에도 남아 있으면
  // guard가 바깥 클릭 닫기를 계속 막는다. setOpen(false)로 닫는 모든 경로가 이걸 통해야 한다.
  function closePopover() {
    setOpen(false);
    rowUi.resetTransient();
    // 끝난 전체 승인 요약은 닫을 때 치운다(다음 열림에 지난 결과가 남아 있으면 방금 한 일로 읽힌다).
    // 진행 중(Esc로 닫힌 경우)이면 그대로 둬야 다시 열었을 때 진행률을 이어서 본다.
    setBulk((b) => (b?.running ? b : null));
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

  // 대기 전량 승인(2026-08-05 이사님 요청 — 144건을 하나씩 누르는 게 실무 부담이었다).
  // ⚠️ **건별 순차 호출**이다. 서버에 일괄 엔드포인트를 새로 두지 않은 이유:
  //   ① 승인 1건 = 트랜잭션 하나(선점→재검증→드리프트→replay)라, 한 트랜잭션에 묶으면 드리프트
  //      1건 때문에 나머지 전부가 롤백된다 — 대량 작업일수록 "앞서 된 것은 남는" 편이 낫다.
  //   ② 실패는 행 단위로 이미 표현된다(rowUi.errorOf) — 일괄 응답을 새 형태로 만들 이유가 없다.
  //   ③ Workers는 실행 시간 상한이 있어 서버 루프가 오히려 중간에 끊길 위험을 만든다.
  // 실패해도 **멈추지 않고 계속**한다 — 다른 관리자가 그새 대상을 고쳐 드리프트가 난 1건 때문에
  // 나머지 143건이 막히면 안 된다. 실패 건은 목록에 사유와 함께 남는다.
  async function handleApproveAll() {
    // 루프 시작 시점의 스냅샷 — 성공 행이 done으로 빠지면서 visibleRows가 줄어들기 때문에
    // 순회 중 그 배열을 그대로 쓰면 건너뛰는 행이 생긴다.
    const targets = visibleRows ?? [];
    if (targets.length === 0 || bulk?.running) return;
    // 되돌릴 수 없는 대량 반영이라 반드시 막는다(레포 선례: MC 마스터 일괄 삭제·조직 멤버 삭제).
    const ok = window.confirm(
      `대기 중인 ${targets.length}건을 모두 승인합니다.\n승인하면 카탈로그에 바로 반영되고 되돌릴 수 없습니다.\n계속할까요?`,
    );
    if (!ok) return;
    let done = 0;
    let failed = 0;
    setBulk({ running: true, done, failed, total: targets.length });
    for (const row of targets) {
      if (await rowUi.run(row.id, () => approve(row.id), "승인 실패")) done += 1;
      else failed += 1;
      setBulk({ running: true, done, failed, total: targets.length });
    }
    setBulk({ running: false, done, failed, total: targets.length });
    // 재조회는 끝에 한 번만 — 건마다 걸면 카탈로그를 144번 다시 읽는다.
    if (done > 0) onApplied();
    reload();
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
          {/* 고정 헤더 — 목록이 길어(실기 144건) 아래로 내려가면 전체 승인 버튼이 화면 밖으로
              사라진다. 팝오버 자신이 스크롤 컨테이너라 여기에 sticky를 걸면 그대로 붙는다. */}
          <div className="va-cr-head">
            <strong>승인 대기 {visibleRows?.length ?? 0}건</strong>
            {bulk?.running ? (
              // 진행률이 곧 "아직 돌고 있다"는 유일한 신호다 — 건별 순차라 총 시간이 길 수 있다.
              <span className="va-cr-bulk-progress" role="status">
                승인 중 {bulk.done + bulk.failed}/{bulk.total}…
              </span>
            ) : (
              // 검정 배경(.primary) — 같은 화면 "모델 추가"와 같은 무게의 주 액션이다(2026-08-05 유슨생).
              <button
                className="btn primary"
                disabled={!visibleRows?.length}
                onClick={() => void handleApproveAll()}
                type="button"
              >
                전체 승인
              </button>
            )}
          </div>
          {bulk && !bulk.running && (
            <p className="va-cr-bulk-summary" role="status">
              {bulk.done}건 승인
              {bulk.failed > 0 ? ` · ${bulk.failed}건 실패 — 아래 사유를 확인하세요.` : ""}
            </p>
          )}
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
