import type { Customer } from "@/data/customers";

// 제출용 전화번호 — DB는 숫자만 저장한다(lib/customers.ts formatPhone 주석의 계약).
export function sanitizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

// 연락처 중복 소프트 경고 — 목록(이미 클라에 전체 로드)에서 같은 번호 첫 고객을 찾는다.
// 등록을 막지 않는다(가족 공유 번호·법인 대표번호 등 실무 예외 — spec 확정 결정 3).
// 숫자 10자리 미만은 null: 타이핑 중 접두 일치로 조기 경고가 뜨는 것 방지.
export function findPhoneDuplicate(
  customers: readonly Pick<Customer, "name" | "customerId" | "phone">[],
  phone: string,
): { name: string; customerId: string } | null {
  const digits = sanitizePhoneDigits(phone);
  if (digits.length < 10) return null;
  const hit = customers.find((c) => sanitizePhoneDigits(c.phone) === digits);
  return hit ? { name: hit.name, customerId: hit.customerId } : null;
}
