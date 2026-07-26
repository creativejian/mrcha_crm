// 차량 관리(/mc-master) 화면 상태 — 라우트 언마운트를 넘겨 살아남아야 하는 것들.
//
// 왜 모듈 스코프인가: 이 화면은 라우트별 element라 다른 메뉴로 나갔다 오면 컴포넌트가
// 통째로 새로 만들어진다. useRef/useState는 그때 0으로 돌아가므로, 앱(Flutter) admin이
// `static double _savedScrollOffset`으로 해결한 자리를 React에서는 모듈 스코프가 맡는다
// (vehicle_list_screen.dart / vehicle_list/brand_panel.dart와 동형).
//
// brandId는 URL(?brand=)이 single source지만(mc-master-route.ts), Topbar 메뉴는 쿼리 없는
// /mc-master를 열기 때문에 그 경로로 재진입할 때 마지막 선택을 되살릴 폴백이 필요하다.
// 새로고침하면 초기화된다(스크롤은 앱 static도 마찬가지, 브랜드는 URL이 살린다).
export const mcMasterViewState = {
  brandId: null as number | null,
  modelScrollTop: 0,
  brandScrollTop: 0,
  // 트림 목록은 모델별로 따로 기억한다 — 단일 값이면 5 Series를 중간까지 보다 나간 뒤
  // 3 Series에 들어갔을 때 엉뚱한 위치에서 시작한다. 키는 URL의 modelId 문자열.
  trimScrollTop: new Map<string, number>(),
};
