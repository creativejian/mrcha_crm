import { useState, type SyntheticEvent } from "react";

import { formatLocalPhone, localPhoneFrom } from "@/lib/detail-utils";
import {
  type KimAdvisorTeam,
  type KimCustomerType,
  kimAdvisorOptions,
  kimAutomaticSourceOptions,
  kimCustomerTypeOptions,
  kimManualSourceOptions,
  kimRegionOptions,
  parseKimAdvisorValue,
  parseKimJobValue,
  parseKimLocationValue,
  parseKimSourceValue,
} from "@/lib/status-fields";

// 직군 상세분류 옵션(개인일 때). 본체에서 이동 — 값 무변경.
const kimPersonalJobDetailOptions = ["4대보험", "프리랜서", "무직", "주부", "기타"];

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
  const initialJob = parseKimJobValue(initialValue);
  const [customerType, setCustomerType] = useState<KimCustomerType>(initialJob.type);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>직군 분류</span>
        <select
          autoFocus
          defaultValue={initialJob.type}
          name="customerType"
          onChange={(event) => setCustomerType(event.currentTarget.value as KimCustomerType)}
        >
          {kimCustomerTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      {customerType === "개인" ? (
        <label>
          <span>상세 분류</span>
          <select defaultValue={kimPersonalJobDetailOptions.includes(initialJob.detail) ? initialJob.detail : "4대보험"} name="customerTypeDetail">
            {kimPersonalJobDetailOptions.map((option) => <option key={option} value={option}>{option}</option>)}
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
  const initialLocation = parseKimLocationValue(initialValue);
  const [province, setProvince] = useState(initialLocation.province);
  const detailOptions = kimRegionOptions[province] ?? kimRegionOptions["확인 필요"];
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
          {Object.keys(kimRegionOptions).map((option) => <option key={option} value={option}>{option}</option>)}
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
  const initialSource = parseKimSourceValue(initialValue);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>상담경로 수정</span>
        <select autoFocus defaultValue={initialSource} name="source">
          <optgroup label="자동 접수">
            {kimAutomaticSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
          <optgroup label="수동 접수">
            {kimManualSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
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
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const initialAdvisor = parseKimAdvisorValue(initialValue);
  const [team, setTeam] = useState<KimAdvisorTeam>(initialAdvisor.team);
  const advisorOptions = kimAdvisorOptions[team];
  const advisorValue = advisorOptions.includes(initialAdvisor.advisor) ? initialAdvisor.advisor : advisorOptions[0];

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>팀 선택</span>
        <select
          autoFocus
          defaultValue={initialAdvisor.team}
          name="team"
          onChange={(event) => setTeam(event.currentTarget.value as KimAdvisorTeam)}
        >
          {Object.keys(kimAdvisorOptions).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>담당자 선택</span>
        <select key={team} defaultValue={advisorValue} name="advisor">
          {advisorOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">배정</button>
      </div>
    </form>
  );
}
