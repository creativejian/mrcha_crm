import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { type Customer } from "@/data/customers";
import { addTask, updateTask, deleteTask } from "@/lib/customer-children";
import { type CustomerDetailData } from "@/lib/customers";
import { formatShortDateLabel, kimCheckDueOptions, kimCheckDueSelection } from "@/lib/detail-utils";
import { sortKimCheckItemsByWorkRule, type KimCheckItem } from "@/lib/schedule-items";

type UseCustomerChecksArgs = {
  detail: CustomerDetailData; // 초기 checkItems / completedCheckItems 매핑 소스
  customer: Customer; // customer.id (API)
  onToast: (message: string) => void;
  markRecentUpdate: (section: string) => void; // 부모 소유 recentUpdate 갱신(헤더가 사용) — 콜백 주입
  // 전체보기 목록의 "상담 메모"는 최신 미완료 task body라, task 변경 성공 시 목록을 재페치한다.
  onCustomerListChanged?: () => void;
};

export function useCustomerChecks({ detail, customer, onToast, markRecentUpdate, onCustomerListChanged }: UseCustomerChecksArgs) {
  const [checkItems, setCheckItems] = useState<KimCheckItem[]>(() =>
    detail.tasks.map((t) => ({
      id: t.id,
      category: t.category ?? "",
      due: t.due ?? "",
      body: t.body ?? "",
    })),
  );
  const [completedCheckItems, setCompletedCheckItems] = useState<string[]>(() =>
    detail.tasks.filter((t) => t.done).map((t) => t.id),
  );
  const [addingCheckItem, setAddingCheckItem] = useState(false);
  const [selectedCheckDue, setSelectedCheckDue] = useState("오늘");
  const [selectedEditingCheckDue, setSelectedEditingCheckDue] = useState("오늘");
  const [editingCheckItemId, setEditingCheckItemId] = useState<string | null>(null);
  const [confirmingCheckItemTitle, setConfirmingCheckItemTitle] = useState<string | null>(null);
  const [confirmingCheckItemDeleteId, setConfirmingCheckItemDeleteId] = useState<string | null>(null);

  const checkConfirmRef = useRef<HTMLDivElement>(null);
  const checkDeleteRef = useRef<HTMLDivElement>(null);
  const checkEditRef = useRef<HTMLFormElement>(null);
  const checkBodyRef = useRef<HTMLDivElement>(null);

  const remainingCheckCount = checkItems.filter((item) => !completedCheckItems.includes(item.id)).length;
  const sortedCheckItems = sortKimCheckItemsByWorkRule(checkItems, completedCheckItems);

  function openCheckItemEdit(item: KimCheckItem) {
    setAddingCheckItem(false);
    setConfirmingCheckItemTitle(null);
    setSelectedEditingCheckDue(kimCheckDueSelection(item.due));
    setEditingCheckItemId(item.id);
  }

  function cancelCheckItemEdit() {
    setEditingCheckItemId(null);
    setSelectedEditingCheckDue("오늘");
  }

  useEffect(() => {
    if (!confirmingCheckItemTitle) return;

    function closeCheckConfirm(event: PointerEvent) {
      if (checkConfirmRef.current?.contains(event.target as Node)) return;
      setConfirmingCheckItemTitle(null);
    }

    function closeCheckConfirmByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCheckItemTitle(null);
    }

    document.addEventListener("pointerdown", closeCheckConfirm, true);
    document.addEventListener("keydown", closeCheckConfirmByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeCheckConfirm, true);
      document.removeEventListener("keydown", closeCheckConfirmByKeyboard);
    };
  }, [confirmingCheckItemTitle]);

  useEffect(() => {
    if (!confirmingCheckItemDeleteId) return;

    function closeCheckDelete(event: PointerEvent) {
      if (checkDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingCheckItemDeleteId(null);
    }

    function closeCheckDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCheckItemDeleteId(null);
    }

    document.addEventListener("pointerdown", closeCheckDelete, true);
    document.addEventListener("keydown", closeCheckDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeCheckDelete, true);
      document.removeEventListener("keydown", closeCheckDeleteByKeyboard);
    };
  }, [confirmingCheckItemDeleteId]);

  useEffect(() => {
    if (!editingCheckItemId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = checkBodyRef.current;
      const form = checkEditRef.current;
      if (!container || !form) return;
      const containerRect = container.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const bottomOverflow = formRect.bottom - containerRect.bottom + 8;
      const topOverflow = containerRect.top - formRect.top + 8;
      if (bottomOverflow > 0) container.scrollTop += bottomOverflow;
      else if (topOverflow > 0) container.scrollTop -= topOverflow;
    });

    function cancelCheckEdit(event: PointerEvent) {
      if (checkEditRef.current?.contains(event.target as Node)) return;
      cancelCheckItemEdit();
    }

    function cancelCheckEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") cancelCheckItemEdit();
    }

    document.addEventListener("pointerdown", cancelCheckEdit, true);
    document.addEventListener("keydown", cancelCheckEditByKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", cancelCheckEdit, true);
      document.removeEventListener("keydown", cancelCheckEditByKeyboard);
    };
  }, [editingCheckItemId]);

  function saveCheckItem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const category = String(formData.get("category") ?? "체크");
    const dueSelection = String(formData.get("due") ?? "오늘");
    const dueDate = String(formData.get("dueDate") ?? "");
    if (dueSelection === "지정" && !dueDate) {
      onToast("마감 날짜를 선택해주세요.");
      return;
    }
    const due = dueSelection === "지정" ? formatShortDateLabel(dueDate) : dueSelection;
    const tempId = `kim-check-${Date.now()}`;
    setCheckItems((current) => [...current, { id: tempId, category, due, body }]);
    setAddingCheckItem(false);
    setSelectedCheckDue("오늘");
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일이 추가되었습니다.");
    if (!customer.id) return;
    void addTask(customer.id, { category, due, body })
      .then((res) => { setCheckItems((current) => current.map((t) => (t.id === tempId ? { ...t, id: res.id } : t))); onCustomerListChanged?.(); })
      .catch(() => { setCheckItems((current) => current.filter((t) => t.id !== tempId)); onToast("저장에 실패했습니다"); });
  }

  function updateCheckItem(event: SyntheticEvent<HTMLFormElement>, id: string, currentDue: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const category = String(formData.get("category") ?? "체크");
    const dueSelection = String(formData.get("due") ?? currentDue);
    const dueDate = String(formData.get("dueDate") ?? "");
    const currentDueIsCustom = !kimCheckDueOptions.includes(currentDue);
    if (dueSelection === "지정" && !dueDate && !currentDueIsCustom) {
      onToast("마감 날짜를 선택해주세요.");
      return;
    }
    const due = dueSelection === "지정" ? (dueDate ? formatShortDateLabel(dueDate) : currentDue) : dueSelection;
    const prevCheckItems = checkItems;
    setCheckItems((current) => current.map((item) => (
      item.id === id ? { ...item, category, due, body } : item
    )));
    cancelCheckItemEdit();
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { category, due, body }).then(() => onCustomerListChanged?.()).catch(() => { setCheckItems(prevCheckItems); onToast("저장에 실패했습니다"); });
    }
  }

  function toggleCheckItem(id: string) {
    const nextDone = !completedCheckItems.includes(id);
    const prevCompleted = completedCheckItems;
    setCompletedCheckItems((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
    setConfirmingCheckItemTitle(null);
    markRecentUpdate("해야 할 일");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { done: nextDone }).then(() => onCustomerListChanged?.()).catch(() => { setCompletedCheckItems(prevCompleted); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteCheckItem(id: string) {
    const prevCheckItems = checkItems;
    const prevCompleted = completedCheckItems;
    setCheckItems((current) => current.filter((item) => item.id !== id));
    setCompletedCheckItems((current) => current.filter((itemId) => itemId !== id));
    setEditingCheckItemId((current) => (current === id ? null : current));
    setConfirmingCheckItemTitle(null);
    setConfirmingCheckItemDeleteId(null);
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteTask(customer.id, id).then(() => onCustomerListChanged?.()).catch(() => { setCheckItems(prevCheckItems); setCompletedCheckItems(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
  }

  // 부모 onEditorOpenChange OR용: 추가 또는 수정 중이면 true(원본 동작 그대로 — confirming은 제외)
  const editorOpen = addingCheckItem || editingCheckItemId !== null;

  return {
    items: sortedCheckItems,
    completedIds: completedCheckItems,
    remainingCount: remainingCheckCount,
    adding: addingCheckItem,
    editingId: editingCheckItemId,
    selectedDue: selectedCheckDue,
    selectedEditingDue: selectedEditingCheckDue,
    confirming: { title: confirmingCheckItemTitle, deleteId: confirmingCheckItemDeleteId },
    editorOpen,
    refs: { bodyRef: checkBodyRef, confirmRef: checkConfirmRef, deleteRef: checkDeleteRef, editRef: checkEditRef },
    handlers: {
      toggleAdd: () => {
        cancelCheckItemEdit();
        setAddingCheckItem((current) => {
          if (current) setSelectedCheckDue("오늘");
          return !current;
        });
      },
      cancelAdd: () => {
        setAddingCheckItem(false);
        setSelectedCheckDue("오늘");
      },
      save: saveCheckItem,
      startEdit: openCheckItemEdit,
      cancelEdit: cancelCheckItemEdit,
      update: updateCheckItem,
      toggleDone: toggleCheckItem,
      requestComplete: (id: string) => {
        cancelCheckItemEdit();
        setConfirmingCheckItemDeleteId(null);
        setConfirmingCheckItemTitle((current) => (current === id ? null : id));
      },
      cancelComplete: () => setConfirmingCheckItemTitle(null),
      requestDelete: (id: string) => {
        cancelCheckItemEdit();
        setConfirmingCheckItemTitle(null);
        setConfirmingCheckItemDeleteId((current) => (current === id ? null : id));
      },
      cancelDelete: () => setConfirmingCheckItemDeleteId(null),
      confirmDelete: deleteCheckItem,
      setDue: (option: string) => setSelectedCheckDue(option),
      setEditingDue: (option: string) => setSelectedEditingCheckDue(option),
    },
  };
}
