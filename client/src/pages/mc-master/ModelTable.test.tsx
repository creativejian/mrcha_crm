// 모델 목록의 "행 전체 클릭" 계약(2026-08-05). 진입 대상이 모델명 텍스트에서 행으로 옮겨가면서
// 행 안의 다른 조작(수정 버튼·선택 모드)과 한 클릭에 겹칠 여지가 생겼다 — 그 경계를 잠근다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogModel } from "@/lib/catalog";
import { ModelTable } from "./ModelTable";

const MODEL: CatalogModel = {
  id: 10,
  name: "캐스퍼",
  category: "경형 세단",
  status: "판매중",
  sortOrder: 1,
  modelCode: 1,
  imageUrl: null,
  trimCount: 20,
  minPrice: 14600000,
  maxPrice: 21250000,
};

function renderTable(overrides: Partial<Parameters<typeof ModelTable>[0]> = {}) {
  const onOpen = vi.fn();
  const onEdit = vi.fn();
  const onPrefetch = vi.fn();
  render(
    <ModelTable
      models={[MODEL]}
      canEdit
      selectMode={false}
      selected={new Set()}
      draggingId={null}
      onOpen={onOpen}
      onEdit={onEdit}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onDragStart={() => {}}
      onDragOver={() => {}}
      onDrop={() => {}}
      onPrefetch={onPrefetch}
      {...overrides}
    />,
  );
  return { onOpen, onEdit, onPrefetch };
}

describe("ModelTable 행 클릭", () => {
  it("행 아무 칸이나 누르면 모델을 연다 — 모델명 텍스트에만 매달리지 않는다", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTable();

    // 카테고리 칸(모델명이 아닌 셀)에서 눌러도 진입해야 한다.
    await user.click(screen.getByText("경형 세단"));

    expect(onOpen).toHaveBeenCalledWith(MODEL);
  });

  it("수정 버튼은 편집만 연다 — 행 진입까지 함께 발화하면 안 된다(stopPropagation 그물)", async () => {
    const user = userEvent.setup();
    const { onOpen, onEdit } = renderTable();

    await user.click(screen.getByRole("button", { name: "캐스퍼 수정" }));

    expect(onEdit).toHaveBeenCalledWith(MODEL);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("선택 모드에서는 행 클릭이 진입시키지 않는다 — 그때 클릭은 체크박스·드래그 몫이다", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTable({ selectMode: true });

    await user.click(screen.getByText("경형 세단"));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("행에 마우스를 올리면 트림 뷰를 미리 받는다 — 클릭 영역과 프리페치 영역이 어긋나면 안 된다", async () => {
    const user = userEvent.setup();
    const { onPrefetch } = renderTable();

    await user.hover(screen.getByText("경형 세단"));

    expect(onPrefetch).toHaveBeenCalledWith(MODEL);
  });

  it("승인 대기 배지 — 건수가 있으면 모델명 옆에 표시한다", () => {
    renderTable({ pendingByModel: new Map([[MODEL.id, 6]]) });

    expect(screen.getByLabelText("승인 대기 6건")).toHaveTextContent("6");
  });

  it("승인 대기 0건이면 배지를 그리지 않는다 — 모든 행에 0이 붙으면 신호가 죽는다", () => {
    renderTable({ pendingByModel: new Map([[MODEL.id, 0]]) });

    expect(screen.queryByLabelText(/승인 대기/)).toBeNull();
  });

  it("배지 데이터가 없으면(대기열을 못 받는 역할) 아무 것도 그리지 않는다", () => {
    renderTable();

    expect(screen.queryByLabelText(/승인 대기/)).toBeNull();
  });

  it("키보드 Enter로도 연다 — 링크 버튼을 없앤 만큼 행이 초점을 받아야 한다", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTable();

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onOpen).toHaveBeenCalledWith(MODEL);
  });
});
