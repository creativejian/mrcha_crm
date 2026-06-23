import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { disabledOptionIds, excludeGroups, excludePartners, optionTotal, resolveSelection } from "@/lib/option-selection";
import { formatMoney } from "@/lib/quote-pricing";
import { useOutsideClick } from "@/lib/useOutsideClick";
import type { TrimOption, TrimOptionRelation } from "@/lib/vehicles";

type OptionPickerProps = {
  options: TrimOption[];
  relations: TrimOptionRelation[];
  initialSelectedIds?: number[];
  onChange?: (next: { selectedIds: number[]; total: number }) => void;
};

export function OptionPicker({ options, relations, initialSelectedIds, onChange }: OptionPickerProps) {
  // 트림이 바뀌면 부모가 key로 재마운트 → 선택은 자연히 초기화(effect 내 setState 회피).
  // 수정모드 진입 시 부모가 initialSelectedIds로 기존 옵션을 복원(lazy init이라 1회).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(initialSelectedIds));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useOutsideClick(rootRef, open, () => setOpen(false));

  const basics = options.filter((o) => o.type === "basic");
  const tunings = options.filter((o) => o.type === "tuning");
  const total = optionTotal(options, selectedIds);
  const selectedCount = options.filter((o) => selectedIds.has(o.id)).length;
  const disabled = disabledOptionIds(relations, selectedIds);
  const groups = excludeGroups(options, relations);
  const nameById = new Map(options.map((o) => [o.id, o.name] as const));
  const hasExcludeGroups = groups.size > 0;

  function toggle(id: number) {
    const next = resolveSelection(relations, selectedIds, id, !selectedIds.has(id));
    setSelectedIds(next);
    onChange?.({ selectedIds: [...next], total: optionTotal(options, next) });
  }

  function renderOption(o: TrimOption) {
    const group = groups.get(o.id);
    const partners = excludePartners(relations, o.id);
    return (
      <div key={o.id} className="kim-option-picker-row-wrap">
        <button
          className={`kim-option-picker-option${selectedIds.has(o.id) ? " is-selected" : ""}`}
          type="button"
          role="checkbox"
          aria-checked={selectedIds.has(o.id)}
          disabled={disabled.has(o.id)}
          onClick={() => toggle(o.id)}
        >
          {group !== undefined ? <span className={`kim-option-picker-dot kim-option-picker-dot--${group % 6}`} /> : null}
          <span className="kim-option-picker-name">{o.name}</span>
          <em>+{formatMoney(o.price ?? 0)}원</em>
        </button>
        {partners.length ? (
          <span className="kim-option-picker-relation">
            ⇄ {partners.map((id) => nameById.get(id)).filter(Boolean).join(", ")}와 중복 선택 불가
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="kim-option-picker" ref={rootRef}>
      <button
        className="kim-jeff-picker-row"
        type="button"
        disabled={!options.length}
        onClick={() => setOpen(!open)}
      >
        <span>옵션</span>
        <b className={selectedCount ? "" : "muted"}>
          {selectedCount ? `${selectedCount}개 선택` : "선택"}
          {total > 0 ? ` · +${formatMoney(total)}원` : ""}
        </b>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="kim-option-picker-menu">
          {hasExcludeGroups ? (
            <div className="kim-option-picker-hint">
              <span className="kim-option-picker-dot kim-option-picker-dot--0" />
              <span className="kim-option-picker-dot kim-option-picker-dot--1" />
              <span className="kim-option-picker-dot kim-option-picker-dot--2" />
              같은 색 = 중복 선택 불가
            </div>
          ) : null}
          {basics.length ? (
            <div className="kim-option-picker-group">
              <span className="kim-option-picker-label">기본 옵션</span>
              {basics.map(renderOption)}
            </div>
          ) : null}
          {tunings.length ? (
            <div className="kim-option-picker-group">
              <span className="kim-option-picker-label">튜닝 옵션</span>
              {tunings.map(renderOption)}
            </div>
          ) : null}
          {!basics.length && !tunings.length ? <span className="kim-option-picker-msg">옵션 없음</span> : null}
        </div>
      ) : null}
    </div>
  );
}
