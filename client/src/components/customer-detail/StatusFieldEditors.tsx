import { useState, type SyntheticEvent } from "react";

import { formatLocalPhone, localPhoneFrom } from "@/lib/detail-utils";
import { useStaffDirectory } from "@/lib/staff";
import {
  type CustomerTypeValue,
  advisorOptionsByTeam,
  automaticSourceOptions,
  customerTypeOptions,
  manualSourceOptions,
  regionOptions,
  parseAdvisorValue,
  parseJobValue,
  parseLocationValue,
  parseSourceValue,
} from "@/lib/status-fields";

// 직군 상세분류 옵션(개인일 때). 본체에서 이동 — 값 무변경.
const personalJobDetailOptions = ["4대보험", "프리랜서", "무직", "주부", "기타"];

export function PhoneStatusInput({ initialValue }: { initialValue: string }) {
  // 010은 고정 prefix. 입력값은 뒤 8자리(4-4)만 다룬다. 폼 제출 시 name="value"=8자리, 저장 핸들러가 010 prepend.
  const [value, setValue] = useState(() => localPhoneFrom(initialValue));

  return (
    <div className="kim-phone-input">
      <span className="kim-phone-prefix" aria-hidden="true">010</span>
      <input
        aria-label="연락처 수정"
        autoComplete="tel"
        autoFocus
        inputMode="numeric"
        maxLength={9}
        name="value"
        onChange={(event) => setValue(formatLocalPhone(event.currentTarget.value))}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        placeholder="0000-0000"
        type="tel"
        value={value}
      />
    </div>
  );
}

export function JobStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const initialJob = parseJobValue(initialValue);
  const [customerType, setCustomerType] = useState<CustomerTypeValue>(initialJob.type);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>직군 분류</span>
        <select
          autoFocus
          defaultValue={initialJob.type}
          name="customerType"
          onChange={(event) => setCustomerType(event.currentTarget.value as CustomerTypeValue)}
        >
          {customerTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      {customerType === "개인" ? (
        <label>
          <span>상세 분류</span>
          <select defaultValue={personalJobDetailOptions.includes(initialJob.detail) ? initialJob.detail : "4대보험"} name="customerTypeDetail">
            {personalJobDetailOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ) : (
        <label>
          <span>{customerType === "개인사업자" ? "사업자명" : "법인명"}</span>
          <input defaultValue={initialJob.type === customerType ? initialJob.detail : ""} name="customerTypeDetail" placeholder={customerType === "개인사업자" ? "예: 도윤컴퍼니" : "예: HJ모빌리티"} />
        </label>
      )}
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

export function LocationStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const initialLocation = parseLocationValue(initialValue);
  const [province, setProvince] = useState(initialLocation.province);
  const detailOptions = regionOptions[province] ?? regionOptions["확인 필요"];
  const detailValue = detailOptions.includes(initialLocation.detail) ? initialLocation.detail : "확인 필요";

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>거주지 수정</span>
        <select
          autoFocus
          defaultValue={initialLocation.province}
          name="province"
          onChange={(event) => setProvince(event.currentTarget.value)}
        >
          {Object.keys(regionOptions).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>구/시 선택</span>
        <select key={province} defaultValue={detailValue} name="detail">
          {detailOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

export function SourceStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const initialSource = parseSourceValue(initialValue);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>상담경로 수정</span>
        <select autoFocus defaultValue={initialSource} name="source">
          <optgroup label="자동 접수">
            {automaticSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
          <optgroup label="수동 접수">
            {manualSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

export function AdvisorStatusEditor({
  initialValue,
  initialAdvisorId,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  initialAdvisorId: string | null;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  // 담당자 후보 = 직원 디렉토리(profiles CRM 역할) — ADVISOR_NAMES 목업 폐기(팀별 담당자 필터도
  // 함께 폐기 — 팀 개념 없음 확정, 팀 select는 표시 필드로만 잔존). 배정 저장은 select 값(advisorId)을
  // 동봉해야 역할 scope가 성립한다(#176). 초기 선택은 id 매칭 우선, 백필 전 데이터(이름만)는 이름 폴백.
  const initialTeam = parseAdvisorValue(initialValue).team;
  const { staff, loading } = useStaffDirectory();
  const displayName = initialValue.split("·")[0]?.trim();
  const selected = staff.find((s) => s.id === initialAdvisorId) ?? staff.find((s) => s.name === displayName);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>팀 선택</span>
        <select autoFocus defaultValue={initialTeam} name="team">
          {Object.keys(advisorOptionsByTeam).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>담당자 선택</span>
        {/* key: 디렉토리 도착 시 리마운트 — uncontrolled defaultValue를 로드 후 값으로 다시 시드(Safari 안전) */}
        <select key={staff.length ? "ready" : "empty"} defaultValue={selected?.id ?? staff[0]?.id ?? ""} disabled={!staff.length} name="advisorId">
          {staff.length
            ? staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
            : <option value="">{loading ? "직원 목록 불러오는 중…" : "배정 가능한 직원 없음"}</option>}
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" disabled={!staff.length} type="submit">배정</button>
      </div>
    </form>
  );
}
