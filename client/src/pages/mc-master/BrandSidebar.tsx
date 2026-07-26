import { useLayoutEffect, useRef } from "react";

import type { CatalogBrand } from "@/lib/catalog";
import { mcMasterViewState } from "./view-state";

export function BrandSidebar({
  brands,
  selectedId,
  onSelect,
  onPrefetch,
}: {
  brands: CatalogBrand[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  // hover/focus 시 해당 브랜드 모델을 미리 받아둬 클릭 즉시 렌더(prefetch).
  onPrefetch?: (id: number) => void;
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
      {list.map((b) => (
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
        </button>
      ))}
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
