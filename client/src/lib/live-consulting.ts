import { getJson, sendJson } from "./http";

// 실시간 상담 수신 On/Off — 로그인 상담사 자기 상태. crm.staff_settings 영속(GET/PATCH /api/me/live-consulting).
export async function fetchLiveConsulting(): Promise<boolean> {
  const { receiving } = await getJson<{ receiving: boolean }>("/api/me/live-consulting");
  return receiving;
}

export async function saveLiveConsulting(receiving: boolean): Promise<boolean> {
  const res = await sendJson<{ receiving: boolean }>("/api/me/live-consulting", "PATCH", { receiving });
  return res.receiving;
}
