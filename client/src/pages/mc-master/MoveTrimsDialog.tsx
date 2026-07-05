import { useState } from "react";
import { X } from "lucide-react";

import type { CatalogModel } from "@/lib/catalog";

// 선택한 트림을 같은 브랜드의 다른 모델로 이동(앱 '모델 이동' 다이얼로그).
export function MoveTrimsDialog({
  count,
  targets,
  busy,
  onClose,
  onMove,
}: {
  count: number;
  targets: CatalogModel[];
  busy: boolean;
  onClose: () => void;
  onMove: (targetModelId: number) => void;
}) {
  const [targetId, setTargetId] = useState<number | null>(targets[0]?.id ?? null);
  return (
    <div className="customer-detail-drawer-overlay va-dialog-overlay" role="presentation">
      <button type="button" aria-label="닫기" className="customer-detail-drawer-backdrop" onClick={onClose} />
      <div className="va-dialog" role="dialog" aria-modal="true" aria-label="모델 이동">
        <div className="panel-head">
          <h2>모델 이동 ({count})</h2>
          <button type="button" className="tiny-btn" aria-label="닫기" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="panel-body va-form">
          {targets.length === 0 ? (
            <div className="va-empty">이동할 수 있는 다른 모델이 없습니다.</div>
          ) : (
            <>
              <label className="va-field">
                <span>대상 모델 (같은 브랜드)</span>
                <select
                  className="select"
                  value={targetId ?? ""}
                  // Safari: 팝오버 선택 시 input(신값)→controlled 복원→change(구값) 순서라 onInput 병행 필수(2026-07-05 실측).
                  onChange={(e) => setTargetId(Number(e.currentTarget.value))}
                  onInput={(e) => setTargetId(Number(e.currentTarget.value))}
                >
                  {targets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="va-form-actions">
                <button type="button" className="btn" onClick={onClose} disabled={busy}>
                  취소
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || targetId == null}
                  onClick={() => targetId != null && onMove(targetId)}
                >
                  {busy ? "이동 중…" : "이동"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
