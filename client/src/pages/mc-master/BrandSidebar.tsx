import { useLayoutEffect, useRef } from "react";

import type { CatalogBrand } from "@/lib/catalog";
import { mcMasterViewState } from "./view-state";

export function BrandSidebar({
  brands,
  selectedId,
  onSelect,
  onPrefetch,
  pendingByBrand,
  gapsByBrand,
}: {
  brands: CatalogBrand[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  // hover/focus 시 해당 브랜드 모델을 미리 받아둬 클릭 즉시 렌더(prefetch).
  onPrefetch?: (id: number) => void;
  /** 브랜드별 승인 대기(빨강) — 결재할 것. */
  pendingByBrand?: Map<number, number>;
  /** 브랜드별 고유번호 미부여(파랑) — 결재 뒤에 남는 마무리. */
  gapsByBrand?: Record<number, number>;
}) {
  const domestic = brands.filter((b) => b.isDomestic);
  const imported = brands.filter((b) => !b.isDomestic);

  // 사이드바 자체 스크롤(20여 개 브랜드가 화면 높이를 넘는다) 위치를 화면 재진입 뒤에도 복원한다.
  // 복원 시점은 brands가 도착해 항목이 그려진 뒤여야 한다(빈 목록에 scrollTop을 주면 0으로 잘린다).
  const scrollRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = mcMasterViewState.brandScrollTop;
  }, [brands.length]);

  const group = (label: string, list: CatalogBrand[]) => (
    <div className="va-brand-group" key={label}>
      <div className="va-brand-group-label">{label}</div>
      {list.map((b) => {
        const pending = pendingByBrand?.get(b.id) ?? 0;
        const gaps = gapsByBrand?.[b.id] ?? 0;
        return (
          <button
            key={b.id}
            type="button"
            className={`va-brand-item${b.id === selectedId ? " is-active" : ""}`}
            onClick={() => onSelect(b.id)}
            onMouseEnter={() => onPrefetch?.(b.id)}
            onFocus={() => onPrefetch?.(b.id)}
          >
            {b.logoUrl ? (
              <img src={b.logoUrl} alt="" className="va-brand-logo" loading="eager" decoding="async" />
            ) : (
              <span className="va-brand-logo" />
            )}
            <span>{b.name}</span>
            {/* 배지는 **빨강(승인 대기) → 파랑(고유번호 미부여)** 순으로 고정한다(2026-08-05 유슨생).
                두 축이 한 줄에 같이 뜰 수 있어서(결재할 것 + 마무리할 것) 순서가 흔들리면 색을
                매번 다시 읽게 된다. 0이면 그 배지를 아예 그리지 않는다. */}
            {pending > 0 && (
              <span aria-label={`${b.name} 승인 대기 ${pending}건`} className="va-pending-count num">
                {pending}
              </span>
            )}
            {gaps > 0 && (
              <span aria-label={`${b.name} 고유번호 미부여 ${gaps}건`} className="va-gap-count num">
                {gaps}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <nav
      className="va-brand-sidebar"
      aria-label="브랜드"
      ref={scrollRef}
      onScroll={(e) => {
        mcMasterViewState.brandScrollTop = e.currentTarget.scrollTop;
      }}
    >
      {domestic.length > 0 && group("국산차", domestic)}
      {imported.length > 0 && group("수입차", imported)}
    </nav>
  );
}
