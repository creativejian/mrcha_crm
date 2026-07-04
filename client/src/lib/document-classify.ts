import { DOC_TYPE_OPTIONS } from "@/data/customers";
import { classifyKimDocumentFile } from "@/lib/detail-utils";

import { createImageThumbnail } from "./image-thumbnail";
import { supabase } from "./supabase";

// File → base64(데이터 부분만, data:URL 접두어 제거).
// FileReader 네이티브 인코딩 사용 — JS 문자 루프+btoa는 수MB PDF에서 메인스레드를 수백ms 멈춘다.
async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("파일 읽기 결과가 문자열이 아님")));
    reader.onerror = () => reject(reader.error ?? new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// source: "ai"=vision 판독 결과, "fallback"=파일명 regex 폴백 — UI 배지가 이 둘을 구분한다(장애 은폐 방지).
export type DocumentClassification = { docType: string; source: "ai" | "fallback" };

// 업로드 전 vision 분류. 항상 유효한 22종 docType을 반환한다(vision → unknown/에러면 파일명 regex 폴백).
export async function classifyDocumentWithAI(file: File): Promise<DocumentClassification> {
  try {
    // 이미지는 경량 썸네일(분류엔 저해상도 충분), PDF는 원본.
    let payloadFile = file;
    if (file.type.startsWith("image/")) {
      const thumb = await createImageThumbnail(file, 1024, 0.7);
      if (thumb) payloadFile = thumb;
    }
    const dataBase64 = await fileToBase64(payloadFile);
    const mimeType = payloadFile.type || file.type;
    const { data, error } = await supabase.functions.invoke("crm-analyst", {
      body: { mimeType, dataBase64, fileName: file.name },
    });
    if (error) throw error;
    const docType = (data as { docType?: string } | null)?.docType;
    if (docType && docType !== "unknown" && DOC_TYPE_OPTIONS.includes(docType)) {
      return { docType, source: "ai" };
    }
  } catch (err) {
    // AI 분류 실패는 사용자에게 노출하지 않고 파일명 regex로 degrade한다. 관측성 위해 로그만 남긴다.
    console.warn("[document-classify] AI 분류 실패, 파일명 regex 폴백", err);
  }
  return { docType: classifyKimDocumentFile(file.name), source: "fallback" };
}
