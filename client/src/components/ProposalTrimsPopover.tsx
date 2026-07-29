import type { RefObject } from "react";
import { useNavigate } from "react-router";

import type { DealerProposalTrim } from "@/lib/dealer-roster";
import { mcMasterPath } from "@/pages/mc-master/mc-master-route";
import { fmtDate } from "@/pages/mc-master/trim-format";

// 입력 트림 팝오버 본체 — 두 소비처가 같은 부품을 쓴다(2026-07-29 유슨생):
//   ① 관리자 딜러 명부 "보기 (N)"(OrgMembersPage) ② 딜러 모드 헤더 "내 입력 트림 (N)"(MC 마스터).
// 행 클릭 → /mc-master/:modelId?brand=&hl= 으로 이동해 착지 행을 플래시로 마킹한다.
// 열림 상태·fetch·버튼 앵커는 소비처 몫이다(대상 딜러가 다르다) — 여기는 표시와 이동만 담당.

export type PopoverPos = { top: number; left: number; maxHeight: number };

// fixed 좌표 — 표가 overflow 래퍼 안이라 absolute는 잘린다(콘솔 fixed 선례와 같은 축).
// maxHeight = 화면 남은 높이(목록이 길면 팝오버 안에서 스크롤), left는 최대 폭(720)+여백 클램프.
// eslint-disable-next-line react-refresh/only-export-components -- 좌표 계산은 이 팝오버 전용 헬퍼라 같은 모듈에 둔다(AuthProvider·useAuth 선례)
export function popoverPosFromRect(rect: DOMRect | undefined): PopoverPos | null {
  if (!rect) return null;
  return {
    top: rect.bottom + 4,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 736)),
    maxHeight: Math.max(160, window.innerHeight - rect.bottom - 16),
  };
}

// 낸 금액 요약("자사 4,000,000원 · 제휴 6,000,000원") — null 필드는 미제안이라 표기하지 않는다.
// 확정가(트림 price)를 모르는 문맥이라 할인 셀의 % 표기는 하지 않는다(원 금액이 사실의 전부).
function amountsSummary(r: DealerProposalTrim): string {
  const parts: string[] = [];
  if (r.financialAmount !== null) parts.push(`자사 ${r.financialAmount.toLocaleString()}원`);
  if (r.partnerAmount !== null) parts.push(`제휴 ${r.partnerAmount.toLocaleString()}원`);
  if (r.cashAmount !== null) parts.push(`타사 ${r.cashAmount.toLocaleString()}원`);
  return parts.join(" · ");
}

export function ProposalTrimsPopover({
  popRef,
  pos,
  rows,
  failed,
}: {
  popRef: RefObject<HTMLDivElement | null>;
  pos: PopoverPos | null;
  /** null = 로딩 중(캐시 미보유). 빈 배열 = 입력한 트림 없음. */
  rows: DealerProposalTrim[] | null;
  failed: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="org-dealer-trims-pop"
      ref={popRef}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : undefined}
    >
      {rows === null && !failed && <div className="org-dealer-trims-note">불러오는 중…</div>}
      {failed && <div className="org-dealer-trims-note">목록을 불러오지 못했습니다.</div>}
      {rows !== null && !failed && rows.length === 0 && (
        <div className="org-dealer-trims-note">입력한 트림이 없습니다.</div>
      )}
      {rows?.map((r) => {
        // 클로저(onClick) 안에서는 property 내로잉이 사라진다 — 목적지를 먼저 굳힌다.
        const dest =
          r.modelId != null && r.brandId != null ? `${mcMasterPath(r.brandId, r.modelId)}&hl=${r.trimId}` : null;
        return dest != null ? (
          <button
            className="org-dealer-trim-row"
            key={r.trimId}
            onClick={() => navigate(dest)}
            title="이 트림의 화면으로 이동합니다."
            type="button"
          >
            {/* title = 전체 이름 — 이름 열만 말줄임 대상이라(그리드 1fr) 잘렸을 때 복구 경로. */}
            <span className="org-dealer-trim-name" title={`${r.modelName} · ${r.trimName}`}>
              {r.modelName} · {r.trimName}
            </span>
            {/* 코드는 이름 span 밖의 자기 열 — 이름 말줄임에 같이 잘리면 안 된다(실기: MC0705…). */}
            <span className="org-dealer-trim-code">{r.mcCode ?? ""}</span>
            <span className="org-dealer-trim-amounts">{amountsSummary(r)}</span>
            {/* 제안변경일(2026-07-29 유슨생) — 이 값이 언제 것인지가 채택 판단의 일부다. */}
            <span className="org-dealer-trim-date">{fmtDate(r.updatedAt)}</span>
          </button>
        ) : (
          // 카탈로그에서 삭제된 트림(loose id) — "무엇을 지우는지" 목록에는 남기되 이동은 없다.
          <div className="org-dealer-trim-row deleted" key={r.trimId}>
            <span className="org-dealer-trim-name">삭제된 트림</span>
            <span className="org-dealer-trim-code" />
            <span className="org-dealer-trim-amounts">{amountsSummary(r)}</span>
            <span className="org-dealer-trim-date">{fmtDate(r.updatedAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
