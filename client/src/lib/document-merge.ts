import { PDFDocument } from "pdf-lib";

// 서류함의 이미지/PDF를 하나의 PDF로 병합한다(금융사 제출용). 브라우저 전용(canvas·createImageBitmap 의존).

// A4 세로(pt). 이미지 페이지는 이 규격에 비율 유지로 배치한다.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 24;

export type MergeSource = { kind: "image" | "pdf"; blob: Blob };

export type MergeResult = { bytes: Uint8Array; merged: number; skipped: number };

// 이미지 blob을 브라우저 canvas로 JPEG 재인코딩 → bytes + 원본 픽셀 크기.
// progressive JPEG·webp·heic 등 pdf-lib가 직접 못 읽는 포맷도 브라우저 디코딩을 거치므로 안전하게 embed된다.
async function imageBlobToJpeg(blob: Blob, quality = 0.85): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context를 만들 수 없습니다.");
    ctx.drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 인코딩 실패"))), "image/jpeg", quality));
    return { bytes: new Uint8Array(await jpegBlob.arrayBuffer()), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

// 여러 서류(이미지/PDF)를 주어진 순서대로 하나의 PDF로 병합한다.
// 이미지: A4 세로 페이지에 비율 유지(contain·최대 1배) 가운데 배치. PDF: 모든 페이지를 그대로 이어붙임.
// 개별 항목 실패(손상 PDF·디코딩 불가 이미지)는 그 항목만 건너뛰고 skipped로 집계한다.
export async function mergeDocumentsToPdf(sources: MergeSource[]): Promise<MergeResult> {
  const out = await PDFDocument.create();
  let merged = 0;
  let skipped = 0;
  for (const source of sources) {
    try {
      if (source.kind === "pdf") {
        const src = await PDFDocument.load(await source.blob.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((page) => out.addPage(page));
      } else {
        const { bytes, width, height } = await imageBlobToJpeg(source.blob);
        const image = await out.embedJpg(bytes);
        const page = out.addPage([A4_WIDTH, A4_HEIGHT]);
        const maxWidth = A4_WIDTH - PAGE_MARGIN * 2;
        const maxHeight = A4_HEIGHT - PAGE_MARGIN * 2;
        const scale = Math.min(maxWidth / width, maxHeight / height, 1);
        const drawWidth = width * scale;
        const drawHeight = height * scale;
        page.drawImage(image, {
          x: (A4_WIDTH - drawWidth) / 2,
          y: (A4_HEIGHT - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      }
      merged += 1;
    } catch {
      skipped += 1;
    }
  }
  return { bytes: await out.save(), merged, skipped };
}
