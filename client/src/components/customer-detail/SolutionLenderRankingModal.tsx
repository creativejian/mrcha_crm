import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { formatMoney } from "@/lib/quote-pricing";
import { bindSelect } from "@/lib/select-bind";
import { requestSolutionQuote } from "@/lib/customer-quotes";
import {
  buildSolutionQuoteInput,
  parseSolutionQuoteResult,
  solutionLenderOptions,
  type BuildArgs,
  type SolutionLenderCode,
} from "@/lib/solution-quote";
import {
  RANKING_SORT_OPTIONS,
  buildRankingEntry,
  computeRankingStats,
  isLenderNotAvailableMessage,
  monthlyDelta,
  rankingBadgeFlags,
  sortRankingEntries,
  type RankingSortType,
  type SolutionRankingEntry,
} from "@/lib/solution-ranking";
import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";

import mgLogo from "@/assets/lenders/mg.jpg";
import bnkLogo from "@/assets/lenders/bnk.jpg";
import wooriLogo from "@/assets/lenders/woori.jpg";
import meritzLogo from "@/assets/lenders/meritz.jpg";
import shinhanLogo from "@/assets/lenders/shinhan.jpg";
import kdbcLogo from "@/assets/lenders/kdbc.png";
import imLogo from "@/assets/lenders/im.png";
import nhcapLogo from "@/assets/lenders/nhcap.svg";

// 금융사 로고(제프 assets/lenders 복사본 — 공식 마크, 동일한 내부 B2B 용도).
const LENDER_LOGOS: Record<SolutionLenderCode, string> = {
  "mg-capital": mgLogo,
  "bnk-capital": bnkLogo,
  "woori-card": wooriLogo,
  "meritz-capital": meritzLogo,
  "shinhan-card": shinhanLogo,
  "kdbc-capital": kdbcLogo,
  "im-capital": imLogo,
  "nh-capital": nhcapLogo,
};

type SolutionLenderRankingModalProps = {
  condId: string; // 조회를 연 비교카드 id
  purchaseMethod: string; // 구매방식(지원 금융사 목록·productType 파생)
  buildBaseArgs: (condId: string) => Omit<BuildArgs, "lenderLabel"> | null; // 훅 제공 — 카드 조건 조립(금융사 제외)
  onPick: (condId: string, entry: SolutionRankingEntry) => void; // 행 선택 → 카드 채움(훅 pickRankingEntry)
  onClose: () => void;
};

