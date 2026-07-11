import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HANDOFF_DAY_KEYS, HANDOFF_DAY_LABELS, HANDOFF_MODES, HANDOFF_MODE_LABELS, type HandoffMode } from "@/data/chat";
import {
  auditSummary,
  availabilityBadge,
  fetchHandoffAudits,
  fetchHandoffAvailability,
  fetchHandoffSettings,
  saveHandoffSettings,
  scheduleDraftErrors,
  subscribeHandoffSettings,
  withAppLineBreaks,
  type HandoffAudit,
  type HandoffAvailability,
  type HandoffSettings,
  type WeekSchedule,
} from "@/lib/handoff-settings";
import { useStaffDirectory } from "@/lib/staff";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";

// 고객 앱 실시간 상담사 연결의 전사 운영 설정(앱 이슈 #582 CRM 몫).
// 저장은 update_human_handoff_settings RPC 단일 경로(admin 검사+감사 기록 원자) —
// 라우트가 admin 게이트지만 RPC가 최종 fail-closed(42501→403)라 화면은 표면화만 담당한다.

const DEFAULT_DAY = { start: "09:00", end: "18:00" };

function formatKst(iso: string): string {
  // 브라우저 로컬이 아니라 KST 명시(#204 계산법 드리프트 교훈 — 표시도 축을 고정).
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

type Draft = {
  mode: HandoffMode;
  schedule: WeekSchedule;
  forceMessage: string;
  outsideHoursMessage: string;
};

function draftFrom(settings: HandoffSettings): Draft {
  return {
    mode: settings.mode,
    schedule: settings.schedule,
    forceMessage: settings.forceMessage,
    outsideHoursMessage: settings.outsideHoursMessage,
  };
}

function isDirty(draft: Draft, settings: HandoffSettings): boolean {
  return JSON.stringify(draft) !== JSON.stringify(draftFrom(settings));
}

type HandoffOperationPageProps = { onToast: (message: string) => void };

export function HandoffOperationPage({ onToast }: HandoffOperationPageProps) {
  const [settings, setSettings] = useState<HandoffSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [availability, setAvailability] = useState<HandoffAvailability | null>(null);
  const [audits, setAudits] = useState<HandoffAudit[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const { staff } = useStaffDirectory();

  const dirty = settings != null && draft != null && isDirty(draft, settings);
  // Realtime 콜백이 최신 dirty를 읽도록 ref 동기화(구독은 마운트 1회라 클로저가 낡는다).
  // useLayoutEffect = paint 전 갱신 + 렌더 중 ref 쓰기 금지(react-hooks/refs) 준수 — App.tsx locationRef 패턴.
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // promise 체인(setState는 .then 콜백 안) — App.tsx reloadCustomers와 같은 패턴.
  const reload = useCallback((reseed: boolean): Promise<void> => {
    return Promise.all([fetchHandoffSettings(), fetchHandoffAvailability(), fetchHandoffAudits()])
      .then(([nextSettings, nextAvailability, nextAudits]) => {
        setSettings(nextSettings);
        setAvailability(nextAvailability);
        setAudits(nextAudits);
        setLoadError(false);
        if (reseed) {
          setDraft(draftFrom(nextSettings));
          setRemoteChanged(false);
        }
      })
      .catch(() => {
        setLoadError(true);
      });
  }, []);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  // 다른 관리자의 저장을 실시간 반영. 편집 중(dirty)에는 draft를 덮지 않고 배너로만 알린다.
  useEffect(() => {
    return subscribeHandoffSettings(() => {
      if (dirtyRef.current) {
        setRemoteChanged(true);
        void reload(false);
      } else {
        void reload(true);
      }
    });
  }, [reload]);

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaveError(null);
  }

  async function handleSave() {
    if (!draft) return;
    const errors = scheduleDraftErrors(draft.schedule);
    if (errors.length > 0) {
      setSaveError(errors[0]);
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setSaveError("변경 사유를 입력해 주세요. 감사 이력에 함께 기록됩니다.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveHandoffSettings(draft, trimmedReason);
      setSettings(saved);
      setDraft(draftFrom(saved));
      setReason("");
      setRemoteChanged(false);
      onToast("상담 운영 설정이 저장되었습니다.");
      // 판정·이력은 저장 반환값 밖이라 재조회(실패해도 저장 자체는 완료 — 조용히 둔다).
      fetchHandoffAvailability().then(setAvailability).catch(() => undefined);
      fetchHandoffAudits().then(setAudits).catch(() => undefined);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="handoff-op-layout">
        <div className="notice-box error">운영 설정을 불러오지 못했습니다. <button className="btn" onClick={() => void reload(true)} type="button">다시 시도</button></div>
      </div>
    );
  }

  if (!settings || !draft) {
    return <div className="handoff-op-layout"><div className="handoff-op-loading">운영 설정을 불러오는 중…</div></div>;
  }

  const badge = availability ? availabilityBadge(availability) : null;
  const staffNameById = new Map(staff.map((entry) => [entry.id, entry.name]));

  return (
    // 2열: 좌 = 편집 폼(모드→시간→문구→저장), 우 = 참조(현재 상태·이력) — 고객 상세 drawer의
    // "좌 작업/우 참조" 문법. 저장·Realtime 변경 결과가 우측 상태 카드에서 스크롤 없이 보인다.
    // 좁은 화면은 1열 복귀(폼 먼저 — 이 페이지 방문 목적이 대부분 설정 변경).
    <div className="handoff-op-layout">
      <div className="handoff-op-main">
      {remoteChanged && (
        <div className="notice-box handoff-op-remote">
          다른 관리자가 방금 설정을 변경했습니다. 아래 편집 중인 값은 유지됩니다 —
          <button className="btn" onClick={() => void reload(true)} type="button">최신 값으로 다시 불러오기</button>
        </div>
      )}

      <section className="card handoff-op-card">
        <div className="panel-head"><h2>운영 모드</h2></div>
        <div className="panel-body">
          <div className="handoff-op-modes" role="radiogroup" aria-label="운영 모드">
            {HANDOFF_MODES.map((mode) => (
              <button
                aria-pressed={draft.mode === mode}
                className={`handoff-op-mode ${mode} ${draft.mode === mode ? "active" : ""}`}
                key={mode}
                onClick={() => patchDraft({ mode })}
                type="button"
              >
                <strong>{HANDOFF_MODE_LABELS[mode]}</strong>
                <small>
                  {mode === "automatic" && "아래 운영시간에 따라 자동 판정합니다."}
                  {mode === "force_on" && "운영시간 밖에도 상담사 연결을 받습니다."}
                  {mode === "force_off" && "운영시간 안에도 상담사 연결을 전면 차단합니다."}
                </small>
              </button>
            ))}
          </div>
          {draft.mode === "force_off" && (
            <p className="handoff-op-warning">강제 OFF 동안 고객은 상담사 연결 대신 유선 상담 접수로 안내됩니다.</p>
          )}
        </div>
      </section>

      <section className="card handoff-op-card">
        <div className="panel-head"><h2>운영시간</h2><span className="handoff-op-dim">기준 Asia/Seoul (KST)</span></div>
        <div className="panel-body">
          <div className="handoff-op-days">
            {HANDOFF_DAY_KEYS.map((day) => {
              const slot = draft.schedule[day];
              return (
                <div className={`handoff-op-day ${slot ? "" : "closed"}`} key={day}>
                  <label className="handoff-op-day-name">
                    <input
                      checked={slot != null}
                      onChange={(event) =>
                        patchDraft({ schedule: { ...draft.schedule, [day]: event.target.checked ? { ...DEFAULT_DAY } : null } })
                      }
                      type="checkbox"
                    />
                    <span>{HANDOFF_DAY_LABELS[day]}</span>
                  </label>
                  {slot ? (
                    <div className="handoff-op-day-times">
                      <input
                        onChange={(event) => patchDraft({ schedule: { ...draft.schedule, [day]: { ...slot, start: event.target.value } } })}
                        type="time"
                        value={slot.start}
                      />
                      <span className="handoff-op-dim">~</span>
                      <input
                        onChange={(event) => patchDraft({ schedule: { ...draft.schedule, [day]: { ...slot, end: event.target.value } } })}
                        type="time"
                        value={slot.end}
                      />
                      {slot.start > slot.end && <span className="handoff-op-day-hint">자정 넘김</span>}
                      {slot.start === slot.end && <span className="handoff-op-day-hint">24시간 운영</span>}
                    </div>
                  ) : (
                    <span className="handoff-op-dim">휴무</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="handoff-op-help">종료 시각 정각부터 연결이 차단됩니다(18:00 설정 시 17:59까지 가능). 시작이 종료보다 늦으면 자정 넘김, 같으면 24시간 운영입니다.</p>
        </div>
      </section>

      <section className="card handoff-op-card">
        <div className="panel-head"><h2>고객 안내 문구</h2></div>
        <div className="panel-body handoff-op-messages">
          <label className="handoff-op-field">
            <span>운영시간 외 안내 <em className="handoff-op-dim">{"{schedule}"} 자리에 운영시간 설명이 자동으로 들어갑니다.</em></span>
            <textarea
              className="textarea"
              onChange={(event) => patchDraft({ outsideHoursMessage: event.target.value })}
              rows={3}
              value={draft.outsideHoursMessage}
            />
          </label>
          <label className="handoff-op-field">
            <span>강제 OFF 안내</span>
            <textarea
              className="textarea"
              onChange={(event) => patchDraft({ forceMessage: event.target.value })}
              rows={3}
              value={draft.forceMessage}
            />
          </label>
          <p className="handoff-op-help">여기서는 원문을 편집합니다 — <code>**굵게**</code> 같은 마크다운 서식은 고객 앱 채팅에서 적용되어 표시됩니다(위 현재 상태의 미리보기가 실제 표시 모습).</p>
        </div>
      </section>

      <section className="card handoff-op-card">
        <div className="panel-head"><h2>저장</h2></div>
        <div className="panel-body handoff-op-save">
          <label className="handoff-op-field">
            <span>변경 사유 <em className="handoff-op-dim">필수 — 변경 이력에 기록됩니다.</em></span>
            <input
              className="input"
              onChange={(event) => { setReason(event.target.value); setSaveError(null); }}
              placeholder="예: 여름 휴가 기간 임시 휴무"
              type="text"
              value={reason}
            />
          </label>
          {saveError && <p className="handoff-op-error" role="alert">{saveError}</p>}
          <div className="handoff-op-save-actions">
            {/* 버튼만 죽어 있으면 고장처럼 읽힌다(#185 NO_HITS와 같은 부류) — 비활성 사유를 화면이 직접 말한다. */}
            {!dirty && !saving && <span className="handoff-op-save-idle">변경된 설정이 없습니다 — 위에서 설정을 바꾸면 저장할 수 있어요.</span>}
            <button className="btn" disabled={!dirty || saving} onClick={() => { setDraft(draftFrom(settings)); setSaveError(null); }} type="button">되돌리기</button>
            <button className="btn primary" disabled={!dirty || saving} onClick={() => void handleSave()} type="button">
              {saving ? "저장 중…" : "설정 저장"}
            </button>
          </div>
        </div>
      </section>
      </div>

      <aside className="handoff-op-side">
      <section className="card handoff-op-card">
        <div className="panel-head">
          <h2>현재 상태</h2>
          {badge && <span className={`handoff-op-badge ${badge.tone}`}>{badge.label}</span>}
        </div>
        <div className="panel-body handoff-op-status">
          {availability ? (
            <>
              <p className="handoff-op-status-line">
                지금 고객 앱에서 상담사 연결이 <strong>{availability.available ? "가능합니다" : "불가능합니다"}</strong>.
                <span className="handoff-op-dim"> 운영시간: {availability.scheduleDescription}</span>
              </p>
              {availability.nextOpenAt && (
                <p className="handoff-op-status-line">다음 상담 가능 시각: <strong>{formatKst(availability.nextOpenAt)}</strong></p>
              )}
              {/* 고객이 앱 채팅에서 볼 실물 미리보기 — 앱이 이 message를 마크다운 렌더(softLineBreak)하므로 원문이 아니라 렌더본을 보여준다. */}
              {availability.message && <blockquote className="handoff-op-quote"><MarkdownMessage content={withAppLineBreaks(availability.message)} /></blockquote>}
            </>
          ) : (
            <p className="handoff-op-dim">판정 결과를 불러오는 중…</p>
          )}
        </div>
      </section>

      <section className="card handoff-op-card">
        <div className="panel-head"><h2>변경 이력</h2><span className="handoff-op-dim">최근 {audits.length}건</span></div>
        <div className="panel-body">
          {audits.length === 0 ? (
            <p className="handoff-op-dim">아직 변경 이력이 없습니다.</p>
          ) : (
            <ul className="handoff-op-audits">
              {audits.map((audit) => (
                <li key={audit.id}>
                  <span className="handoff-op-audit-when">{formatKst(audit.createdAt)}</span>
                  <span className="handoff-op-audit-who">{staffNameById.get(audit.changedBy) ?? "알 수 없음"}</span>
                  <span className="handoff-op-audit-what">{auditSummary(audit.oldValue, audit.newValue)}</span>
                  {audit.reason && <span className="handoff-op-audit-reason">{audit.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      </aside>
    </div>
  );
}
