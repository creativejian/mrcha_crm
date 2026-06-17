import { Fragment } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";

import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import { ColorChips, OptionBadgeButton, TrimHeadCells, TrimMetaCells } from "./trim-cells";
import { TRIM_BODY_COLS } from "./trim-format";
import { groupTrimsBySubline, trimGrade } from "./trim-grouping";

// 국산차 '목록 보기': 서브라인 단위 접이식 그룹. 그룹 내에서는 등급만 표시한다(편집은 행별 ✎).
// 순서변경/일괄삭제는 '순서 관리' 탭(평면 TrimTable)에서만 — 여기서는 읽기/개별 편집만.
export function GroupedTrimTable({
  trims,
  canEdit,
  colorsByTrim,
  optionByTrim,
  expanded,
  onToggleGroup,
  onEdit,
  onOpenOptions,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  expanded: Set<string>;
  onToggleGroup: (key: string) => void;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const groups = groupTrimsBySubline(trims);
  const colSpan = TRIM_BODY_COLS + (canEdit ? 1 : 0);
  return (
    <table className="customer-table va-trim-table">
      <thead>
        <tr>
          <th className="va-th-trim">트림명</th>
          <TrimHeadCells />
          {canEdit && <th className="va-col-center" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const open = expanded.has(g.key);
          return (
            <Fragment key={g.key}>
              <tr className="va-group-row">
                <td colSpan={colSpan}>
                  <button
                    type="button"
                    className="va-group-toggle"
                    aria-expanded={open}
                    onClick={() => onToggleGroup(g.key)}
                  >
                    {open ? (
                      <ChevronDown size={16} className="va-group-chevron" />
                    ) : (
                      <ChevronRight size={16} className="va-group-chevron" />
                    )}
                    <span className="va-group-name">{g.key}</span>
                    <span className="va-group-count">{g.trims.length}개 트림</span>
                  </button>
                </td>
              </tr>
              {open &&
                g.trims.map((t) => (
                  <tr key={t.id}>
                    <td className="va-grade-cell">
                      <div className="va-trim-name">{trimGrade(t.trimName)}</div>
                      <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
                    </td>
                    <TrimMetaCells trim={t} />
                    <td className="va-col-center">
                      <OptionBadgeButton summary={optionByTrim.get(t.id)} onClick={() => onOpenOptions(t)} />
                    </td>
                    {canEdit && (
                      <td className="va-col-center">
                        <button
                          type="button"
                          className="tiny-btn"
                          aria-label={`${t.trimName} 수정`}
                          onClick={() => onEdit(t)}
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
