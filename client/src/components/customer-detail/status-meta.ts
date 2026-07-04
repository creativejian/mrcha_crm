// 상태+워크플로우 영역의 순수 메타/헬퍼. 훅(useCustomerWorkflow)과 컴포넌트(StatusWorkflow)가 공유한다.
// (본체 CustomerDetailPage에서 추출 — 동작/값 무변경. lucide 아이콘 참조는 값일 뿐이라 .ts에 둬도 무방.)
import { BriefcaseBusiness, CalendarClock, MapPin, Phone, Route, UserRound } from "lucide-react";

import { type CustomerChanceOption } from "@/data/customers";

import { type StatusFieldKey, type WorkflowKey } from "./types";

export const statusFieldMeta = [
  { key: "phone", label: "연락처", icon: Phone },
  { key: "job", label: "직군", icon: BriefcaseBusiness },
  { key: "location", label: "거주지", icon: MapPin },
  { key: "source", label: "상담경로", icon: Route },
  { key: "advisor", label: "담당자", icon: UserRound },
  { key: "assignedAt", label: "배정시간", icon: CalendarClock },
] satisfies { key: StatusFieldKey; label: string; icon: typeof Phone }[];

export const workflowMeta = [
  { key: "stage", label: "진행 상태", tone: "stage" },
  { key: "chance", label: "계약 가능성", tone: "chance" },
  { key: "manage", label: "관리 상태", tone: "normal" },
] satisfies { key: WorkflowKey; label: string; tone: string }[];

export function fieldLabel(key: StatusFieldKey) {
  return statusFieldMeta.find((field) => field.key === key)?.label ?? "항목";
}

export function kimChanceOptionClass(option: CustomerChanceOption, selected: boolean) {
  const toneByChance: Record<CustomerChanceOption, string> = {
    높음: "chance-purple",
    중간: "chance-neutral",
    낮음: "chance-red",
    보류: "chance-yellow",
    확정: "chance-green",
  };
  return ["kim-chance-option", toneByChance[option], selected ? "active" : ""].filter(Boolean).join(" ");
}

export function kimChanceValueClass(option: CustomerChanceOption) {
  const toneByChance: Record<CustomerChanceOption, string> = {
    높음: "chance-purple",
    중간: "chance-neutral",
    낮음: "chance-red",
    보류: "chance-yellow",
    확정: "chance-green",
  };
  return `kim-chance-value ${toneByChance[option]}`;
}

export function isKimUnassignedStatus(key: StatusFieldKey, value: string) {
  return (key === "advisor" || key === "assignedAt") && value === "미배정";
}
