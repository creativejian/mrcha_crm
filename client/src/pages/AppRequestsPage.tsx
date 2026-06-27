import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

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
};

export function AppRequestsPage({ signal, onRead, onToast }: AppRequestsPageProps) {
  const [rows, setRows] = useState<AppQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  async function handleCreate(r: AppQuoteRequest) {
    setActingId(r.id);
    try {
      const created = await createCustomerFromRequest(r.id);
      onToast(`${created.customerCode} ${created.name} 고객 생성`);
      setRows(await fetchAppQuoteRequestsCached(false));
    } catch {
      onToast("고객 생성에 실패했습니다");
    } finally {
      setActingId(null);
    }
  }

  async function handleLink(r: AppQuoteRequest) {
    if (!r.matchedCustomerId) return;
    setActingId(r.id);
    try {
      const linked = await linkRequestToCustomer(r.id, r.matchedCustomerId);
      onToast(`${linked.name} 고객에 연결했습니다`);
      setRows(await fetchAppQuoteRequestsCached(false));
    } catch {
      onToast("연결에 실패했습니다");
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
              <th>요청일</th>
              <th>요청자</th>
              <th>차량</th>
              <th>구매방식</th>
              <th>조건</th>
              <th>옵션</th>
              <th>상태</th>
              <th>매칭</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="app-req-date">{r.createdAt}</td>
                <td>{r.requesterName}</td>
                <td className="app-req-vehicle">
                  <span>{r.vehicleLabel}</span>
                  <span className="app-req-sub">{r.trimPriceLabel}</span>
                </td>
                <td>{r.paymentLabel}</td>
                <td className="app-req-terms">
                  <span>{r.periodLabel}</span>
                  <span className="app-req-sub">{r.depositLabel}</span>
                </td>
                <td>{r.optionLabel}</td>
                <td>{r.statusLabel}</td>
                <td className="app-req-match-cell">
                  <span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>
                  {r.matchType === "none" && (
                    <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleCreate(r)} type="button">신규 생성</button>
                  )}
                  {r.matchType === "phone" && (
                    <button className="app-req-action" disabled={actingId === r.id} onClick={() => handleLink(r)} type="button">{r.matchedCustomerName ?? "고객"}에 연결</button>
                  )}
                  {r.matchType === "app_user" && r.matchedCustomerCode && (
                    <Link className="app-req-action link" to={`/customer-detail/${r.matchedCustomerCode}`}>고객 보기</Link>
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
