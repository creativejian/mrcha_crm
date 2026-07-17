import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import type { Customer } from "@/data/customers";
import { buildConsultationInboxGroups, type ConsultationInboxGroup, type ConsultationMatchType } from "@/lib/consultation-inbox";
import {
  createCustomerFromConsultation,
  fetchPendingConsultationsCached,
  linkConsultationToCustomer,
  type AppConsultationRow,
} from "@/lib/consultations";
import { formatPhone } from "@/lib/customers";
import { HttpError } from "@/lib/http";

// 매칭 칩 톤 — 앱 견적요청 인박스와 같은 클래스(quote-inbox.css 공유).
const MATCH_CLASS: Record<ConsultationMatchType, string> = {
  app_user: "app-req-match linked",
  phone: "app-req-match maybe",
  none: "app-req-match none",
};

type ConsultationRequestsPageProps = {
  customers: Customer[];
  onToast: (message: string) => void;
  onCustomerListChanged: () => void;
};

// 상담 신청 DB 인박스 — 앱 상담신청(public.consultations pending)을 유저별 그룹 행으로 보여주고,
// 미연결 유저를 기존 고객 연결(link) 또는 신규 고객 생성(create-customer)으로 승격한다.
// 앱 견적요청 인박스(AppRequestsPage) 매칭 UX 미러. 매칭 파생은 클라 순수 계층(consultation-inbox.ts).
export function ConsultationRequestsPage({ customers, onToast, onCustomerListChanged }: ConsultationRequestsPageProps) {
  const [rows, setRows] = useState<AppConsultationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  // link 충돌 안내(이사님 2026-07-13 ② — 견적요청 인박스 #225 미러) — 차단은 서버, 여기선 사유+경로 인라인.
  const [linkConflict, setLinkConflict] = useState<{ groupKey: string; message: string; customerCode: string; name: string } | null>(null);

  // 그룹핑·매칭은 rows(상담신청)·customers(App 전체 고객 목록) 파생 — 승격 성공 후
  // onCustomerListChanged가 customers를 리로드하면 배지가 "연결됨"으로 자동 전환된다.
  const groups = useMemo(() => buildConsultationInboxGroups(rows, customers), [rows, customers]);

  // 초기 로드(캐시 허용 — 사이드메뉴 hover 프리패치가 채워두면 즉시) + 60초 폴링(fresh).
  // 상담신청은 견적요청과 달리 Realtime 구독이 없어 폴링이 유일한 자동 갱신 경로다.
  const firstLoadRef = useRef(true);
  useEffect(() => {
    let alive = true;
    const load = (force: boolean) => {
      fetchPendingConsultationsCached(force)
        .then((d) => {
          if (alive) {
            setRows(d);
            setError(false);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load(!firstLoadRef.current);
    firstLoadRef.current = false;
    const id = window.setInterval(() => load(true), 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  function toggleExpand(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 행 키보드 접근(인사이트 행 관례 미러). 셀 안 버튼/링크의 Enter는 자기 액션만(버블 무시).
  function toggleByKeyboard(event: KeyboardEvent<HTMLTableRowElement>, key: string) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpand(key);
    }
  }

  async function handleCreate(g: ConsultationInboxGroup) {
    setActingKey(g.key);
    setLinkConflict(null);
    try {
      const created = await createCustomerFromConsultation(g.latestConsultationId);
      onToast(`${created.customerCode} ${created.name} 고객 생성`);
      onCustomerListChanged(); // 고객 목록 리로드 → 매칭 파생이 "연결됨"으로 전환
      setRows(await fetchPendingConsultationsCached(false));
    } catch (e) {
      onToast(e instanceof HttpError ? e.message : "고객 생성에 실패했습니다");
    } finally {
      setActingKey(null);
    }
  }

  async function handleLink(g: ConsultationInboxGroup) {
    if (!g.matchedCustomerId) return;
    setActingKey(g.key);
    setLinkConflict(null);
    try {
      const linked = await linkConsultationToCustomer(g.latestConsultationId, g.matchedCustomerId);
      // droppedPhone = 기존 번호가 추가 연락처 자리 점유로 못 옮겨진 경우(2026-07-17 spec) — 무음 유실 방지.
      onToast(
        linked.droppedPhone
          ? `${linked.name} 고객에 연결했습니다 · 기존 번호 ${formatPhone(linked.droppedPhone)}은 추가 연락처가 있어 옮기지 못했습니다`
          : `${linked.name} 고객에 연결했습니다`,
      );
      onCustomerListChanged();
      setRows(await fetchPendingConsultationsCached(false));
    } catch (e) {
      if (e instanceof HttpError && e.conflict) {
        // 정방향 충돌 — 사유 + 충돌 고객으로 가는 경로를 행 안에 인라인 안내(토스트 1.8초는 짧다).
        setLinkConflict({ groupKey: g.key, message: e.message, ...e.conflict });
      } else {
        onToast(e instanceof HttpError ? e.message : "연결에 실패했습니다");
      }
    } finally {
      setActingKey(null);
    }
  }

  // 매칭 셀 안 버튼/링크 클릭이 행 펼침 토글로 번지지 않게 공통 차단.
  function stopRowToggle(event: SyntheticEvent) {
    event.stopPropagation();
  }

  const totalCount = rows.length;

  return (
    <div className="consult-inbox-page">
      <div className="app-requests-head">
        <strong>상담 신청 DB</strong>
        <span className="app-requests-count">
          {loading ? "불러오는 중…" : error ? "—" : `${groups.length}명 · ${totalCount}건`}
        </span>
      </div>
      {error ? (
        <div className="app-requests-empty">불러오지 못했습니다. 새로고침해 주세요.</div>
      ) : loading ? (
        <div className="app-requests-empty">불러오는 중…</div>
      ) : groups.length === 0 ? (
        <div className="app-requests-empty">앱에서 들어온 상담신청이 없습니다.</div>
      ) : (
        <div className="console-table-scroll">
          <table className="consult-inbox-table console-table">
            <thead>
              <tr>
                {/* 상담일/이름/연락처/건수 = 고정 포맷 → 고정 폭, 최근 문의·매칭이 잔여 폭을 나눈다(견적요청 인박스 폴리시 미러). */}
                <th className="consult-inbox-col-date">최근 상담일</th>
                <th className="consult-inbox-col-name">이름</th>
                <th className="consult-inbox-col-phone">연락처</th>
                <th className="consult-inbox-col-count">상담</th>
                <th>최근 문의</th>
                <th>매칭</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const expanded = expandedKeys.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr
                      aria-expanded={expanded}
                      className="consult-inbox-row"
                      onClick={() => toggleExpand(g.key)}
                      onKeyDown={(event) => toggleByKeyboard(event, g.key)}
                      role="button"
                      tabIndex={0}
                    >
                      {/* 날짜 1줄·시간 2줄 — dateLabel = "YY/MM/DD HH:mm" 고정 포맷(formatActivity) */}
                      <td className="app-req-date">
                        <span>{g.latestDateLabel.split(" ")[0]}</span>
                        <span className="app-req-sub">{g.latestDateLabel.split(" ")[1]}</span>
                      </td>
                      <td className="app-req-name" title={g.name}>{g.name}</td>
                      <td className="app-req-nowrap">{g.phoneLabel}</td>
                      <td className="consult-inbox-count">
                        {g.count}건
                        <ChevronDown aria-hidden="true" className={`consult-inbox-chevron ${expanded ? "open" : ""}`} size={14} />
                      </td>
                      <td className="consult-inbox-preview" title={g.previewNotes ?? undefined}>{g.previewNotes ?? "—"}</td>
                      <td className="app-req-match-cell">
                        {/* flex는 안쪽 div에 — td를 flex로 만들면 Safari에서 행 높이 세로정렬이 어긋남(견적요청 인박스 관례) */}
                        <div className="app-req-match-inner">
                          <span className={MATCH_CLASS[g.matchType]}>{g.matchLabel}</span>
                          {g.matchType === "none" && g.canPromote && (
                            <button
                              className="app-req-action"
                              disabled={actingKey === g.key}
                              onClick={(event) => {
                                stopRowToggle(event);
                                void handleCreate(g);
                              }}
                              type="button"
                            >
                              고객 생성
                            </button>
                          )}
                          {g.matchType === "phone" && g.canPromote && (
                            <button
                              className="app-req-action"
                              disabled={actingKey === g.key}
                              onClick={(event) => {
                                stopRowToggle(event);
                                void handleLink(g);
                              }}
                              type="button"
                            >
                              {g.matchedCustomerName ?? "고객"}에 연결
                            </button>
                          )}
                          {g.matchType === "app_user" && g.matchedCustomerCode && (
                            <Link className="app-req-action link" onClick={stopRowToggle} to={`/customer-detail/${g.matchedCustomerCode}`}>
                              고객 보기
                            </Link>
                          )}
                        </div>
                        {linkConflict?.groupKey === g.key && (
                          <div className="app-req-conflict" role="alert">
                            <span>{linkConflict.message}</span>
                            <div className="app-req-conflict-actions">
                              <Link className="app-req-action link" onClick={stopRowToggle} to={`/customer-detail/${linkConflict.customerCode}`}>
                                {linkConflict.name} 고객 보기
                              </Link>
                              <button
                                className="app-req-action"
                                onClick={(event) => {
                                  stopRowToggle(event);
                                  setLinkConflict(null);
                                }}
                                type="button"
                              >
                                닫기
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="consult-inbox-detail-row">
                        <td colSpan={6}>
                          {/* 개별 상담(읽기 전용) — 고객 상세 상담신청 카드 어휘 미러: 날짜·차종(값 있을 때만)·문의 notes */}
                          <ul className="consult-inbox-items">
                            {g.items.map((item) => (
                              <li key={item.id}>
                                <span className="consult-inbox-item-date">{item.dateLabel}</span>
                                {item.carModel?.trim() ? <span className="consult-inbox-item-car">{item.carModel}</span> : null}
                                <span className="consult-inbox-item-notes">{item.notes?.trim() ? item.notes : "—"}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
