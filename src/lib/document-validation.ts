// 고객 서류 업로드 검증/정규화(순수). 라우트와 단위테스트가 공유.
export const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20MB

// 이미지 전체 + PDF + 오피스(신규/구형). 미리보기는 이미지·PDF만, 오피스는 다운로드.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.ms-excel", // xls
  "application/msword", // doc
  "application/vnd.ms-powerpoint", // ppt
]);

export function isAllowedMime(mime: string): boolean {
  return mime.startsWith("image/") || ALLOWED_MIME.has(mime);
}

// 파일명에서 경로 구분자·앞쪽 점·공백류를 제거해 Storage 키에 안전한 basename으로.
// 표시는 원본 file_name을 쓰고, 경로에만 이 안전화본을 쓴다. 한글은 유지.
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- 파일명 안전화: 제어문자(0x00-0x1f)·DEL(0x7f) 의도적 제거
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, "_") // 공백류 → _
    .replace(/^\.+/, "_") // 선행 점(.hidden) → _
    .slice(0, 120);
  return cleaned || "file";
}
