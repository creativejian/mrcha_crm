import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { type Customer } from "@/data/customers";
import { addMemo, updateMemo, deleteMemo } from "@/lib/customer-children";
import { formatActivity, type CustomerDetailData } from "@/lib/customers";
import { formatKoreanShortTime } from "@/lib/kim-detail-utils";
import { sortKimCustomerMemosByCreatedAt, type KimCustomerMemoItem } from "@/lib/kim-schedule";

type UseCustomerMemosArgs = {
  detail: CustomerDetailData; // 초기 customerMemos 매핑 소스
  customer: Customer; // customer.id (API)
  onToast: (message: string) => void;
  markRecentUpdate: (section: string) => void; // 부모 소유 recentUpdate 갱신(헤더가 사용) — 콜백 주입
};

export function useCustomerMemos({ detail, customer, onToast, markRecentUpdate }: UseCustomerMemosArgs) {
  const [customerMemos, setCustomerMemos] = useState<KimCustomerMemoItem[]>(() =>
    detail.memos.map((m) => ({
      id: m.id,
      body: m.body ?? "",
      createdAt: formatActivity(m.createdAt),
    })),
  );
  const [addingCustomerMemo, setAddingCustomerMemo] = useState(false);
  const [editingCustomerMemoId, setEditingCustomerMemoId] = useState<string | null>(null);
  const [confirmingCustomerMemoDeleteId, setConfirmingCustomerMemoDeleteId] = useState<string | null>(null);

  const customerMemoDeleteRef = useRef<HTMLDivElement>(null);
  const customerMemoEditRef = useRef<HTMLFormElement>(null);
  const customerMemoBodyRef = useRef<HTMLDivElement>(null);

  const sortedCustomerMemos = sortKimCustomerMemosByCreatedAt(customerMemos);

  useEffect(() => {
    const container = customerMemoBodyRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [customerMemos.length, addingCustomerMemo]);

  useEffect(() => {
    if (!confirmingCustomerMemoDeleteId) return;

    function closeConfirm(event: PointerEvent) {
      if (customerMemoDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingCustomerMemoDeleteId(null);
    }

    function closeConfirmByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCustomerMemoDeleteId(null);
    }

    document.addEventListener("pointerdown", closeConfirm, true);
    document.addEventListener("keydown", closeConfirmByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeConfirm, true);
      document.removeEventListener("keydown", closeConfirmByKeyboard);
    };
  }, [confirmingCustomerMemoDeleteId]);

  useEffect(() => {
    if (!editingCustomerMemoId) return;

    function cancelMemoEdit(event: PointerEvent) {
      if (customerMemoEditRef.current?.contains(event.target as Node)) return;
      setEditingCustomerMemoId(null);
    }

    function cancelMemoEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setEditingCustomerMemoId(null);
    }

    document.addEventListener("pointerdown", cancelMemoEdit, true);
    document.addEventListener("keydown", cancelMemoEditByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", cancelMemoEdit, true);
      document.removeEventListener("keydown", cancelMemoEditByKeyboard);
    };
  }, [editingCustomerMemoId]);

  function saveCustomerMemo(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const tempId = `kim-customer-memo-${Date.now()}`;
    setCustomerMemos((current) => [...current, { id: tempId, body, createdAt: formatKoreanShortTime() }]);
    setAddingCustomerMemo(false);
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모가 추가되었습니다.");
    if (!customer.id) return;
    void addMemo(customer.id, { body })
      .then((res) => setCustomerMemos((current) => current.map((m) => (m.id === tempId ? { ...m, id: res.id, createdAt: formatActivity(res.createdAt) } : m))))
      .catch(() => { setCustomerMemos((current) => current.filter((m) => m.id !== tempId)); onToast("저장에 실패했습니다"); });
  }

  function updateCustomerMemo(event: SyntheticEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.map((item) => (
      item.id === id ? { ...item, body } : item
    )));
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateMemo(customer.id, id, { body }).catch(() => { setCustomerMemos(prevMemos); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteCustomerMemo(id: string) {
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.filter((item) => item.id !== id));
    setEditingCustomerMemoId((current) => (current === id ? null : current));
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteMemo(customer.id, id).catch(() => { setCustomerMemos(prevMemos); onToast("삭제에 실패했습니다"); });
    }
  }

  // 부모 onEditorOpenChange OR용: 메모 추가/수정/삭제확인 중 하나라도 열려 있으면 true
  const editorOpen = addingCustomerMemo || editingCustomerMemoId !== null || confirmingCustomerMemoDeleteId !== null;

  return {
    memos: sortedCustomerMemos,
    count: customerMemos.length, // JSX 카운트 배지는 정렬 전 원본 길이 사용
    adding: addingCustomerMemo,
    editingId: editingCustomerMemoId,
    confirmingDeleteId: confirmingCustomerMemoDeleteId,
    editorOpen,
    refs: { bodyRef: customerMemoBodyRef, deleteRef: customerMemoDeleteRef, editRef: customerMemoEditRef },
    handlers: {
      toggleAdd: () => {
        setEditingCustomerMemoId(null);
        setAddingCustomerMemo((current) => !current);
      },
      cancelAdd: () => setAddingCustomerMemo(false),
      save: saveCustomerMemo,
      startEdit: (id: string) => {
        setAddingCustomerMemo(false);
        setEditingCustomerMemoId(id);
      },
      cancelEdit: () => setEditingCustomerMemoId(null),
      update: updateCustomerMemo,
      requestDelete: (id: string) => {
        setEditingCustomerMemoId(null);
        setConfirmingCustomerMemoDeleteId((current) => (current === id ? null : id));
      },
      confirmDelete: deleteCustomerMemo,
      cancelDelete: () => setConfirmingCustomerMemoDeleteId(null),
    },
  };
}
