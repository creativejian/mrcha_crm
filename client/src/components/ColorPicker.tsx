import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { useOutsideClick } from "@/lib/useOutsideClick";
import type { TrimColor } from "@/lib/vehicles";

type ColorPickerProps = {
  colorType: "exterior" | "interior";
  colors: TrimColor[];
  value: TrimColor | null;
  onChange?: (color: TrimColor) => void;
};

export function ColorPicker({ colorType, colors, value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useOutsideClick(rootRef, open, () => setOpen(false));

  const items = colors.filter((c) => c.colorType === colorType).sort((a, b) => a.sortOrder - b.sortOrder);
  const label = colorType === "exterior" ? "외장" : "내장";

  function select(color: TrimColor) {
    onChange?.(color);
    setOpen(false);
  }

  return (
    <div className="kim-color-picker" ref={rootRef}>
      <button className="kim-jeff-picker-row" type="button" disabled={!items.length} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        {value ? (
          <b className="kim-color-picker-value">
            <span className="kim-color-picker-swatch" style={{ background: value.hexValue ?? "transparent" }} />
            {value.name}
          </b>
        ) : (
          <b className="muted">미선택</b>
        )}
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="kim-color-picker-menu" role="listbox">
          {items.map((c) => (
            <button
              key={c.id}
              className={`kim-color-picker-option${value?.id === c.id ? " is-selected" : ""}`}
              type="button"
              onClick={() => select(c)}
            >
              <span className="kim-color-picker-swatch" style={{ background: c.hexValue ?? "transparent" }} />
              <span className="kim-color-picker-name">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
