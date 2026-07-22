// AI 힌트(고객 목록 hover 한 줄) — 순수 조립/후처리 계층. 재료 로드는 db/queries/ai-hint-sources,
// 생성 오케스트레이션은 lib/ai-hint-on-write, 클라 파서는 client/src/lib/customer-table.ts.
// 스펙: ref/specs/2026-07-12-crm-ai-hint-datafication-design.md (목업 20문장 역설계 — 단계별 관점).

import { createHash } from "node:crypto";

export type AiHintMaterialInput = {
  name: string;
  statusGroup: string | null;
  status: string | null;
  chance: string | null;
  priority: string | null;
  profileText: string; // buildCustomerProfileChunkText 결과(빈 문자열 = 프로필 재료 없음)
  memos: { body: string }[]; // 최근순 상위 N
  tasks: { category: string | null; due: string | null; body: string | null }[]; // 미완료 최근순 상위 N
  quote: { modelName: string | null; trimName: string | null; appStatus: string | null } | null; // 최신 1건
  consultationNote: string | null; // 앱 상담신청 최신 문의(dismissed 제외)
};

const CLIP_CHARS = 200;

function clip(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > CLIP_CHARS ? `${s.slice(0, CLIP_CHARS)}…` : s;
}

// 재료 전무(프로필·메모·할일·견적·상담 없음) → null = 힌트 클리어 신호(runAiHintJob이 ai_summary NULL 저장).
// 이름/진행 상태만으로 문장을 만들면 "신규 고객" 같은 무의미 힌트가 생겨 빈 말풍선보다 나쁘다.
export function buildAiHintMaterial(src: AiHintMaterialInput): string | null {
  const memoLines = src.memos.map((m) => m.body.trim()).filter(Boolean).map((b) => `- ${clip(b)}`);
  const taskLines = src.tasks
    .map((t) => [t.category, t.due, t.body].map((v) => v?.trim()).filter(Boolean).join(" · "))
    .filter(Boolean)
    .map((line) => `- ${clip(line)}`);
  const quoteLine = src.quote
    ? `최신 견적: ${[src.quote.modelName, src.quote.trimName].filter(Boolean).join(" ") || "차종 미정"} — ${src.quote.appStatus === "sent" ? "발송완료" : "작성 중"}`
    : null;
  const consultation = src.consultationNote?.trim() ? `앱 상담 문의: ${clip(src.consultationNote)}` : null;
  if (!src.profileText && memoLines.length === 0 && taskLines.length === 0 && !quoteLine && !consultation) return null;

  const progress = [src.statusGroup, src.status].filter(Boolean).join("·");
  const statusLine = [
    progress ? `진행 ${progress}` : null,
    src.chance ? `계약 가능성 ${src.chance}` : null,
    src.priority ? `우선순위 ${src.priority}` : null,
  ].filter(Boolean).join(" · ");

  return [
    `고객 ${src.name}`,
    statusLine || null,
    src.profileText ? `프로필: ${src.profileText}` : null,
    memoLines.length ? `최근 메모:\n${memoLines.join("\n")}` : null,
    taskLines.length ? `미완료 할 일:\n${taskLines.join("\n")}` : null,
    quoteLine,
    consultation,
  ].filter(Boolean).join("\n");
}

// 목업 역설계 스펙(설계 노트 결정 1) — 단계별 관점 + few-shot은 이사님 5/19 문장 원형.
export const AI_HINT_SYSTEM_PROMPT = [
  "당신은 자동차 리스·렌트·할부 CRM의 상담 보조 AI다. 고객 데이터를 읽고 상담사가 목록에서 한눈에 참고할 \"AI 힌트\" 한 문장을 만든다.",
  "",
  "규칙:",
  "- 한국어 1문장, 60자 내외(최대 90자). 줄바꿈 금지.",
  "- 형식: 무엇을 원하는가 + 무엇에 민감한가 + (필요 시) 지금 우선할 것.",
  "- 핵심어는 **굵게** 최대 2곳까지만 표시한다(3곳 이상 금지). 마크다운은 ** 만 허용, 다른 서식 금지.",
  "- 평서 압축형으로 끝맺는다(…함 / …필요 / …민감 / …만 남음). 명령형·경어체 종결(…하십시오 / …할 것 / …하세요) 금지 — 상담사에게 지시하는 문장이 아니라 고객을 읽는 요약이다.",
  "- 진행 단계별 관점: 상담/견적 단계=니즈+민감 포인트, 심사 단계=리스크+선결 조건, 계약완료/출고=잔여 작업, 보류/이탈=이탈 사유+재접근 명분.",
  "- 데이터에 없는 사실을 지어내지 않는다. 재료가 빈약하면 있는 것만으로 짧게 쓴다.",
  "- 존칭·인사·설명·따옴표 없이 힌트 문장만 출력한다.",
  "",
  "예시:",
  "- **X3 · GLC**를 비교 중이며 **중도해지, 월 납입액, 총비용** 차이에 민감",
  "- **사업자 증빙**이 약해 **승인 금융사**를 먼저 좁혀야 함",
  "- **계약 확정** 건으로 **출고 안내, 법인 서류**만 남음",
  "- **가족 반대**로 취소되어 **재컨택 명분** 정리가 필요",
].join("\n");

// 모델 출력 방어: 첫 비공백 줄만 취해 1문장 계약을 코드로 보증. ** 짝이 안 맞으면 깨진 마크다운이
// 말풍선에 그대로 노출되므로 서식을 통째로 벗긴다. 빈 문자열 반환 = 저장하지 않음(호출부 fail-open).
export function sanitizeAiHint(raw: string): string {
  const line = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let hint = line
    .replace(/^[-*•]\s+/, "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if ((hint.match(/\*\*/g) ?? []).length % 2 !== 0) hint = hint.replaceAll("**", "");
  return hint;
}

// AI 힌트 재료 스냅샷 해시 — `customers.ai_summary_source_hash`에 저장돼 "재료가 그대로면 Gemini를 다시
// 부르지 않는다"를 판정한다(`ai-hint-on-write.ts`). **재료 바이트 외에는 아무것도 섞지 않는다.**
//
// ⚠️ 임베딩용 `embeddingContentHash`를 재사용하지 말 것(배치 14 K1-a로 분리). 그 해시는 임베딩 모델명을
// salt로 섞는데, 힌트는 임베딩과 무관한 도메인이라 **모델 상수 교체 한 줄이 전 고객 힌트를 무효화**한다
// (`#312`에서 실제로 발생 — 22/22 고객이 구 스킴 해시를 든 채 재생성 대기 상태였고, 발화했다면
// flash-lite 22콜 + 힌트 문구 22건 무음 churn이었다).
// 역으로 **프롬프트·생성 모델을 바꿔도 이 해시는 변하지 않는다** — 그건 의도된 선재 속성이고,
// 그때는 "프롬프트 수정 → hash 클리어 → 백필 재실행" 수동 절차를 쓴다(스펙 2026-07-12).
export function aiHintSourceHash(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}
