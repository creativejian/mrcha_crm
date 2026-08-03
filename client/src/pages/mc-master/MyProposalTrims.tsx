import { useEffect, useRef, useState } from "react";

import { ProposalTrimsPopover } from "@/components/ProposalTrimsPopover";
import { popoverPosFromRect, type PopoverPos } from "@/lib/popover-pos";
import {
  fetchMyProposalTrims,
  getCachedMyProposalTrims,
  type DealerProposalTrim,
} from "@/lib/dealer-roster";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

// 딜러 모드 헤더의 "내 입력 트림 (N)"(2026-07-29 유슨생) — 딜러가 자기가 제안을 낸 트림을
// 한눈에 보고, 행을 눌러 그 트림 화면으로 착지(플래시)한다. 관리자 명부 "보기 (N)"와 같은
// 팝오버 부품(ProposalTrimsPopover)을 쓴다 — 응답 형태가 같아 표시·이동이 한 벌이다.
export function MyProposalTrimsButton() {
  const [open, setOpen] = useState(false);
  // 진입 시 프리로드로 채워 (N)을 처음부터 보여준다 — 캐시가 있으면 그 값으로 시작(왕복 0).
  const [rows, setRows] = useState<DealerProposalTrim[] | null>(getCachedMyProposalTrims() ?? null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(popRef, open, () => setOpen(false));

  useEffect(() => {
    let alive = true;
    // 제안 저장(dealer-discounts.save)이 캐시를 무효화하므로, 재진입 때 여기서 새 값을 받는다.
    fetchMyProposalTrims()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        // 프리로드 실패는 조용히 둔다 — 버튼을 누르면 본 fetch가 다시 가서 실패를 표시한다.
      });
    return () => {
      alive = false;
    };
  }, []);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setPos(popoverPosFromRect(btnRef.current?.getBoundingClientRect()));
    setOpen(true);
    setFailed(false);
    const cached = getCachedMyProposalTrims() ?? null;
    setRows(cached);
    fetchMyProposalTrims()
      .then(setRows)
      .catch(() => {
        if (cached === null) setFailed(true);
      });
  }

  const count = rows?.length ?? 0;
  return (
    <>
      <button
        className="badge purple org-dealer-action"
        disabled={rows !== null && count === 0}
        onClick={toggle}
        ref={btnRef}
        title={rows !== null && count === 0 ? "아직 입력한 트림이 없습니다." : undefined}
        type="button"
      >
        내 입력 트림{count > 0 ? ` (${count})` : ""}
      </button>
      {open && <ProposalTrimsPopover failed={failed} popRef={popRef} pos={pos} rows={rows} />}
    </>
  );
}
