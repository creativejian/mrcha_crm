import type { CatalogBrand } from "@/lib/catalog";

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
            <img src={b.logoUrl} alt="" className="va-brand-logo" loading="lazy" decoding="async" />
          ) : (
            <span className="va-brand-logo" />
          )}
          <span>{b.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <nav className="va-brand-sidebar" aria-label="브랜드">
      {domestic.length > 0 && group("국산차", domestic)}
      {imported.length > 0 && group("수입차", imported)}
    </nav>
  );
}
