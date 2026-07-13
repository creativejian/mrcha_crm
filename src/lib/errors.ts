// 도메인 충돌 에러(요청 자체는 유효하나 현재 데이터 상태와 양립 불가) — 라우트 공통 run()이 409로 매핑한다.
// 쿼리 계층이 던지고 상태코드 변환은 라우트 계층 책임 — 계층 역전 없이 공유하려고 lib에 둔다.
export class ConflictError extends Error {}

// 앱 계정 연결(정방향) 충돌 전용 — 충돌 상대 고객 식별을 구조화 동봉해 클라가 메시지 파싱 없이
// "그 고객으로 이동" 안내를 만들 수 있게 한다(이사님 2026-07-13 ②: 차단 유지 + 이유·경로 안내).
// 역방향(대상 고객이 다른 앱 계정에 연결됨)은 이동할 고객이 없어 일반 ConflictError를 유지한다.
export class LinkConflictError extends ConflictError {
  constructor(
    message: string,
    readonly conflict: { customerCode: string; name: string },
  ) {
    super(message);
  }
}