// 금융사 일괄 조회 랭킹 모달(스펙 개정 2 R4 — 제프 랭킹 UX 이식). 병렬 fetch 상태는 이 컴포넌트가
// 소유(제프 useMultiQuote 미러: Promise 개별 도착 순 렌더, 배치 엔드포인트 아님) — 훅은 조건 조립
// (buildBaseArgs)·선택 콜백(onPick)만 제공한다. 미취급·실패 금융사는 행에서 조용히 제외(제프 미러 — footer 없음).
export function SolutionLenderRankingModal({ condId, purchaseMethod, buildBaseArgs, onPick, onClose }: SolutionLenderRankingModalProps) {
  const lenders = solutionLenderOptions(purchaseMethod);
  const [entries, setEntries] = useState<Record<string, SolutionRankingEntry>>({});
  const [doneCount, setDoneCount] = useState(0);
  const [sortType, setSortType] = useState<RankingSortType>("monthlyPayment");
  // 에러성 실패(미취급 아님 — 릴레이 503/네트워크/스키마 이탈)의 첫 사유. 전사 실패가 "조회 결과 없음"으로
  // 위장되지 않게 empty state에서 표면화한다(fail-loud — env 오설정이 무결과처럼 보였던 실사용 혼란 재발 방지).
  const [failureNote, setFailureNote] = useState<string | null>(null);

  useEffect(() => {
    // 마운트 1회 전 금융사 병렬 조회(모달 = 오픈마다 새 마운트 — solutionLenderPickerId 조건부 렌더).
    let cancelled = false;
    const base = buildBaseArgs(condId);
    for (const lender of lenders) {
      const built = base ? buildSolutionQuoteInput({ ...base, lenderLabel: lender.label }) : null;
      if (!built || !built.ok) {
        // 방어 분기(카드 소실·빌드 실패 — 공통 조건은 오픈 전 프로브가 이미 걸렀다)도 마이크로태스크로
        // 카운트만 소진: effect 동기 setState 금지(react-hooks/set-state-in-effect) 준수.
        void Promise.resolve().then(() => {
          if (!cancelled) setDoneCount((n) => n + 1);
        });
        continue;
      }
      requestSolutionQuote(built.input)
        .then((raw) => {
          if (cancelled) return;
          const parsed = parseSolutionQuoteResult(raw);
          if (!parsed) {
            // 응답 도착했으나 형태 이탈(파트너 스키마 드리프트) — 미취급과 구분되게 관측 로그를 남긴다.
            console.warn(`[solution] 랭킹 응답 해석 실패 lender=${lender.code}`);
            setFailureNote((prev) => prev ?? "계산 응답을 해석하지 못했습니다");
            return;
          }
          const entry = buildRankingEntry(lender.code, lender.label, parsed, raw, built.input.productType, built.input.leaseTermMonths);
          setEntries((prev) => ({ ...prev, [lender.code]: entry }));
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // 미취급·실패 = 행에서 조용히 제외(개정 2 R4-5). 미취급 아닌 실패(네트워크·5xx)만 관측 로그 —
          // "전부 조용히 사라짐"이 장애인지 미취급인지 tail/콘솔에서 구분 가능하게.
          const msg = e instanceof Error ? e.message : String(e);
          if (!isLenderNotAvailableMessage(msg)) {
            console.warn(`[solution] 랭킹 조회 실패 lender=${lender.code}: ${msg}`);
            setFailureNote((prev) => prev ?? msg);
          }
        })
        .finally(() => {
          if (!cancelled) setDoneCount((n) => n + 1);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회 일괄 조회(props는 오픈 시점 고정)
  }, []);

  const isLoading = doneCount < lenders.length;
  // 정렬 입력은 SOLUTION_LENDERS 순서(lenders 순회)로 조립 — stable sort 동률 시 파트너 표시 순서 유지.
  const collected = lenders.map((l) => entries[l.code]).filter((e): e is SolutionRankingEntry => e != null);
  const sorted = sortRankingEntries(collected, sortType);
  const stats = computeRankingStats(collected);

  return (
    <div className="kim-solution-lender-modal" onClick={onClose} role="presentation">
      <div
        className="kim-solution-lender-dialog is-ranking"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="솔루션 금융사 일괄 조회"
        aria-modal="true"
      >
        <header>
          <div>
            <span>{purchaseMethod} 솔루션 조회</span>
            <strong>{isLoading ? "견적 조회 중…" : "행을 선택하면 그 금융사로 채웁니다"}</strong>
          </div>
          <button aria-label="금융사 조회 닫기" onClick={onClose} type="button">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className="kim-solution-rank-toolbar">
          <span className="kim-solution-rank-status" role="status">
            {isLoading ? (
              <>
                <DoubleBounceDots />
                견적 조회 중… ({doneCount}/{lenders.length})
              </>
            ) : (
              `조회 완료 · ${sorted.length}개`
            )}
          </span>
          <label className="kim-solution-rank-sort">
            <span>정렬</span>
            {/* controlled select — Safari onChange 유실 함정으로 bindSelect(onChange+onInput 병행) 필수 */}
            <select {...bindSelect(sortType, (v) => setSortType(v as RankingSortType))}>
              {RANKING_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="kim-solution-rank-list">
          {sorted.length === 0 && !isLoading ? (
            <p className="kim-solution-rank-empty">
              {failureNote ? `조회에 실패했습니다 — ${failureNote}` : "조회 결과가 없습니다"}
            </p>
          ) : (
            sorted.map((entry, idx) => {
              // stats는 collected 비어있지 않으면 non-null(sorted와 같은 집합) — 뱃지/차액은 집합 전체 대비.
              const flags = stats ? rankingBadgeFlags(entry, stats) : { lowestMonthly: false, lowestRate: false, highestResidual: false, lowestTotal: false };
              const delta = stats ? monthlyDelta(entry, stats, sortType, idx) : 0;
              const badges = [
                ...(flags.lowestMonthly ? [{ label: "최저 월납입", tone: "red" }] : []),
                ...(flags.lowestRate ? [{ label: "최저 금리", tone: "green" }] : []),
                ...(flags.highestResidual ? [{ label: "최대 잔존가치", tone: "gray" }] : []),
                ...(flags.lowestTotal ? [{ label: "최저 총 비용", tone: "green" }] : []),
              ];
              return (
                <button className="kim-solution-rank-row" key={entry.lenderCode} onClick={() => onPick(condId, entry)} type="button">
                  <span className="kim-solution-rank-row-head">
                    <i className="rank-no">{idx + 1}</i>
                    {badges.map((b) => (
                      <em className={`rank-badge is-${b.tone}`} key={b.label}>{b.label}</em>
                    ))}
                    {delta > 0 ? <b className="rank-delta">+{formatMoney(delta)}</b> : null}
                  </span>
                  <span className="kim-solution-rank-row-main">
                    <img alt="" src={LENDER_LOGOS[entry.lenderCode]} />
                    <strong>{entry.label}</strong>
                    <em className="rank-rate">{entry.ratePct.toFixed(2)}%</em>
                    {entry.warnings.length > 0 ? (
                      <i className="rank-warn" title={entry.warnings.join("\n")}>
                        <AlertTriangle size={13} strokeWidth={2.1} />
                      </i>
                    ) : null}
                    <b className="rank-monthly">{formatMoney(entry.monthlyDisplay)}<small>원</small></b>
                  </span>
                  <span className="kim-solution-rank-row-sub">
                    잔존가치 <b>{formatMoney(entry.residualAmount)}원 ({entry.residualPct.toFixed(1)}%)</b>
                    <i aria-hidden="true">|</i>
                    총 비용 <b>{formatMoney(entry.totalCost)}원</b>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <footer className="kim-solution-lender-foot">
          <p>목록에 없는 금융사는 수기 작성으로 진행해 주세요.</p>
          <button onClick={onClose} type="button">취소</button>
        </footer>
      </div>
    </div>
  );
}
