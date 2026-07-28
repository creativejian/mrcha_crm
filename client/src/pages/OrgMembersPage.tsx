import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { ROLE_ACCESS_SUMMARY, roleLabelOf } from "@/data/roles";
import { useDealerRoster, type DealerRosterEntry } from "@/lib/dealer-roster";
import { useOrgMembers } from "@/lib/org-members";
import { formatPhone } from "@/lib/phone-format";
import { fetchBrandsCached } from "@/pages/mc-master/catalog-cache";

// ⚠️ 「조직」·「권한」 탭은 아직 목업이다(2026-07-25 유슨생 결정 — 구성원 탭만 실데이터화).
// DB에 대응하는 것이 없다: `public.profiles`는 id·email·username·role·avatar_url·created_at·
// full_name·phone_* 10컬럼뿐이라 **팀(소속) 개념이 없고**, 조직도를 담을 테이블도 없다.
// 실데이터화하려면 스키마 신설이 선행이라 별건으로 남긴다.
const teams = [
  ["대표실", "사업 방향, 권한 승인, 재무 최종 확인", "1명"],
  ["상담팀", "앱 상담 연결, 고객 응대, 상담 메모", "3명 예정"],
  ["견적팀", "견적 생성, 조건 비교, 앱 송출", "2명 예정"],
  ["출고/정산팀", "계약 이후 출고 체크, 수수료 정산", "1명 예정"],
];

const permissions = [
  ["최고관리자", "전체 메뉴, 재무, 조직, AI 설정, 데이터 기준 관리"],
  ["중간관리자", "팀 고객, 상담 현황, 견적/계약 관리, 일부 콘텐츠 관리"],
  ["상담사", "배정 고객, 실시간 상담, 견적 확인, 본인 업무 큐"],
];

