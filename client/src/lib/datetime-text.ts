// 날짜/시간 텍스트 입력 정규화 — 네이티브 date/time input은 표시 포맷이 브라우저 로케일을 따라
// (영어 환경 = MM/DD/YYYY·AM/PM) 년/월/일 고정이 불가능해 텍스트 입력으로 대체한다(2026-07-19 유슨생 지시).
// 입력은 유연하게 받고(구분자 -·.·/ 또는 무구분 8자리) 저장값은 YYYY-MM-DD / HH:mm으로 고정.

// "2026-07-19" | "2026.7.19" | "2026/7/19" | "20260719" → "2026-07-19". 실존하지 않는 날짜(2026-02-30 등)·형식 밖 → null.
export function normalizeDateText(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 실존 검증: UTC 재조립 왕복(2026-02-30 → 03-02로 밀리면 불일치)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── 표시 포맷(2026-08-05) ────────────────────────────────────────────────────
// **저장은 하이픈(`YYYY-MM-DD`), 화면 표시는 슬래시(`2026/08/05`)** — 두 축을 구분한다.
// 저장 형식은 서버·DB 계약이라 못 바꾸지만, 화면 어휘는 레포가 이미 슬래시를 쓰고 있었다
// (목록 접수·배정 칸 `26/07/24 23:41` = lib/customers.ts formatActivity). 새로 만든 칸만
// 하이픈이라 한 화면에서 두 표기가 섞였고(2026-08-05 유슨생 지적), 표시 SSOT가 없어서 생긴 일이다.
// ⚠️ **읽기 전용 표시에만 쓴다.** 입력 필드(DateTextField)에 걸면 controlled value가 저장 형식과
// 달라져 타이핑 중 부분 입력·정규화가 꼬인다(입력은 `normalizeDateText`가 슬래시도 이미 받는다).
export function formatDateDisplay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  // 형식 밖이면 **원문을 그대로 돌려준다** — 표시 함수가 값을 삼키면 화면에서 데이터가 사라진다.
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
}

// "" → {ok:true, value:null}(시간 없음 허용) · "9:30"|"0930" → {ok:true, value:"09:30"} · 형식 밖/범위 밖 → {ok:false}.
export type TimeTextResult = { ok: true; value: string | null } | { ok: false };
export function normalizeTimeText(raw: string): TimeTextResult {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(\d{1,2}):(\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return { ok: false };
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return { ok: false };
  return { ok: true, value: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}
