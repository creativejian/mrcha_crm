// 차량 관리(/mc-master) URL 문법 — 선택 브랜드를 URL(?brand=)이 single source로 들고,
// 트림 뷰(/mc-master/:modelId)에도 그대로 물고 다닌다. 앱 admin(/admin/vehicles?brand=17)과
// 같은 문법이라 딥링크·새로고침·뒤로가기가 살아나고, 트림 뷰를 새로고침해도 사이드바가
// 맞는 브랜드를 잡는다(모델→브랜드 역인덱스는 모델 캐시가 채워져야 생기는 값이라 공백일 수 있다).
// 고객 목록(lib/customer-route.ts)의 mode(?view=)와 같은 패턴.

// URL의 brand를 브랜드 id로 파싱한다. 없거나 양의 정수가 아니면 null(=폴백 체인으로).
export function brandIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("brand");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// 차량 관리 URL 조립 — 모델 목록/트림 뷰 어느 쪽이든 현재 브랜드를 잃지 않는다.
export function mcMasterPath(brandId: number | null, modelId?: string | number): string {
  const path = modelId == null ? "/mc-master" : `/mc-master/${modelId}`;
  return brandId == null ? path : `${path}?brand=${brandId}`;
}

// 하이라이트 딥링크(?hl=trimId) — 딜러 명부 "보기" 팝오버 → 트림 뷰 착지 마킹(2026-07-29 유슨생).
// brand 파서와 같은 규칙: 없거나 양의 정수가 아니면 null.
export function highlightTrimIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("hl");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
