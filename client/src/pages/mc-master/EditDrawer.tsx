import type { ReactNode } from "react";
import { X } from "lucide-react";

// 편집 드로어 공통 쉘: 우측 슬라이드 패널 + backdrop + 헤더(제목·닫기) + panel-body.
// 모델/트림/옵션 편집 패널이 공유한다. className으로 폭 변형(예: va-opt-drawer)을 덧붙인다.
export function EditDrawer({
  title,
  ariaLabel,
  onClose,
  className,
  children,
}: {
  title: string;
  ariaLabel: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="customer-detail-drawer-overlay" role="presentation">
      <button type="button" aria-label="패널 닫기" className="customer-detail-drawer-backdrop" onClick={onClose} />
      <aside
        className={`customer-detail-drawer va-edit-drawer${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div className="panel-head">
          <h2>{title}</h2>
          <button type="button" className="tiny-btn" aria-label="닫기" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="panel-body va-form">{children}</div>
      </aside>
    </div>
  );
}
