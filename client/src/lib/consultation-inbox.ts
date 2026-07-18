// 상담 신청 DB 인박스 — 유저별 그룹핑 + 기존 고객 매칭 파생(순수 계층).
// 매칭은 서버가 아니라 클라 파생: GET /api/consultations는 매칭 필드가 없고(서버 변경 0 원칙),
// App이 이미 전체 고객 목록을 들고 있어 견적요청 인박스의 매칭 의미론(app_user > phone)을
// 그대로 재현할 수 있다. 서버 매칭이 필요해지면 quote-requests.ts buildAppQuoteRequestRows 미러로 이관.
import type { Customer } from "@/data/customers";
import type { AppConsultationRow } from "./consultations";
import { sanitizePhoneDigits } from "./customer-create";
import { formatActivity, formatPhone } from "./customers";

export type ConsultationMatchType = "app_user" | "phone" | "none";

// 펼침 영역의 개별 상담 1건(읽기 전용 — 고객 상세 상담신청 카드 어휘 미러).
// 외부 도달은 ConsultationInboxGroup.items 요소 타입으로 충분해 비공개(배치 8 D#2 — knip unused type).
type ConsultationInboxItem = {
  id: string;
  dateLabel: string;
  carModel: string | null;
  notes: string | null;
};

// 인박스 1행 = 앱 유저 1명(상담 건별 83행은 noisy — 유슨생 확정).
export type ConsultationInboxGroup = {
  key: string;
  userId: string | null;
  name: string; // 최신 상담 폼 customer_name(폼 최신값 우선)
  phoneLabel: string; // 최신 phone_number의 하이픈 표시 포맷
  count: number;
  latestDateLabel: string;
  // 최신 것부터 찾은 비어있지 않은 notes — 최신 건이 차종만 있고 notes가 없을 때 37건 그룹의
  // 미리보기 칸이 통째로 비어 "고장"처럼 읽히는 것 방지(칸은 그룹 대표 미리보기라 날짜 결합 없음).
  previewNotes: string | null;
  latestConsultationId: string; // link/create-customer 액션 대상(서버 라우트가 상담 id 단위)
  items: ConsultationInboxItem[]; // 개별 상담, 최신순
  // link/create 라우트 모두 상담의 userId가 필수(없으면 서버가 404) — 비로그인 행은 액션 숨김.
  canPromote: boolean;
  matchType: ConsultationMatchType;
  matchLabel: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  // none일 때만 채우는 같은 이름 미연결 고객 후보(예방용 제안 — 자동 연결 아님). 그 외 매칭은 빈 배열.
  nameMatches: MatchedCustomer[];
};

type MatchedCustomer = { id: string; name: string; code: string };

function createdAtMs(row: AppConsultationRow): number {
  const t = Date.parse(row.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

// 이름 매칭 정규화 — 앞뒤/중복 공백 접기 + 소문자. digits(phone)와 별개(spec §3).
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// 매칭 라벨 — 견적요청 인박스(quote-requests.ts toAppQuoteRequest)와 같은 어휘.
function matchLabelOf(matchType: ConsultationMatchType, matched: MatchedCustomer | null): string {
  if (matchType === "app_user") return `연결됨 ${matched?.name ?? ""}`.trim();
  if (matchType === "phone") return matched?.name ? `기존 고객 ${matched.name}(추정)` : "기존 고객(추정)";
  return "신규(미연결)";
}

export function buildConsultationInboxGroups(
  rows: readonly AppConsultationRow[],
  customers: readonly Customer[],
): ConsultationInboxGroup[] {
  // 매칭 후보 인덱스 — id 없는 행(프로토타입 목업)은 link 대상이 될 수 없어 제외.
  // 같은 키 고객이 여럿이면 첫 고객(표시용 read — findPhoneDuplicate의 first-wins와 동일 규칙).
  const byAppUser = new Map<string, MatchedCustomer>();
  const byPhone = new Map<string, MatchedCustomer>();
  const byNameUnlinked = new Map<string, MatchedCustomer[]>();
  for (const c of customers) {
    if (!c.id) continue;
    const entry: MatchedCustomer = { id: c.id, name: c.name, code: c.customerId };
    if (c.appUserId && !byAppUser.has(c.appUserId)) byAppUser.set(c.appUserId, entry);
    // phone 매칭 후보 = 앱 미연결 고객만(2026-07-17 spec §3-6). 연결 고객의 표시 phone은 서버 합성
    // **앱 번호**라 여기 넣으면 가족 공유 번호의 다른 유저가 이미 연결된 고객으로 오매칭된다
    // (그 고객은 app_user_id로 이미 확정 매칭 — phone 후보일 이유가 없다). 추가 연락처도 매칭 제외.
    if (c.appUserId) continue;
    const nameKey = normalizeName(c.name);
    if (nameKey) {
      const list = byNameUnlinked.get(nameKey) ?? [];
      list.push(entry);
      byNameUnlinked.set(nameKey, list);
    }
    const digits = sanitizePhoneDigits(c.phone);
    if (digits && !byPhone.has(digits)) byPhone.set(digits, entry);
  }

  // 유저별 그룹핑(최신순 정렬 후 push — 그룹 내 항목도 자동으로 최신순).
  const sorted = [...rows].sort((a, b) => createdAtMs(b) - createdAtMs(a));
  const groups = new Map<string, AppConsultationRow[]>();
  for (const row of sorted) {
    const key = row.userId ?? `phone:${row.phoneNumber}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  // Map 삽입 순서 = 최신 상담 desc(정렬된 rows를 순회하며 삽입) — 그룹 정렬 별도 불필요.
  return [...groups.entries()].map(([key, bucket]) => {
    const latest = bucket[0];
    const digits = sanitizePhoneDigits(latest.phoneNumber);
    const byApp = latest.userId ? byAppUser.get(latest.userId) : undefined;
    const matched = byApp ?? (digits ? byPhone.get(digits) : undefined) ?? null;
    const matchType: ConsultationMatchType = byApp ? "app_user" : matched ? "phone" : "none";
    return {
      key,
      userId: latest.userId,
      name: latest.customerName,
      phoneLabel: formatPhone(latest.phoneNumber),
      count: bucket.length,
      latestDateLabel: formatActivity(latest.createdAt),
      previewNotes: bucket.find((r) => r.notes?.trim())?.notes ?? null,
      latestConsultationId: latest.id,
      items: bucket.map((r) => ({ id: r.id, dateLabel: formatActivity(r.createdAt), carModel: r.carModel, notes: r.notes })),
      canPromote: latest.userId != null,
      matchType,
      matchLabel: matchLabelOf(matchType, matched),
      matchedCustomerId: matched?.id ?? null,
      matchedCustomerName: matched?.name ?? null,
      matchedCustomerCode: matched?.code ?? null,
      nameMatches:
        matchType === "none"
          ? (byNameUnlinked.get(normalizeName(latest.customerName)) ?? [])
              .slice()
              .sort((a, b) => a.code.localeCompare(b.code))
          : [],
    };
  });
}
