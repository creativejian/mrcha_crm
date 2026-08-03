import { Pencil } from "lucide-react";

import type { ChangeRequestItem } from "@/lib/catalog-change-requests";
import { ColorChips, TrimMetaCells } from "./trim-cells";
import type { PendingTrimPreview } from "./pending-preview";
import { PendingRequestBadge } from "./PendingRequestBadge";
import { trimGrade } from "./trim-grouping";

// 신규 트림(trim.create pending) 미리보기 행(2026-08-03) — 승인 대기 텍스트 요약만으로는
// "추가된 게 어떻게 생겼는지"가 안 보인다는 이사님 지적의 해소. payload를 CatalogTrim 모양으로
// 합성(pending-preview.ts)해 기존 행 셀(TrimMetaCells)을 그대로 입는다 — 컬럼 정렬 공짜.
// 승인 전 실 데이터가 아님은 .va-row-pending 앰버 톤 + "승인 대기(신규)" 배지가 말한다.
// 요청자 본인(manager)에게는 연필 = "이어서 수정"(폼 프리필 → 저장 시 기존 요청 교체).
export function PendingTrimPreviewRow({
  preview,
  flash = false,
  grouped,
  showOptionCol,
  showEditCol,
  staffNames,
  canApprove,
  onApplied,
  myUserId,
  onContinue,
}: {
  preview: PendingTrimPreview;
  /** ?hlreq= 착지 마킹(대기열/내 요청의 신규 트림 링크) — 실 행의 flashTrimId와 같은 축. */
  flash?: boolean;
  /** 그룹 뷰(국산차)는 등급만, 평면 뷰(수입차)는 전체 트림명 — 실 행과 같은 표기 규칙. */
  grouped: boolean;
  showOptionCol: boolean;
  showEditCol: boolean;
  staffNames: Map<string, string>;
  canApprove: boolean;
  onApplied: () => void;
  myUserId: string | null;
  onContinue?: (request: ChangeRequestItem) => void;
}) {
  const t = preview.trim;
  const mine = myUserId != null && preview.request.requestedBy === myUserId;
  return (
    // data-request-id = hlreq 스크롤 앵커(실 행의 data-trim-id와 같은 축).
    <tr className={`va-row-pending${flash ? " va-row-flash" : ""}`} data-request-id={preview.request.id}>
      <td className={grouped ? "va-grade-cell" : "va-th-trim"}>
        <div className="va-trim-name">
          <span>{grouped ? trimGrade(t.trimName) : t.trimName}</span>
          <PendingRequestBadge
            label="승인 대기(신규)"
            requests={[preview.request]}
            staffNames={staffNames}
            canApprove={canApprove}
            onApplied={onApplied}
          />
        </div>
        <ColorChips colors={[]} />
      </td>
      <TrimMetaCells trim={t} />
      {/* 옵션은 트림 승인 뒤에나 달 수 있다 — 배지 대신 빈 표기. */}
      {showOptionCol && <td className="va-col-center va-muted">—</td>}
      {showEditCol && (
        <td className="va-col-center">
          {mine && onContinue && (
            <button
              type="button"
              className="tiny-btn"
              aria-label={`${t.trimName} 이어서 수정`}
              onClick={() => onContinue(preview.request)}
            >
              <Pencil size={14} />
            </button>
          )}
        </td>
      )}
    </tr>
  );
}
