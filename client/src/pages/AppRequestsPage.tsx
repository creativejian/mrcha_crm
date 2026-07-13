import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { HttpError } from "@/lib/http";
import { createCustomerFromRequest, fetchAppQuoteRequestsCached, linkRequestToCustomer, type AppQuoteRequest } from "@/lib/quote-requests";

const MATCH_CLASS: Record<AppQuoteRequest["matchType"], string> = {
  app_user: "app-req-match linked",
  phone: "app-req-match maybe",
  none: "app-req-match none",
};

type AppRequestsPageProps = {
  signal: number;
  onRead: () => void;
  onToast: (message: string) => void;
  onCustomerListChanged: () => void;
};

export function AppRequestsPage({ signal, onRead, onToast, onCustomerListChanged }: AppRequestsPageProps) {
  const [rows, setRows] = useState<AppQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  // link 충돌 안내(이사님 2026-07-13 ②) — 차단은 서버가 유지, 여기선 사유 + "그 고객 보기" 경로를 보여준다.
  const [linkConflict, setLinkConflict] = useState<{ requestId: string; message: string; customerCode: string; name: string } | null>(null);

  async function handleCreate(r: AppQuoteRequest) {
    setActingId(r.id);
    setLinkConflict(null);
    try {
      const created = await createCustomerFromRequest(r.id);
      onToast(`${created.customerCode} ${created.name} 고객 생성`);
      onCustomerListChanged(); // App 고객 목록 갱신(신규 고객이 목록에 stale로 안 뜨던 버그 방지)
      setRows(await fetchAppQuoteRequestsCached(false));
    } catch (e) {
      // handleLink와 대칭(0713 감사) — 서버 한글 사유(404/403/채번 경합 등)가 있으면 그대로 표면화.
      onToast(e instanceof HttpError ? e.message : "고객 생성에 실패했습니다");
    } finally {
      setActingId(null);
    }
  }

  async function handleLink(r: AppQuoteRequest) {
    if (!r.matchedCustomerId) return;
    setActingId(r.id);
    setLinkConflict(null);
    try {
      const linked = await linkRequestToCustomer(r.id, r.matchedCustomerId);
      onToast(`${linked.name} 고객에 연결했습니다`);
      // link도 crm.customers 실변경(appUserId·updatedAt) — create와 동일하게 목록 리로드(0713 감사:
      // 미호출이면 ChatPage의 appUserId 고객 매칭·목록 최종 업데이트가 다음 리로드까지 stale).
      onCustomerListChanged();
      setRows(await fetchAppQuoteRequestsCached(false));
    } catch (e) {
      if (e instanceof HttpError && e.conflict) {
        // 정방향 충돌 — 사유 + 충돌 고객으로 가는 경로를 행 안에 인라인 안내(토스트는 1.8초라 읽고 이동하기엔 짧다).
        setLinkConflict({ requestId: r.id, message: e.message, ...e.conflict });
      } else {
        // 역방향 충돌 등 서버 한글 사유가 있으면 그대로, 네트워크류는 일반 문구.
        onToast(e instanceof HttpError ? e.message : "연결에 실패했습니다");
      }
    } finally {
      setActingId(null);
    }
  }

  // 인박스 진입 시 새 요청 카운트 리셋(= 봤다).
  useEffect(() => {
    onRead();
  }, [onRead]);

  // 초기 로드 + signal(실시간 INSERT) 변경 시 재fetch + 60초 폴링 폴백(Realtime 끊김 보험).
  // 첫 진입은 캐시 허용(force=false) — 사이드메뉴 hover 프리패치가 채워두면 즉시 표시.
  // signal 변경/폴백은 force=true로 캐시 우회(항상 fresh). 재fetch는 loading을 다시 켜지 않아 깜빡임 없음.
  const firstLoadRef = useRef(true);
  useEffect(() => {
    let alive = true;
    const load = (force: boolean) => {
      fetchAppQuoteRequestsCached(force)
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
  }, [signal]);

  return (
    <div className="app-requests-page">
      <div className="app-requests-head">
        <strong>앱 견적요청</strong>
        <span className="app-requests-count">{loading ? "불러오는 중…" : error ? "—" : `${rows.length}건`}</span>
      </div>
      {error ? (
        <div className="app-requests-empty">불러오지 못했습니다. 새로고침해 주세요.</div>
      ) : loading ? (
        <div className="app-requests-empty">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="app-requests-empty">앱에서 들어온 견적요청이 없습니다.</div>
      ) : (
        <table className="app-requests-table">
          <thead>
            <tr>
              {/* 요청일/요청자/구매방식/옵션/상태 = 닫힌 어휘·고정 포맷 → 고정 폭(줄바꿈 금지, 2026-07-13 폴리시).
                  차량·조건·매칭만 잔여 폭을 나눈다(table-layout: fixed). */}
              <th className="app-req-col-date">요청일</th>
              <th className="app-req-col-name">요청자</th>
              <th>차량</th>
              <th className="app-req-col-payment">구매방식</th>
              <th>조건</th>
              <th className="app-req-col-option">옵션</th>
              <th className="app-req-col-status">상태</th>
              <th>매칭</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="app-req-date">{r.createdAt}</td>
                <td className="app-req-name" title={r.requesterName}>{r.requesterName}</td>
                <td className="app-req-vehicle">
                  <span>{r.vehicleLabel}</span>
                  <span className="app-req-sub">{r.trimPriceLabel}</span>
                </td>
                <td className="app-req-nowrap">{r.paymentLabel}</td>
                <td className="app-req-terms">
                  <span>{r.periodLabel}</span>
                  <span className="app-req-sub">{r.depositLabel}</span>
                </td>
                <td className="app-req-nowrap">{r.optionLabel}</td>
                <td className="app-req-nowrap">{r.statusLabel}</td>
                <td className="app-req-match-cell">
                  {/* flex는 안쪽 div에 — td를 flex로 만들면 Safari에서 행 높이만큼 안 늘어나 세로정렬이 어긋남 */}
                  <div className="app-req-match-inner">
                    <span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>
                    {r.matchType === "none" && (
                      <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleCreate(r)} type="button">신규 생성</button>
                    )}
                    {r.matchType === "phone" && (
                      <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleLink(r)} type="button">{r.matchedCustomerName ?? "고객"}에 연결</button>
                    )}
                    {r.matchType === "app_user" && r.matchedCustomerCode && (
                      <>
                        {/* 승격 견적 수 = "견적 작성" 우상단 빨간 카운트 배지(구 "견적 N건" pill이 매칭 셀을
                            2단으로 밀던 것 해소). 빨간 배지가 알림으로 오독되지 않게 title로 의미 고정.
                            promoted는 승격(app_user 연결) 전제라 이 분기 밖에선 카운트가 생기지 않는다. */}
                        <Link
                          className="app-req-action app-req-action-quote"
                          title={r.promotedQuoteCount > 0 ? `이 요청에서 작성한 견적 ${r.promotedQuoteCount}건` : undefined}
                          to={`/customer-detail/${r.matchedCustomerCode}?quoteRequest=${r.id}`}
                        >
                          견적 작성
                          {r.promotedQuoteCount > 0 && (
                            <span aria-label={`이 요청에서 작성한 견적 ${r.promotedQuoteCount}건`} className="app-req-quote-count">
                              {r.promotedQuoteCount > 9 ? "9+" : r.promotedQuoteCount}
                            </span>
                          )}
                        </Link>
                        <Link className="app-req-action link" to={`/customer-detail/${r.matchedCustomerCode}`}>고객 보기</Link>
                      </>
                    )}
                  </div>
                  {linkConflict?.requestId === r.id && (
                    <div className="app-req-conflict" role="alert">
                      <span>{linkConflict.message}</span>
                      <div className="app-req-conflict-actions">
                        <Link className="app-req-action link" to={`/customer-detail/${linkConflict.customerCode}`}>{linkConflict.name} 고객 보기</Link>
                        <button className="app-req-action" onClick={() => setLinkConflict(null)} type="button">닫기</button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
