// 고객 서류 업로드 검증/정규화(순수). 라우트와 단위테스트가 공유.
export const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20MB

// 이미지 전체 + PDF만. 오피스는 허용하지 않는다(이미지/PDF만 병합 다운로드 대상).
const ALLOWED_MIME = new Set(["application/pdf"]);

export function isAllowedMime(mime: string): boolean {
  return mime.startsWith("image/") || ALLOWED_MIME.has(mime);
}

// 파일명을 Storage 객체 키에 안전한 ASCII basename으로 만든다.
// Supabase Storage 키는 non-ASCII(한글 등)를 "Invalid key"로 거부하므로 제거한다.
// 원본 파일명(한글 포함)은 DB file_name이 보존하므로 표시엔 지장이 없고, 경로는 추적용이다.
// 확장자는 살리고, stem이 비면(예: 한글만인 이름) "file"로 대체한다.
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  const rawStem = dot > 0 ? base.slice(0, dot) : base;
  const rawExt = dot > 0 ? base.slice(dot + 1) : "";
  const toAscii = (s: string) =>
    s
      .replace(/[^\x20-\x7e]/g, "") // printable ASCII 외(한글·제어문자·DEL 등) 제거 — Storage 키 제약
      .replace(/\s+/g, "_") // 공백류 → _
      .replace(/[^A-Za-z0-9._-]/g, ""); // 남은 ASCII 중 안전치 않은 것(괄호·&·! 등) 제거
  const stem = toAscii(rawStem).replace(/^[._]+/, "").slice(0, 80) || "file";
  const ext = toAscii(rawExt).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return ext ? `${stem}.${ext}` : stem;
}