export function OrgMembersPage() {
  const [tab, setTab] = useState<"members" | "teams" | "roles">("members");
  const { members, loading, failed } = useOrgMembers();
  // 본인 행 표시 — auth.userId는 session.user.id이고 그게 곧 profiles.id다(같은 Supabase 유저).
  // 견적 쓰기 권한이 advisor_id를 이 값과 대조하는 것과 같은 축이라 **이름이 아니라 id로** 맞춘다
  // (구성원 이름은 중복될 수 있다 — 실측: 앱 계정 3개가 전부 full_name "김지안").
  const { userId } = useAuth();
  // 딜러는 아래 DealerRosterTable이 자기 목록(합집합)을 따로 받는다 — 여기서는 **제외**한다.
  // role로 걸러도 되는 이유: 구성원 표에 남는 것은 CRM 내부 인원(staff·manager·admin)이고,
  // 딜러 명부는 role이 내려간 사람까지 포함해야 해서 기준 자체가 다르다(lib/dealer-roster 주석).
  const staffMembers = members.filter((m) => m.role !== "dealer");
  // 브랜드 목록은 MC 마스터가 이미 캐시한다(세션 중 거의 불변) — 같은 캐시를 재사용한다.
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    void fetchBrandsCached().then((rows) => setBrands(rows.map((b) => ({ id: b.id, name: b.name }))));
  }, []);

  return (
    <div className="ops-layout">
      <section className="card">
        <div className="panel-head">
          <h2>조직 운영 기준</h2>
          <span className="badge blue">대표 전용</span>
        </div>
        <div className="panel-body">
          <div className="ops-tabs">
            <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")} type="button">구성원</button>
            <button className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")} type="button">조직</button>
            <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} type="button">권한</button>
          </div>

          {tab === "members" && (
            <div className="table-scroll">
              {/* 컬럼은 **실제로 있는 값**만 낸다(2026-07-25). 구 목업의 "소속"(기술본부·상담팀)과
                  "상태"(운영중·초대 예정)는 DB에 대응 컬럼이 없어 지어낸 값이었다 — 소속은 담당 고객
                  수로, 상태는 실시간 상담 수신(crm.staff_settings)으로 바꿨다. */}
              {/* 딜러는 **아래 별도 테이블**로 분리했다(2026-07-28 유슨생) — 역할·담당 고객·접근
                  범위·상담 수신이 전부 무의미해 `—`·"해당 없음"으로 채워졌고, 반대로 브랜드·비고는
                  딜러 행에만 의미가 있어 나머지 구성원에게 빈 칸이었다. 두 표가 각자 자기 컬럼만 낸다. */}
              <table className="org-members-table">
                <thead><tr><th>이름</th><th>역할</th><th>연락처</th><th>담당 고객</th><th>접근 범위</th><th>상담 수신</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6}>구성원 불러오는 중…</td></tr>}
                  {failed && <tr><td colSpan={6}>구성원을 불러오지 못했습니다. (대표 전용 화면입니다)</td></tr>}
                  {!loading && !failed && staffMembers.length === 0 && <tr><td colSpan={6}>구성원이 없습니다.</td></tr>}
                  {staffMembers.map((m) => (
                    <tr className={m.id === userId ? "is-me" : undefined} key={m.id}>
                      <td>
                        <strong>{m.name}</strong>
                        {m.id === userId && <span className="org-me-badge">나</span>}
                      </td>
                      <td>{roleLabelOf(m.role)}</td>
                      {/* 표기는 화면 공통 SSOT(formatPhone) — 고객 목록·상세와 같은 하이픈 포맷.
                          앱 계정에 번호가 없는 구성원이 실제로 있다(실측 6명 중 2명). */}
                      <td>{m.phone ? formatPhone(m.phone) : "미입력"}</td>
                      <td>{m.assignedCustomers}명</td>
                      <td>{ROLE_ACCESS_SUMMARY[m.role] ?? "—"}</td>
                      <td>
                        <span className={m.liveReceiving ? "badge green" : "badge yellow"}>{m.liveReceiving ? "On" : "Off"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <DealerRosterTable brands={brands} />
            </div>
          )}

          {tab === "teams" && (
            <div className="ops-card-grid">
              {teams.map(([name, mission, count]) => (
                <article className="ops-card" key={name}>
                  <span>{count}</span>
                  <strong>{name}</strong>
                  <p>{mission}</p>
                </article>
              ))}
            </div>
          )}

          {tab === "roles" && (
            <div className="ops-permission-list">
              {permissions.map(([role, scope]) => (
                <div className="ops-permission-row" key={role}>
                  <strong>{role}</strong>
                  <span>{scope}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="ops-side">
        <section className="card">
          <div className="panel-head"><h2>배정 원칙</h2><span className="badge">초안</span></div>
          <div className="panel-body brief-list">
            <div className="brief"><strong>상담 품질 우선</strong><span>단순 순번보다 고객 상황과 상담사 전문도를 기준으로 배정합니다.</span></div>
            <div className="brief"><strong>권한 최소화</strong><span>재무, 조직, AI 기준은 필요한 사람에게만 제한적으로 엽니다.</span></div>
            <div className="brief"><strong>기록 중심</strong><span>고객 이관, 견적 수정, 계약 변경은 변경 이력을 남기는 구조로 갑니다.</span></div>
          </div>
        </section>
      </aside>
    </div>
  );
}

// 조직 화면의 별도 "딜러" 테이블(2026-07-28 유슨생) — 구성원 표와 컬럼이 겹치지 않는다.
//
// 목록 기준이 구성원 표와 **다르다**: 앱에서 role이 내려간 딜러도 포함하는 합집합이다
// (서버 listDealerRoster). 그래야 퇴사·전환한 딜러의 데이터를 정리할 수 있다 — 행이 사라지면
// 삭제 버튼을 누를 대상 자체가 없어진다.
function DealerRosterTable({ brands }: { brands: { id: number; name: string }[] }) {
  const { roster, loading, failed, deleteProposals, releaseDealer, saveProfile } = useDealerRoster();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 삭제는 **되돌릴 수 없다** → window.confirm으로 반드시 막는다(레포 선례: MC 마스터 트림·옵션 삭제).
  // 문구에 ①대상 이름 ②지울 제안 건수 ③지우지 않는 것 ④되돌릴 수 없음을 담는다 — 무엇이 사라지는지
  // 모르고 누르는 상황을 만들지 않는다.
  async function run(entry: DealerRosterEntry, mode: "proposals" | "release") {
    const who = entry.name ?? "이 딜러";
    const message =
      mode === "proposals"
        ? `${who}의 할인 제안 ${entry.proposalCount}건을 삭제합니다.\n\n` +
          `· 브랜드 매칭은 남아 딜러가 다시 입력할 수 있습니다.\n` +
          `· 이미 채택된 확정 할인과 채택 이력은 그대로 유지됩니다.\n\n되돌릴 수 없습니다. 계속할까요?`
        : `${who}의 할인 제안 ${entry.proposalCount}건과 브랜드 매칭을 함께 삭제합니다.\n\n` +
          `· 이미 채택된 확정 할인과 채택 이력은 그대로 유지됩니다.\n` +
          `· ⚠️ 앱의 딜러 권한(role)은 그대로입니다 — 앱 어드민에서 따로 내려야 합니다.\n\n` +
          `되돌릴 수 없습니다. 계속할까요?`;
    if (!window.confirm(message)) return;
    setBusy(entry.dealerUserId);
    setError(null);
    try {
      await (mode === "proposals" ? deleteProposals(entry.dealerUserId) : releaseDealer(entry.dealerUserId));
    } catch {
      // 실패를 삼키면 관리자가 지워진 줄 안다 — 화면에 남긴다.
      setError(`${who} 삭제에 실패했습니다. 다시 시도해 주세요.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* 「구성원|조직|권한」 탭과 같은 pill 디자인의 섹션 라벨(유슨생 지정) — 탭이 아니라 제목이므로
          버튼이 아닌 span이다(누를 것이 없다). */}
      <div className="ops-tabs org-dealer-label">
        <span className="active">딜러</span>
      </div>
      <table className="org-members-table">
        <thead><tr><th>이름</th><th>연락처</th><th>브랜드</th><th>비고</th><th>데이터 관리</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={5}>딜러 불러오는 중…</td></tr>}
          {failed && <tr><td colSpan={5}>딜러 목록을 불러오지 못했습니다.</td></tr>}
          {!loading && !failed && roster.length === 0 && <tr><td colSpan={5}>등록된 딜러가 없습니다.</td></tr>}
          {roster.map((d) => (
            <tr key={d.dealerUserId}>
              <td>
                <strong>{d.name ?? "이름 없음"}</strong>
                {/* role이 내려간 딜러 — 행은 남기고 사실을 알린다(제안 채택도 서버가 거부한다). */}
                {!d.isDealer && <span className="badge yellow">현재 딜러 아님</span>}
              </td>
              <td>{d.phone ? formatPhone(d.phone) : "미입력"}</td>
              {/* role이 내려간 행은 편집 불가 — 딜러 아닌 사람에게 브랜드를 새로 지정하는 건
                  의미가 없고(채택도 서버가 거부), 이 행의 존재 이유는 데이터 정리뿐이다.
                  서버도 같은 기준으로 PUT을 409로 거부한다(routes/dealer.ts 대상 가드). */}
              <DealerBrandCell
                brands={brands}
                disabled={!d.isDealer}
                entry={d}
                onSave={(brandId, note) => saveProfile(d.dealerUserId, brandId, note)}
              />
              {/* 칩 버튼 — 형태·색은 `.badge` 1벌(customer-list.css)에서 그대로 온다.
                  `.org-dealer-action`은 hover만 얹는다(dashboard.css 주석 참조). */}
              <td className="org-dealer-actions">
                <button className="badge org-dealer-action" disabled={busy !== null || d.proposalCount === 0} onClick={() => void run(d, "proposals")} type="button">
                  입력값 삭제{d.proposalCount > 0 ? ` (${d.proposalCount})` : ""}
                </button>
                <button className="badge red org-dealer-action" disabled={busy !== null || d.brandId === null} onClick={() => void run(d, "release")} type="button">
                  딜러 해제
                </button>
              </td>
            </tr>
          ))}
          {error && <tr><td className="org-dealer-error" colSpan={5}>{error}</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// 딜러 1행의 브랜드·비고 편집 셀(td 2개를 낸다). **저장 버튼 없음**(2026-07-28 유슨생):
//   브랜드 = 선택 즉시 window.confirm → 저장(삭제 2종과 같은 톤). 취소하면 아무것도 안 한다 —
//     select가 서버 값(entry.brandId)만 보는 controlled라 화면이 스스로 되돌아간다.
//   비고 = blur/Enter 자동 저장(MC 마스터 딜러 셀과 같은 톤 — 라벨 한 줄에 confirm은 과하다).
//     브랜드 미지정이면 **입력칸 자체를 비활성화**(placeholder "브랜드 먼저 지정") — brand_id가
//     NOT NULL이라 비고 단독 저장이 불가한데, 쓰게 두면 "썼는데 저장 안 됨" 함정이 된다.
//     경고 팝업(focus 시 alert)은 사후 안내인 데다 alert 닫힘 → 재포커스 → 재발화 루프 위험이
//     있어 사전 차단을 택했다(유슨생 승인).
// ⚠️ **Safari controlled select 함정 — 액션형 변형**(크로스 프로젝트 규칙): Safari는 팝오버 선택 시
// input → React가 controlled 값 복원 → change(구값) 순서로 발화한다. setState형이면 같은 핸들러를
// onChange+onInput에 병행 바인딩하면 되지만(멱등), 여기는 confirm 실행이라 **두 번 뜬다** —
// onInput은 ref에 실값만 보관하고 실행은 onChange 1곳. **ref를 먼저** 읽는다: 전역 규칙의
// `value || ref` 폴백은 value가 빈 문자열 고정인 액션형 기준이고, 여기는 Safari가 복원한 구값이
// truthy라 DOM 값을 먼저 읽으면 구 브랜드로 confirm이 뜬다.
function DealerBrandCell({
  brands,
  disabled,
  entry,
  onSave,
}: {
  brands: { id: number; name: string }[];
  /** "현재 딜러 아님" 행 — 폼 컨트롤 없이 값만 텍스트로 낸다(서버도 PUT을 409로 거부). */
  disabled: boolean;
  entry: DealerRosterEntry | undefined;
  onSave: (brandId: number, note: string | null) => Promise<void>;
}) {
  // 비고만 draft로 들고, 없으면 서버 값(entry)을 그대로 렌더한다 — effect 동기화가 필요 없다
  // (#84에서 초기값+effect 동기화 안티패턴을 고친 선례). 브랜드는 draft가 없다 — 선택 즉시
  // confirm → 저장이라 "편집 중" 상태 자체가 없다.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  const savedBrandId = entry?.brandId ?? null;
  const note = noteDraft ?? entry?.note ?? "";

  // 읽기 전용 행은 **폼 컨트롤 자체를 내지 않는다** — disabled select는 화살표·입력 박스가
  // 남아 "편집될 것 같은" 모양이라 직관적이지 않다(2026-07-28 유슨생 실기 피드백). 연락처
  // 열과 같은 일반 텍스트로 내면 "컨트롤이 보이는 행만 편집 가능"이 모양만으로 읽힌다.
  if (disabled) {
    return (
      <>
        <td>
          {/* 편집 행의 select 안 텍스트와 같은 지점에서 시작시킨다(.org-dealer-plain) —
              없으면 두 행의 "BMW"가 어긋나 보인다(유슨생 실기 피드백). */}
          <span className="org-dealer-plain">
            {entry?.brandName ??
              (entry?.brandId != null ? <span className="badge yellow">브랜드 삭제됨</span> : "미지정")}
          </span>
        </td>
        <td>{entry?.note ?? "—"}</td>
      </>
    );
  }

  // 선택 즉시 confirm — 문구에 ①대상 ②무엇이 바뀌나 ③기존 제안에 미치는 영향을 담는다
  // (삭제 confirm과 같은 원칙: 무엇이 일어나는지 모르고 누르는 상황을 만들지 않는다).
  const pickBrand = (e: SyntheticEvent<HTMLSelectElement>) => {
    const picked = pickedRef.current ?? e.currentTarget.value;
    pickedRef.current = null;
    if (!picked) return; // "미지정" 선택은 해제 경로가 아니다 — 매칭 해제는 딜러 해제 버튼 하나뿐
    const brandId = Number(picked);
    if (brandId === savedBrandId) return;
    const who = entry?.name ?? "이 딜러";
    const newName = brands.find((b) => b.id === brandId)?.name ?? "선택한 브랜드";
    const message =
      savedBrandId === null
        ? `${who}를 ${newName} 딜러로 지정합니다.\n\n딜러 화면에서 ${newName} 차량에만 할인을 입력할 수 있습니다. 계속할까요?`
        : `${who}의 브랜드를 ${entry?.brandName ?? "미지정"} → ${newName}(으)로 변경합니다.\n\n` +
          (entry && entry.proposalCount > 0
            ? `· 기존 할인 제안 ${entry.proposalCount}건은 남지만, 브랜드가 달라 채택할 수 없게 됩니다.\n`
            : "") +
          `· 딜러 화면 입력 범위가 ${newName} 차량으로 바뀝니다.\n\n계속할까요?`;
    if (!window.confirm(message)) return;
    // 실패를 삼키면 저장된 줄 안다 — confirm과 같은 채널(alert)로 알린다.
    void onSave(brandId, note.trim() || null)
      .then(() => setNoteDraft(null))
      .catch(() => window.alert(`${who}의 브랜드 저장에 실패했습니다. 다시 시도해 주세요.`));
  };

  // blur/Enter 자동 저장 — 값이 그대로면 서버를 부르지 않는다.
  const saveNote = () => {
    if (savedBrandId === null || noteDraft === null) return; // 미지정이면 입력칸이 잠겨 있다(방어)
    const next = noteDraft.trim() || null;
    if (next === (entry?.note ?? null)) {
      setNoteDraft(null);
      return;
    }
    void onSave(savedBrandId, next)
      .then(() => setNoteDraft(null))
      .catch(() => window.alert("비고 저장에 실패했습니다. 다시 시도해 주세요."));
  };

  return (
    <>
      <td>
        <select
          value={savedBrandId ?? ""}
          onChange={pickBrand}
          onInput={(e) => {
            pickedRef.current = e.currentTarget.value;
          }}
        >
          <option value="">미지정</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {/* 브랜드가 지정됐는데 이름이 없으면 그 브랜드가 catalog에서 삭제된 상태다(FK 미도입 — spec §3.1).
            brandId 조건이 없으면 미지정 행(brandName도 null)에 배지가 잘못 뜬다. */}
        {entry && entry.brandId !== null && entry.brandName === null && (
          <span className="badge yellow">브랜드 삭제됨</span>
        )}
      </td>
      <td>
        <input
          disabled={savedBrandId === null}
          value={note}
          onChange={(e) => setNoteDraft(e.currentTarget.value)}
          onBlur={saveNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={savedBrandId === null ? "브랜드 먼저 지정" : "동성모터스"}
          maxLength={100}
        />
      </td>
    </>
  );
}
