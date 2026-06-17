import type { CatalogBrand } from "@/lib/catalog";

export function BrandSidebar({
  brands,
  selectedId,
  onSelect,
}: {
  brands: CatalogBrand[];
  selectedId: number | null;
  onSelect: (id: number) => void;
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
        >
          {b.logoUrl ? <img src={b.logoUrl} alt="" className="va-brand-logo" /> : <span className="va-brand-logo" />}
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
