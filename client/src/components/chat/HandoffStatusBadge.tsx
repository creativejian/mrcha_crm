import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { availabilityBadge, fetchHandoffAvailability, subscribeHandoffSettings, type HandoffAvailability } from "@/lib/handoff-settings";

// 상담 콘솔 전역 운영 상태 배지(앱 이슈 #582 — 상담사 화면 표시 몫).
// 판정은 시각 의존이라 설정 변경 Realtime만으로는 부족하다 — 운영시간 경계(예: 18:00) 통과를
// 화면 갱신 없이 반영하려고 60s 인터벌로도 재판정한다(판정 RPC는 읽기 전용·경량).
const REFRESH_MS = 60_000;

type HandoffStatusBadgeProps = { canManage: boolean };

export function HandoffStatusBadge({ canManage }: HandoffStatusBadgeProps) {
  const navigate = useNavigate();
  const [availability, setAvailability] = useState<HandoffAvailability | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      fetchHandoffAvailability()
        .then((next) => {
          if (!disposed) setAvailability(next);
        })
        .catch(() => {
          // 판정 실패 = 배지 숨김(fail-open 표시) — 상담 콘솔 본기능(큐/스레드)에 영향 주지 않는다.
          if (!disposed) setAvailability(null);
        });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const unsubscribe = subscribeHandoffSettings(refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  if (!availability) return null;
  const badge = availabilityBadge(availability);
  if (!canManage) return <span className={`handoff-op-badge ${badge.tone} chat-handoff-badge`}>{badge.label}</span>;
  return (
    <button
      className={`handoff-op-badge ${badge.tone} chat-handoff-badge`}
      onClick={() => navigate("/handoff-operation")}
      title="상담 운영 설정 열기"
      type="button"
    >
      {badge.label}
    </button>
  );
}
