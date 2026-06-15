import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { optionTotal, resolveSelection } from "@/lib/option-selection";
import { formatMoney } from "@/lib/quote-pricing";
import type { TrimOption, TrimOptionRelation } from "@/lib/vehicles";

type OptionPickerProps = {
  options: TrimOption[];
  relations: TrimOptionRelation[];
  onChange?: (next: { selectedIds: number[]; total: number }) => void;
};

export function OptionPicker({ options, relations, onChange }: OptionPickerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 트림이 바뀌면 부모가 key로 재마운트 → 선택은 자연히 초기화(effect 내 setState 회피).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const basics = options.filter((o) => o.type === "basic");
  const tunings = options.filter((o) => o.type === "tuning");
  const total = optionTotal(options, selectedIds);
  const selectedCount = options.filter((o) => selectedIds.has(o.id)).length;

  function toggle(id: number) {
    const next = resolveSelection(relations, selectedIds, id, !selectedIds.has(id));
    setSelectedIds(next);
    onChange?.({ selectedIds: [...next], total: optionTotal(options, next) });
  }

  function renderOption(o: TrimOption) {
    return (
      <button
        key={o.id}
        className={`kim-option-picker-option${selectedIds.has(o.id) ? " is-selected" : ""}`}
        type="button"
        role="checkbox"
        aria-checked={selectedIds.has(o.id)}
        onClick={() => toggle(o.id)}
      >
        <span>{o.name}</span>
        <em>+{formatMoney(o.price ?? 0)}원</em>
      </button>
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
