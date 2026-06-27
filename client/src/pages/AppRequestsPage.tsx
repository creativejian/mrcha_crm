import { useEffect, useState } from "react";

import { fetchAppQuoteRequests, type AppQuoteRequest } from "@/lib/quote-requests";

const MATCH_CLASS: Record<AppQuoteRequest["matchType"], string> = {
  app_user: "app-req-match linked",
  phone: "app-req-match maybe",
  none: "app-req-match none",
};

type AppRequestsPageProps = {
  signal: number;
  onRead: () => void;
};

export function AppRequestsPage({ signal, onRead }: AppRequestsPageProps) {
  const [rows, setRows] = useState<AppQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 인박스 진입 시 새 요청 카운트 리셋(= 봤다).
  useEffect(() => {
    onRead();
  }, [onRead]);

  // 초기 로드 + signal(실시간 INSERT) 변경 시 재fetch + 60초 폴링 폴백(Realtime 끊김 보험).
  // 재fetch는 loading을 다시 켜지 않아 자동갱신 시 깜빡임이 없다(첫 로드만 안내 문구).
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchAppQuoteRequests()
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
    load();
    const id = window.setInterval(load, 60000);
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
                <td>
                  <span className={MATCH_CLASS[r.matchType]}>{r.matchLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
