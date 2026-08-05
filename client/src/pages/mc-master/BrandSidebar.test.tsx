// 브랜드 목록 배지 두 축(2026-08-05) — 빨강(승인 대기)·파랑(고유번호 미부여)이 한 줄에 같이 뜬다.
// 순서가 흔들리면 색을 매번 다시 읽게 되므로 **빨강 → 파랑**을 계약으로 잠근다(유슨생 결정).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CatalogBrand } from "@/lib/catalog";
import { BrandSidebar } from "./BrandSidebar";

const BRANDS: CatalogBrand[] = [{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }];

function renderSidebar(overrides: Partial<Parameters<typeof BrandSidebar>[0]> = {}) {
  return render(<BrandSidebar brands={BRANDS} selectedId={null} onSelect={() => {}} {...overrides} />);
}

describe("BrandSidebar 배지", () => {
  it("승인 대기(빨강)와 고유번호 미부여(파랑)를 함께 표시한다", () => {
    renderSidebar({ pendingByBrand: new Map([[1, 2]]), gapsByBrand: { 1: 7 } });

    expect(screen.getByLabelText("현대 승인 대기 2건")).toHaveTextContent("2");
    expect(screen.getByLabelText("현대 고유번호 미부여 7건")).toHaveTextContent("7");
  });

  it("둘 다 있으면 빨강이 먼저다 — 순서가 흔들리면 색을 매번 다시 읽게 된다", () => {
    const { container } = renderSidebar({ pendingByBrand: new Map([[1, 2]]), gapsByBrand: { 1: 7 } });

    const badges = [...container.querySelectorAll(".count-badge")];
    expect(badges.map((b) => (b.classList.contains("tone-pending") ? "pending" : "gap"))).toEqual(["pending", "gap"]);
  });

  it("0이거나 데이터가 없으면 그 배지를 그리지 않는다", () => {
    renderSidebar({ pendingByBrand: new Map([[1, 0]]), gapsByBrand: { 1: 0 } });

    expect(screen.queryByLabelText(/승인 대기/)).toBeNull();
    expect(screen.queryByLabelText(/고유번호 미부여/)).toBeNull();
  });
});
