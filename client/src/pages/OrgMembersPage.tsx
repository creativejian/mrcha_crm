import { useEffect, useState, type SyntheticEvent } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { ROLE_ACCESS_SUMMARY, roleLabelOf } from "@/data/roles";
import { useDealerProfiles, type DealerProfileEntry } from "@/lib/dealer-profiles";
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
  // 딜러 브랜드 매칭(crm.dealer_profiles) — dealer 행에만 쓰는 부가 컬럼이다.
  // ⚠️ public.profiles는 read 전용 계약이라 브랜드·비고를 거기 저장할 수 없다(#276 축).
  const { profiles: dealerProfiles, save: saveDealerProfile } = useDealerProfiles();
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
              <table className="org-members-table">
                <thead><tr><th>이름</th><th>역할</th><th>연락처</th><th>담당 고객</th><th>브랜드</th><th>비고</th><th>접근 범위</th><th>상담 수신</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={8}>구성원 불러오는 중…</td></tr>}
                  {failed && <tr><td colSpan={8}>구성원을 불러오지 못했습니다. (대표 전용 화면입니다)</td></tr>}
                  {!loading && !failed && members.length === 0 && <tr><td colSpan={8}>구성원이 없습니다.</td></tr>}
                  {members.map((m) => (
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
                      {/* 브랜드·비고는 dealer 행에만 의미가 있다 — 다른 역할은 브랜드 개념이 없다.
                          이 값이 딜러의 할인 제안 쓰기 범위를 잠그는 기준이 된다(슬라이스 B). */}
                      {m.role === "dealer" ? (
                        <DealerBrandCell
                          brands={brands}
                          entry={dealerProfiles.find((p) => p.dealerUserId === m.id)}
                          onSave={(brandId, note) => saveDealerProfile(m.id, brandId, note)}
                        />
                      ) : (
                        <>
                          <td>—</td>
                          <td>—</td>
                        </>
                      )}
                      <td>{ROLE_ACCESS_SUMMARY[m.role] ?? "—"}</td>
                      <td>
                        {/* 딜러는 담당 고객·실시간 상담 개념이 없다(배정 후보에서도 제외) — 값 자체가 무의미. */}
                        {m.role === "dealer"
                          ? <span className="badge">해당 없음</span>
                          : <span className={m.liveReceiving ? "badge green" : "badge yellow"}>{m.liveReceiving ? "On" : "Off"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

// 딜러 1행의 브랜드·비고 편집 셀(td 2개를 낸다).
// ⚠️ **Safari controlled select 함정**(크로스 프로젝트 규칙): Safari는 팝오버 선택 시
// input → React가 controlled 값 복원 → change(구값) 순서로 발화해서 **onChange만 들으면 선택이
// 통째로 유실**된다(Chrome 정상 · Playwright webkit 재현 불가라 테스트로 안 잡힌다).
// 같은 핸들러를 onChange + onInput에 병행 바인딩한다 — setState가 멱등이라 이중 발화는 무해하다.
function DealerBrandCell({
  brands,
  entry,
  onSave,
}: {
  brands: { id: number; name: string }[];
  entry: DealerProfileEntry | undefined;
  onSave: (brandId: number, note: string | null) => Promise<void>;
}) {
  // **편집 중 값만 draft로 들고, 없으면 서버 값(entry)을 그대로 렌더한다** — effect 동기화가 필요 없다.
  // useState 초기값에 entry를 넣고 effect로 맞추는 형태는 ①프로필 목록이 비동기로 늦게 도착하면
  // 초기값이 null로 굳고 ②그걸 고치려 effect에서 setState하면 react-hooks/set-state-in-effect에
  // 걸린다. 파생 상태면 두 문제가 함께 사라진다(#84에서 같은 안티패턴을 고친 선례).
  const [draft, setDraft] = useState<{ brandId: number | null; note: string } | null>(null);
  const brandId = draft ? draft.brandId : (entry?.brandId ?? null);
  const note = draft ? draft.note : (entry?.note ?? "");

  const pickBrand = (e: SyntheticEvent<HTMLSelectElement>) => {
    const value = e.currentTarget.value;
    setDraft({ brandId: value ? Number(value) : null, note });
  };

  const changed = brandId !== (entry?.brandId ?? null) || note !== (entry?.note ?? "");

  return (
    <>
      <td>
        <select value={brandId ?? ""} onChange={pickBrand} onInput={pickBrand}>
          <option value="">미지정</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {/* 브랜드가 지정됐는데 이름이 없으면 그 브랜드가 catalog에서 삭제된 상태다(FK 미도입 — spec §3.1) */}
        {entry && entry.brandName === null && <span className="badge yellow">브랜드 삭제됨</span>}
      </td>
      <td>
        <input
          value={note}
          onChange={(e) => setDraft({ brandId, note: e.currentTarget.value })}
          placeholder="동성모터스"
          maxLength={100}
        />
        {/* 브랜드가 있어야 저장할 수 있다(brand_id NOT NULL). 값이 그대로면 버튼을 숨겨 오조작을 줄인다.
            저장 후 draft를 비워 서버가 돌려준 값으로 복귀한다. */}
        {brandId !== null && changed && (
          <button
            onClick={() => void onSave(brandId, note.trim() || null).then(() => setDraft(null))}
            type="button"
          >
            저장
          </button>
        )}
      </td>
    </>
  );
}
