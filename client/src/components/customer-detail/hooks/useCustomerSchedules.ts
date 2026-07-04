import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { type Customer } from "@/data/customers";
import { addSchedule, updateSchedule as apiUpdateSchedule, deleteSchedule as apiDeleteSchedule } from "@/lib/customer-children";
import { type CustomerDetailData } from "@/lib/customers";
import { nowMs, scheduleTimeFromFormData } from "@/lib/detail-utils";
import { sortKimSchedulesByDateTime, scheduleRecordKey, type KimScheduleItem } from "@/lib/schedule-items";

type UseCustomerSchedulesArgs = {
  detail: CustomerDetailData; // 초기 schedules / completedScheduleKeys 매핑 소스
  customer: Customer; // customer.id (API)
  onToast: (message: string) => void;
  markRecentUpdate: (section: string) => void; // 부모 소유 recentUpdate 갱신(헤더가 사용) — 콜백 주입
  onCloseFloatingEditor: () => void; // saveSchedule이 부모 openEditor를 닫음(원본 setOpenEditor(null) 보존)
};

export function useCustomerSchedules({ detail, customer, onToast, markRecentUpdate, onCloseFloatingEditor }: UseCustomerSchedulesArgs) {
  const [schedules, setSchedules] = useState<KimScheduleItem[]>(() =>
    detail.schedules.map((s) => ({
      id: s.id,
      date: s.scheduledDate ?? "",
      time: s.scheduledTime ?? "",
      type: s.type ?? "",
      memo: s.memo ?? "",
    })),
  );
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>(() =>
    detail.schedules.filter((s) => s.done).map((s) => s.id),
  );
  const [addingScheduleItem, setAddingScheduleItem] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [confirmingScheduleCompleteId, setConfirmingScheduleCompleteId] = useState<string | null>(null);
  const [confirmingScheduleDeleteId, setConfirmingScheduleDeleteId] = useState<string | null>(null);

  const scheduleCompleteRef = useRef<HTMLDivElement>(null);
  const scheduleDeleteRef = useRef<HTMLDivElement>(null);
  const scheduleEditRef = useRef<HTMLFormElement>(null);
  const scheduleBodyRef = useRef<HTMLDivElement>(null);

  const sortedSchedules = sortKimSchedulesByDateTime(schedules);

  useEffect(() => {
    if (!confirmingScheduleCompleteId) return;

    function closeScheduleComplete(event: PointerEvent) {
      if (scheduleCompleteRef.current?.contains(event.target as Node)) return;
      setConfirmingScheduleCompleteId(null);
    }

    function closeScheduleCompleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingScheduleCompleteId(null);
    }

    document.addEventListener("pointerdown", closeScheduleComplete, true);
    document.addEventListener("keydown", closeScheduleCompleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeScheduleComplete, true);
      document.removeEventListener("keydown", closeScheduleCompleteByKeyboard);
    };
  }, [confirmingScheduleCompleteId]);

  useEffect(() => {
    if (!confirmingScheduleDeleteId) return;

    function closeScheduleDelete(event: PointerEvent) {
      if (scheduleDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingScheduleDeleteId(null);
    }

    function closeScheduleDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingScheduleDeleteId(null);
    }

    document.addEventListener("pointerdown", closeScheduleDelete, true);
    document.addEventListener("keydown", closeScheduleDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeScheduleDelete, true);
      document.removeEventListener("keydown", closeScheduleDeleteByKeyboard);
    };
  }, [confirmingScheduleDeleteId]);

  useEffect(() => {
    if (!editingScheduleId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = scheduleBodyRef.current;
      const form = scheduleEditRef.current;
      if (!container || !form) return;
      const containerRect = container.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const bottomOverflow = formRect.bottom - containerRect.bottom + 8;
      const topOverflow = containerRect.top - formRect.top + 8;
      if (bottomOverflow > 0) container.scrollTop += bottomOverflow;
      else if (topOverflow > 0) container.scrollTop -= topOverflow;
    });

    function cancelScheduleEdit(event: PointerEvent) {
      if (scheduleEditRef.current?.contains(event.target as Node)) return;
      setEditingScheduleId(null);
    }

    function cancelScheduleEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setEditingScheduleId(null);
    }

    document.addEventListener("pointerdown", cancelScheduleEdit, true);
    document.addEventListener("keydown", cancelScheduleEditByKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", cancelScheduleEdit, true);
      document.removeEventListener("keydown", cancelScheduleEditByKeyboard);
    };
  }, [editingScheduleId]);

  function saveSchedule(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSchedule = {
      id: `kim-schedule-${nowMs()}`,
      date: String(formData.get("date") ?? ""),
      time: scheduleTimeFromFormData(formData),
      type: String(formData.get("type") ?? "재연락"),
      memo: String(formData.get("memo") ?? "").trim(),
    };
    if (!nextSchedule.date) {
      onToast("예정 날짜를 선택해주세요.");
      return;
    }
    if (!nextSchedule.memo) return;
    setSchedules((current) => [...current, nextSchedule]);
    setAddingScheduleItem(false);
    onCloseFloatingEditor();
    markRecentUpdate("예정 일정");
    onToast("예정 일정이 생성되었습니다.");
    if (!customer.id) return;
    void addSchedule(customer.id, { scheduledDate: nextSchedule.date, scheduledTime: nextSchedule.time, type: nextSchedule.type, memo: nextSchedule.memo })
      .then((res) => setSchedules((current) => current.map((s) => (s.id === nextSchedule.id ? { ...s, id: res.id } : s))))
      .catch(() => { setSchedules((current) => current.filter((s) => s.id !== nextSchedule.id)); onToast("저장에 실패했습니다"); });
  }

  function updateSchedule(event: SyntheticEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date") ?? "");
    const time = scheduleTimeFromFormData(formData);
    const type = String(formData.get("type") ?? "재연락");
    const memo = String(formData.get("memo") ?? "").trim();
    if (!date) {
      onToast("예정 날짜를 선택해주세요.");
      return;
    }
    if (!memo) return;
    const prevSchedules = schedules;
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, date, time, type, memo } : item
    )));
    setEditingScheduleId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, id, { scheduledDate: date, scheduledTime: time, type, memo }).catch(() => { setSchedules(prevSchedules); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteSchedule(id: string) {
    const prevSchedules = schedules;
    const prevCompleted = completedScheduleKeys;
    setSchedules((current) => current.filter((item) => item.id !== id));
    setCompletedScheduleKeys((current) => current.filter((key) => key !== id));
    setEditingScheduleId((current) => (current === id ? null : current));
    setConfirmingScheduleDeleteId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteSchedule(customer.id, id).catch(() => { setSchedules(prevSchedules); setCompletedScheduleKeys(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
  }

  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    const nextDone = !completedScheduleKeys.includes(key);
    const prevCompleted = completedScheduleKeys;
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
    setConfirmingScheduleCompleteId(null);
    markRecentUpdate("예정 일정");
    if (customer.id && !item.id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, item.id, { done: nextDone }).catch(() => { setCompletedScheduleKeys(prevCompleted); onToast("저장에 실패했습니다"); });
    }
  }

  // 부모 onEditorOpenChange OR용: 추가/수정/삭제확인 중 하나라도 열려 있으면 true(원본 그대로 — completeId는 제외)
  const editorOpen = addingScheduleItem || editingScheduleId !== null || confirmingScheduleDeleteId !== null;

  return {
    items: sortedSchedules,
    completedKeys: completedScheduleKeys,
    count: schedules.length, // JSX 카운트 배지는 정렬 전 원본 길이 사용
    adding: addingScheduleItem,
    editingId: editingScheduleId,
    confirming: { completeId: confirmingScheduleCompleteId, deleteId: confirmingScheduleDeleteId },
    editorOpen,
    refs: { bodyRef: scheduleBodyRef, completeRef: scheduleCompleteRef, deleteRef: scheduleDeleteRef, editRef: scheduleEditRef },
    handlers: {
      toggleAdd: () => {
        setEditingScheduleId(null);
        setConfirmingScheduleDeleteId(null);
        setAddingScheduleItem((current) => !current);
      },
      cancelAdd: () => setAddingScheduleItem(false),
      save: saveSchedule,
      startEdit: (id: string) => {
        setAddingScheduleItem(false);
        setConfirmingScheduleDeleteId(null);
        setEditingScheduleId(id);
      },
      cancelEdit: () => setEditingScheduleId(null),
      update: updateSchedule,
      toggleDone: toggleScheduleComplete,
      requestComplete: (id: string) => {
        setEditingScheduleId(null);
        setConfirmingScheduleDeleteId(null);
        setConfirmingScheduleCompleteId((current) => (current === id ? null : id));
      },
      cancelComplete: () => setConfirmingScheduleCompleteId(null),
      requestDelete: (id: string) => {
        setEditingScheduleId(null);
        setConfirmingScheduleCompleteId(null);
        setConfirmingScheduleDeleteId((current) => (current === id ? null : id));
      },
      cancelDelete: () => setConfirmingScheduleDeleteId(null),
      confirmDelete: deleteSchedule,
    },
  };
}
