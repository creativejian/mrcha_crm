// 김민준 고객 상세의 상태 필드(직군·거주지·상담경로·담당자) 도메인.
// "표시 문자열 ↔ 구조화 값" 파싱/포맷과 그에 쓰는 옵션 상수·타입을 한곳에 모은다.
// 데이터 소스(DB/mock)와 무관한 순수 변환이라 단위 테스트가 쉽다.

import { SOURCE_AUTOMATIC_OPTIONS, SOURCE_MANUAL_OPTIONS, SOURCE_LEGACY_AUTOMATIC_OPTIONS } from "@/data/customers";

export type KimCustomerType = "개인" | "개인사업자" | "법인사업자";
export type KimAdvisorTeam = "인천본사" | "상담팀" | "견적팀" | "계약팀" | "출고팀";

export const kimCustomerTypeOptions: KimCustomerType[] = ["개인", "개인사업자", "법인사업자"];
export const kimAutomaticSourceOptions = SOURCE_AUTOMATIC_OPTIONS;
export const kimLegacyAutomaticSourceOptions = SOURCE_LEGACY_AUTOMATIC_OPTIONS;
export const kimManualSourceOptions = SOURCE_MANUAL_OPTIONS;
export const kimAdvisorOptions: Record<KimAdvisorTeam, string[]> = {
  인천본사: ["김지안", "이주선"],
  상담팀: ["이주선", "김지안", "문태호"],
  견적팀: ["이건수", "김지안"],
  계약팀: ["김지안", "이주선"],
  출고팀: ["한지훈", "김지안"],
};
export const kimRegionOptions: Record<string, string[]> = {
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

export function parseKimJobValue(value: string): { type: KimCustomerType; detail: string } {
  const [typeValue, detailValue] = value.split("·").map((part) => part.trim());
  const type = kimCustomerTypeOptions.includes(typeValue as KimCustomerType) ? typeValue as KimCustomerType : "개인";
  const fallbackDetail = type === "개인" ? "4대보험" : "";
  return { type, detail: detailValue || fallbackDetail };
}

export function formatKimJobValue(type: KimCustomerType, detail: string) {
  const normalizedDetail = detail.trim() || (type === "개인" ? "4대보험" : "미입력");
  return `${type} · ${normalizedDetail}`;
}

// --- 거주지 ---

export function parseKimLocationValue(value: string) {
  const [provinceValue, detailValue] = value.split("·").map((part) => part.trim());
  const province = kimRegionOptions[provinceValue] ? provinceValue : "확인 필요";
  const detailOptions = kimRegionOptions[province];
  const detail = detailOptions.includes(detailValue) ? detailValue : "확인 필요";
  return { province, detail };
}

export function formatKimLocationValue(province: string, detail: string) {
  if (province === "확인 필요") return "확인 필요";
  if (!detail || detail === "확인 필요") return province;
  return `${province} · ${detail}`;
}

// --- 상담경로 ---

export function parseKimSourceValue(value: string) {
  const allOptions = [...kimAutomaticSourceOptions, ...kimManualSourceOptions];
  if (allOptions.includes(value)) return { selected: value, custom: "" };
  if (value === "디엘홈페이지") return { selected: "디엘(상담)", custom: "" };
  return { selected: "기타", custom: value };
}

export function isKimAutomaticSource(value: string) {
  return kimAutomaticSourceOptions.includes(value) || kimLegacyAutomaticSourceOptions.includes(value);
}

export function hasKimAppSourceQueue(value: string) {
  return value.includes("앱");
}

export function hasKimQuoteAttachments(value: string) {
  return value === "디엘(견적서)";
}

// --- 담당자 ---

export function parseKimAdvisorValue(value: string): { team: KimAdvisorTeam; advisor: string } {
  const [advisorValue, teamValue] = value.split("·").map((part) => part.trim());
  const fallbackTeam: KimAdvisorTeam = "인천본사";
  const team = kimAdvisorOptions[teamValue as KimAdvisorTeam] ? teamValue as KimAdvisorTeam : fallbackTeam;
  const advisors = kimAdvisorOptions[team];
  const advisor = advisors.includes(advisorValue) ? advisorValue : advisors[0];
  return { team, advisor };
}

export function formatKimAdvisorValue(team: KimAdvisorTeam, advisor: string) {
  if (!advisor || advisor === "미배정") return "미배정";
  return `${advisor} · ${team}`;
}
