import { useState } from "react";

import {
  DELETION_CLASSIFICATION_LABELS,
  confirmAccountDeletion,
  type ConfirmDeletionBody,
  type DeletionClassification,
  type DeletionJob,
} from "../../lib/account-deletions";
import { bindSelect } from "../../lib/select-bind";

// 회원탈퇴 인지 배너(2026-08-01 spec §4-1·§4-3) — 드로어 헤더 직하. 팝오버가 아니라 인라인
// 확장 패널이다(앵커·뷰포트 닫기 축이 아예 없음 — #414 무경고 hidden 부류의 구조적 회피).
// 확인 = 인지 + 분류 확정이지 삭제 거부권이 아니다 — 취소 버튼은 패널 접기일 뿐이다.
// 서버가 진짜 게이트(딜러 403·staff 담당자 스코프·B retentionUntil 필수) — canConfirm은 UX 보조.
export function WithdrawalBanner({ job, canConfirm, onConfirmed, onToast }: {
  job: DeletionJob;
  canConfirm: boolean;
  /** 확인 실행 성공 후(캐시 강제 재fetch 완료 뒤) 호출 — 목록 리로드·상세 무효화·드로어 닫기는 부모 몫. */
  onConfirmed: (classification: DeletionClassification) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState<DeletionClassification>(job.proposedClassification);
  const [retentionUntil, setRetentionUntil] = useState("");
  const [retentionBasis, setRetentionBasis] = useState("");
  const [clawbackUntil, setClawbackUntil] = useState("");
  const [saving, setSaving] = useState(false);

  // D+n은 마운트 시점 고정으로 충분(일 단위 표시 — 실시간 갱신 불요. purity 규칙상 렌더 중 Date.now() 금지).
  const [mountedAt] = useState(() => Date.now());
  const days = Math.floor((mountedAt - new Date(job.requestedAt).getTime()) / 86_400_000);

  async function submit() {
    const body: ConfirmDeletionBody = { classification };
    if (classification === "active_fulfillment") {
      if (!retentionUntil) {
        onToast("한시 보존은 보존 기한이 필요합니다.");
        return;
      }
      // 그날까지 보존(KST 자정 직전) — 서버는 미래 시각만 받는다.
      body.retentionUntil = `${retentionUntil}T23:59:59+09:00`;
      if (retentionBasis.trim()) body.retentionBasis = retentionBasis.trim();
    }
    if (classification === "settlement_reference" && clawbackUntil) body.clawbackUntil = clawbackUntil;
    setSaving(true);
    try {
      await confirmAccountDeletion(job.id, body);
      onToast("탈퇴 처리를 완료했습니다.");
      onConfirmed(classification);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "탈퇴 처리에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="회원탈퇴 접수 안내" className="kim-withdrawal-banner" role="status">
      <div className="kim-withdrawal-head">
        <strong>회원탈퇴 접수 D+{days}</strong>
        <span>제안 분류: {DELETION_CLASSIFICATION_LABELS[job.proposedClassification]}</span>
        {canConfirm ? (
          <button className="kim-withdrawal-toggle" disabled={saving} onClick={() => setOpen((v) => !v)} type="button">
            {open ? "접기" : "탈퇴확인"}
          </button>
        ) : null}
      </div>
      <p className="kim-withdrawal-note">
        앱 발송 등 대고객 액션이 차단됩니다. 확인하지 않으면 접수 5일 후 자동 처리됩니다
        (개인정보 파기 · 정산 참조만 보존).
      </p>
      {open && canConfirm ? (
        <div className="kim-withdrawal-confirm">
          <label>
            <span>처리 분류</span>
            {/* controlled select — Safari onInput 병행 바인딩 규칙(bindSelect). */}
            <select disabled={saving} {...bindSelect(classification, (v) => setClassification(v as DeletionClassification))}>
              {(Object.keys(DELETION_CLASSIFICATION_LABELS) as DeletionClassification[]).map((key) => (
                <option key={key} value={key}>{DELETION_CLASSIFICATION_LABELS[key]}</option>
              ))}
            </select>
          </label>
          {classification === "active_fulfillment" ? (
            <>
              <label>
                <span>보존 기한(필수)</span>
                <input disabled={saving} onChange={(e) => setRetentionUntil(e.target.value)} type="date" value={retentionUntil} />
              </label>
              <label>
                <span>보존 근거</span>
                <input disabled={saving} onChange={(e) => setRetentionBasis(e.target.value)} placeholder="출고 연락·조율" type="text" value={retentionBasis} />
              </label>
            </>
          ) : null}
          {classification === "settlement_reference" ? (
            <label>
              <span>환수 기한(모르면 비움)</span>
              <input disabled={saving} onChange={(e) => setClawbackUntil(e.target.value)} type="date" value={clawbackUntil} />
            </label>
          ) : null}
          <p>
            {classification === "active_fulfillment"
              ? "출고에 필요한 최소 정보(이름·연락처·차량·금융사·일정)만 남고 나머지는 파기됩니다."
              : classification === "settlement_reference"
                ? "정산 숫자만 남고 고객 정보는 전부 파기됩니다. 환수 기한 미입력 시 재검토 대상으로 남습니다."
                : "고객 데이터가 전부 파기됩니다. 되돌릴 수 없습니다."}
          </p>
          <div className="kim-withdrawal-actions">
            <button disabled={saving} onClick={() => setOpen(false)} type="button">닫기</button>
            <button className="danger" disabled={saving} onClick={() => void submit()} type="button">
              {saving ? "처리 중…" : "확정 실행"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
