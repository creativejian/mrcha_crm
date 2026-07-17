// 고객 전화번호 소유권 분리(2026-07-17 spec)의 순수 계층.
// - 앱 번호 = profiles.phone_number 파생(저장 안 함) / crm.customers.phone = 앱 미연결 고객의 주 번호만.
// - 불변식: app_user_id IS NOT NULL → phone IS NULL (DB CHECK customers_phone_app_exclusive_check).
// spec = ref/specs/2026-07-17-crm-customer-phone-ownership-design.md

/** 숫자만 남긴다. 숫자가 하나도 없으면 null(빈 문자열·기호만·null·undefined 전부). */
export function normalizePhoneDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits || null;
}

export type PhoneOnLinkInput = {
  /** 연결 전 고객의 crm phone(수기 입력 스냅샷). */
  currentPhone: string | null;
  /** 연결 전 고객의 추가 연락처. */
  currentSecondary: string | null;
  /** 연결되는 앱 계정의 profiles.phone_number(과거 테스트 계정은 null 가능). */
  appPhone: string | null;
};

export type PhoneOnLinkResult = {
  /** 항상 null — 연결 고객의 주 번호는 profiles 파생이 담당한다(불변식). */
  phone: null;
  phoneSecondary: string | null;
  /** secondary가 다른 값으로 이미 차 있어 옮기지 못한 기존 phone(클라 토스트 표면화 — 무음 유실 방지). */
  droppedPhone: string | null;
};

/**
 * 앱 계정 연결 시 기존 phone 전이(spec §3-4).
 * 앱 번호와 같으면 버리고(중복 — phone 매칭 연결이 정확히 이 경로), 다르면 secondary로 보존한다.
 * secondary가 다른 값으로 점유돼 있으면 연결은 막지 않되 droppedPhone으로 알린다(v1 알림, 선택 UI 후속).
 * 비교는 전부 정규화(digits) 기준 — 하이픈 유입 전환기 호환.
 */
export function resolvePhoneOnLink(input: PhoneOnLinkInput): PhoneOnLinkResult {
  const current = normalizePhoneDigits(input.currentPhone);
  const secondary = input.currentSecondary;
  if (!current) return { phone: null, phoneSecondary: secondary, droppedPhone: null };
  if (current === normalizePhoneDigits(input.appPhone)) {
    return { phone: null, phoneSecondary: secondary, droppedPhone: null };
  }
  const secondaryDigits = normalizePhoneDigits(secondary);
  if (!secondaryDigits) return { phone: null, phoneSecondary: current, droppedPhone: null };
  if (secondaryDigits === current) return { phone: null, phoneSecondary: secondary, droppedPhone: null };
  return { phone: null, phoneSecondary: secondary, droppedPhone: current };
}
