// 이미지 파일을 canvas로 축소·JPEG 재인코딩한 "미리보기용 썸네일" File을 만든다(브라우저 전용).
//
// 왜 클라에서 굽나: 백엔드가 CF Workers라 sharp 같은 네이티브 이미지 처리를 못 쓰고,
// Supabase render/image 변환은 Accept 협상으로 WebP를 내보내 Safari가 미리보기를 못 띄운다(2026-06-21 회귀).
// 그래서 업로드 시점에 브라우저가 직접 JPEG 썸네일을 구워 원본과 함께 올린다(모든 브라우저가 JPEG 렌더 가능).
//
// 디코딩 불가 포맷(일부 HEIC 등)이거나 canvas 미지원이면 null → 호출부는 썸네일 없이 원본만 올리고
// 미리보기도 원본으로 폴백한다. (document-merge.ts의 imageBlobToJpeg와 같은 canvas 패턴.)
export async function createImageThumbnail(file: File, maxEdge = 1280, quality = 0.72): Promise<File | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)); // 확대는 안 함
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) return null;
      return new File([blob], "thumb.jpg", { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
