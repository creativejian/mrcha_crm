// 도메인 충돌 에러(요청 자체는 유효하나 현재 데이터 상태와 양립 불가) — 라우트 공통 run()이 409로 매핑한다.
// 쿼리 계층이 던지고 상태코드 변환은 라우트 계층 책임 — 계층 역전 없이 공유하려고 lib에 둔다.
export class ConflictError extends Error {}
