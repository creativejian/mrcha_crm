// 고객 상세의 상태 필드(직군·거주지·상담경로·담당자) 도메인.
// "표시 문자열 ↔ 구조화 값" 파싱/포맷과 그에 쓰는 옵션 상수·타입을 한곳에 모은다.
// 데이터 소스(DB/mock)와 무관한 순수 변환이라 단위 테스트가 쉽다.

import { SOURCE_AUTOMATIC_OPTIONS, SOURCE_MANUAL_OPTIONS, SOURCE_LEGACY_AUTOMATIC_OPTIONS } from "@/data/customers";

export type CustomerTypeValue = "개인" | "개인사업자" | "법인사업자";
export type AdvisorTeam = "인천본사" | "상담팀" | "견적팀" | "계약팀" | "출고팀";

export const customerTypeOptions: CustomerTypeValue[] = ["개인", "개인사업자", "법인사업자"];
export const automaticSourceOptions = SOURCE_AUTOMATIC_OPTIONS;
const legacyAutomaticSourceOptions = SOURCE_LEGACY_AUTOMATIC_OPTIONS;
export const manualSourceOptions = SOURCE_MANUAL_OPTIONS;
// 팀 어휘(표시 필드로만 잔존 — 팀 개념 없음 확정, 어휘·존폐는 팀 개념 정리 때 재검토).
// 담당자 후보는 GET /api/staff 디렉토리(#177)가 SSOT — 팀별 목업 이름 리스트(구 advisorOptionsByTeam)는
// 배치 F에서 폐기(디렉토리와 이중 소스로 남아 실데이터 오인 표면이었음).
export const ADVISOR_TEAMS: readonly AdvisorTeam[] = ["인천본사", "상담팀", "견적팀", "계약팀", "출고팀"];
export const regionOptions: Record<string, string[]> = {
  "확인 필요": ["확인 필요"],
  서울특별시: ["확인 필요", "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"],
  경기도: ["확인 필요", "수원시", "성남시", "고양시", "용인시", "부천시", "안산시", "안양시", "남양주시", "화성시", "평택시", "의정부시", "시흥시", "파주시", "김포시", "광명시", "광주시", "군포시", "하남시", "오산시", "이천시", "안성시", "구리시", "의왕시", "양주시", "포천시", "여주시", "동두천시", "과천시"],
  인천광역시: ["확인 필요", "중구", "동구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서구", "강화군", "옹진군"],
  대전광역시: ["확인 필요", "동구", "중구", "서구", "유성구", "대덕구"],
  대구광역시: ["확인 필요", "중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군"],
  울산광역시: ["확인 필요", "중구", "남구", "동구", "북구", "울주군"],
  부산광역시: ["확인 필요", "중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구", "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군"],
  광주광역시: ["확인 필요", "동구", "서구", "남구", "북구", "광산구"],
  강원도: ["확인 필요", "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시"],
  충북: ["확인 필요", "청주시", "충주시", "제천시"],
  "충남(세종)": ["확인 필요", "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "세종시"],
  경북: ["확인 필요", "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시"],
  경남: ["확인 필요", "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시"],
  전북: ["확인 필요", "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시"],
  전남: ["확인 필요", "목포시", "여수시", "순천시", "나주시", "광양시"],
  제주: ["확인 필요", "제주시", "서귀포시"],
};

// --- 직군 ---

export function parseJobValue(value: string): { type: CustomerTypeValue; detail: string } {
  const [typeValue, detailValue] = value.split("·").map((part) => part.trim());
  const type = customerTypeOptions.includes(typeValue as CustomerTypeValue) ? typeValue as CustomerTypeValue : "개인";
  const fallbackDetail = type === "개인" ? "4대보험" : "";
  return { type, detail: detailValue || fallbackDetail };
}

export function formatJobValue(type: CustomerTypeValue, detail: string) {
  const normalizedDetail = detail.trim() || (type === "개인" ? "4대보험" : "미입력");
  return `${type} · ${normalizedDetail}`;
}

// --- 거주지 ---

export function parseLocationValue(value: string) {
  const [provinceValue, detailValue] = value.split("·").map((part) => part.trim());
  const province = regionOptions[provinceValue] ? provinceValue : "확인 필요";
  const detailOptions = regionOptions[province];
  const detail = detailOptions.includes(detailValue) ? detailValue : "확인 필요";
  return { province, detail };
}

export function formatLocationValue(province: string, detail: string) {
  if (province === "확인 필요") return "확인 필요";
  if (!detail || detail === "확인 필요") return province;
  return `${province} · ${detail}`;
}

// --- 상담경로 ---

export function parseSourceValue(value: string): string {
  const allOptions = [...automaticSourceOptions, ...manualSourceOptions];
  if (allOptions.includes(value)) return value;
  if (legacyAutomaticSourceOptions.includes(value)) return "디엘(상담)";
  return "기타";
}

export function isAutomaticSource(value: string) {
  return automaticSourceOptions.includes(value) || legacyAutomaticSourceOptions.includes(value);
}

export function hasAppSourceQueue(value: string) {
  return value.includes("앱");
}

// --- 담당자 ---

// "이름 · 팀" 표시 문자열에서 팀만 해석 — 이름 해석은 디렉토리(id 매칭·이름 폴백, AdvisorStatusEditor)가
// 담당한다. 구 parseAdvisorValue의 advisor 절반은 목업 리스트 강제 폴백(프로덕션 소비처 0인 dead —
// 소비되는 순간 임의 담당자 오배정 함정)이라 배치 F에서 제거.
export function parseAdvisorTeam(value: string): AdvisorTeam {
  const teamValue = value.split("·").map((part) => part.trim())[1];
  return ADVISOR_TEAMS.includes(teamValue as AdvisorTeam) ? (teamValue as AdvisorTeam) : "인천본사";
}

export function formatAdvisorValue(team: AdvisorTeam, advisor: string) {
  if (!advisor || advisor === "미배정") return "미배정";
  return `${advisor} · ${team}`;
}
