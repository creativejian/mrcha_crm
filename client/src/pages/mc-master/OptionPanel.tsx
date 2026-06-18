import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  type CatalogOption,
  type CatalogTrim,
  type OptionRelation,
  type OptionType,
  createOption,
  deleteOption,
  fetchOptions,
  setNoOption,
  unsetNoOption,
  updateOption,
} from "@/lib/catalog";
import { excludeGroups } from "@/lib/option-selection";
import { EditDrawer } from "./EditDrawer";
import { EXCLUDE_PALETTE, excludesText, includesText } from "./option-relations";
import { formatThousands, manwonText, parseManwon } from "./trim-format";

// 트림 옵션 패널: 기본/튜닝 탭 + 인라인 추가/편집/삭제. 옵션 0개면 '옵션 없음 확정' 토글.
// includes/excludes(관계)는 색 점·⇄/⇒ 설명으로 표식만 표시(편집은 Phase 2). 가격은 만원 단위.
export function OptionPanel({
  trim,
  canEdit,
  initialNoOption,
  onClose,
  onChanged,
}: {
  trim: CatalogTrim;
  canEdit: boolean;
  initialNoOption: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [relations, setRelations] = useState<OptionRelation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<OptionType>("basic");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noOption, setNoOptionState] = useState(initialNoOption);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    let alive = true;
    fetchOptions(trim.id)
      .then((b) => {
        if (!alive) return;
        setOptions(b.options);
        setRelations(b.relations);
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : "불러오기 실패");
      });
    return () => {
      alive = false;
    };
  }, [trim.id]);

  const basic = options.filter((o) => o.type === "basic");
  const tuning = options.filter((o) => o.type === "tuning");
  const current = tab === "basic" ? basic : tuning;
  const nameById = new Map(options.map((o) => [o.id, o.name]));
  const groups = excludeGroups(options, relations);
  const hasExcludes = relations.some((r) => r.type === "excludes");

  function resetForm() {
    setAdding(false);
    setEditId(null);
    setName("");
    setPrice("");
    setErr(null);
  }
  function reload() {
    fetchOptions(trim.id)
      .then((b) => {
        setOptions(b.options);
        setRelations(b.relations);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "불러오기 실패"));
  }
  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  function submitAdd() {
    if (name.trim() === "") return;
    void withBusy(async () => {
      await createOption(trim.id, { type: tab, name: name.trim(), price: parseManwon(price) });
      resetForm();
      reload();
    });
  }
  function submitEdit() {
    if (editId == null || name.trim() === "") return;
    void withBusy(async () => {
      await updateOption(editId, { name: name.trim(), price: parseManwon(price) });
      resetForm();
      reload();
    });
  }
  function del(o: CatalogOption) {
    if (!window.confirm(`'${o.name}' 옵션을 삭제할까요?`)) return;
    void withBusy(async () => {
      await deleteOption(o.id);
      reload();
    });
  }
  function toggleNoOption() {
    void withBusy(async () => {
      if (noOption) {
        await unsetNoOption(trim.id);
        setNoOptionState(false);
      } else {
        await setNoOption(trim.id);
        setNoOptionState(true);
      }
    });
  }
  function startEdit(o: CatalogOption) {
    setAdding(false);
    setEditId(o.id);
    setName(o.name);
    setPrice(o.price != null ? formatThousands(String(o.price / 10000)) : "");
    setErr(null);
  }

  const editor = (onSubmit: () => void, submitLabel: string) => (
    <div className="va-opt-edit">
      <input className="input" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="옵션명" />
      <input
        className="input va-num"
        inputMode="numeric"
        value={price}
        onChange={(e) => setPrice(formatThousands(e.currentTarget.value))}
        placeholder="가격(미정 시 빈칸)"
      />
      <span className="va-opt-unit">만원</span>
      <button type="button" className="btn primary" disabled={busy || name.trim() === ""} onClick={onSubmit}>
        {submitLabel}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={resetForm}>
        취소
      </button>
    </div>
  );

  return (
    <EditDrawer
      title={`옵션 관리 · ${trim.trimName}`}
      ariaLabel="옵션 관리"
      onClose={onClose}
      className="va-opt-drawer"
    >
      <div className="va-trim-tabs">
        <button
          type="button"
          className={`va-trim-tab${tab === "basic" ? " active" : ""}`}
          onClick={() => {
            setTab("basic");
            resetForm();
          }}
        >
          기본 옵션 ({basic.length})
        </button>
        <button
          type="button"
          className={`va-trim-tab${tab === "tuning" ? " active" : ""}`}
          onClick={() => {
            setTab("tuning");
            resetForm();
          }}
        >
          튜닝 옵션 ({tuning.length})
        </button>
      </div>

      {hasExcludes && (
        <div className="va-opt-legend">
          <span className="va-opt-dot" style={{ background: EXCLUDE_PALETTE[0] }} />
          <span className="va-opt-dot" style={{ background: EXCLUDE_PALETTE[1] }} />
          <span className="va-opt-dot" style={{ background: EXCLUDE_PALETTE[2] }} />
          같은 색 = 중복 선택 불가
        </div>
      )}

      {loaded && current.length === 0 && <div className="va-empty">옵션이 없습니다.</div>}

      <ul className="va-opt-list">
        {current.map((o) => {
          const gi = groups.get(o.id);
          const dot = gi != null ? EXCLUDE_PALETTE[gi % EXCLUDE_PALETTE.length] : null;
          const exText = excludesText(relations, o.id, nameById);
          const inText = includesText(relations, o.id, nameById);
          return (
            <li key={o.id} className="va-opt-row">
              {editId === o.id ? (
                editor(submitEdit, "저장")
              ) : (
                <>
                  <span className="va-opt-dot-slot">
                    {dot && <span className="va-opt-dot" style={{ background: dot }} />}
                  </span>
                  <span className="va-opt-main">
                    <span className="va-opt-name">{o.name}</span>
                    {exText && <span className="va-opt-rel">⇄ {exText}</span>}
                    {inText && <span className="va-opt-rel">⇒ {inText}</span>}
                  </span>
                  <span className="va-opt-price va-num">{manwonText(o.price)}</span>
                  {canEdit && (
                    <span className="va-opt-actions">
                      <button
                        type="button"
                        className="tiny-btn"
                        aria-label={`${o.name} 수정`}
                        onClick={() => startEdit(o)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="tiny-btn va-danger"
                        aria-label={`${o.name} 삭제`}
                        onClick={() => del(o)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && adding && editor(submitAdd, "추가")}
      {canEdit && !adding && editId == null && !noOption && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            resetForm();
            setAdding(true);
          }}
        >
          <Plus size={14} /> {tab === "basic" ? "기본" : "튜닝"} 옵션 추가
        </button>
      )}

      {canEdit && options.length === 0 && (
        <div className="va-opt-noopt">
          <button
            type="button"
            className={`btn${noOption ? " va-select-on" : ""}`}
            disabled={busy}
            onClick={toggleNoOption}
          >
            {noOption ? "옵션 없음 확정 해제" : "옵션 없음으로 확정"}
          </button>
          <span className="va-muted">
            {noOption ? "옵션 없음으로 확정됨 (배지 ✓)" : "옵션이 없는 트림이면 확정하세요 (배지 ? → ✓)"}
          </span>
        </div>
      )}

      {err && <div className="notice-box error">{err}</div>}
    </EditDrawer>
  );
}
