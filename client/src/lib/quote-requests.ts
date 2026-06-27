import { formatActivity } from "./customers";
import { getJson } from "./http";
import { formatPriceRangeKorean } from "./price-format";

// 백엔드 listQuoteRequests 응답 1행(camelCase, null 가능).
export type AppQuoteRequestRow = {
  id: string;
  createdAt: string;
  requesterName: string | null;
  requesterPhone: string | null;
  paymentMethod: string | null;
  period: number | null;
  depositType: string | null;
  rentalDeposit: number | null;
  trimPrice: number | null;
  status: string | null;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  optionCount: number;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedCustomerCode: string | null;
  matchType: "app_user" | "phone" | "none";
};

// 앱 enum → 한글. Flutter 앱 SSOT(purchase_method.dart / deposit_type.dart / quote_status.dart)와 일치.
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  lease: "운용리스",
  rent: "장기렌트",
  installment: "할부",
  cash: "일시불",
};
const DEPOSIT_TYPE_LABEL: Record<string, string> = {
  deposit: "보증금",
  advance: "선수금",
  prepayment: "선납금",
};
const STATUS_LABEL: Record<string, string> = {
  open: "진행중",
  closed: "마감",
  completed: "완료",
};

// 화면 표시용 견적요청 1행.
export type AppQuoteRequest = {
  id: string;
  createdAt: string;
  requesterName: string;
  vehicleLabel: string;
  paymentLabel: string;
  periodLabel: string;
  depositLabel: string;
  trimPriceLabel: string;
  optionLabel: string;
  statusLabel: string;
  matchLabel: string;
  matchType: AppQuoteRequestRow["matchType"];
};

function moneyOrDash(won: number | null): string {
  return won != null && won > 0 ? formatPriceRangeKorean(won, null) : "—";
}

export function toAppQuoteRequest(row: AppQuoteRequestRow): AppQuoteRequest {
  const vehicleLabel =
    [row.brandName, row.modelName].filter(Boolean).join(" ") +
    (row.trimName ? ` · ${row.trimName}` : "");
  const depositName = row.depositType ? (DEPOSIT_TYPE_LABEL[row.depositType] ?? row.depositType) : null;
  const depositMoney = row.rentalDeposit != null && row.rentalDeposit > 0 ? ` ${formatPriceRangeKorean(row.rentalDeposit, null)}` : "";
  const matchLabel =
    row.matchType === "app_user"
      ? `연결됨 ${row.matchedCustomerName ?? ""}`.trim()
      : row.matchType === "phone"
        ? row.matchedCustomerName
          ? `기존 고객 ${row.matchedCustomerName}(추정)`
          : "기존 고객(추정)"
        : "신규(미연결)";
  return {
    id: row.id,
    createdAt: formatActivity(row.createdAt),
    requesterName: row.requesterName ?? "이름없음",
    vehicleLabel: vehicleLabel || "차량 미지정",
    paymentLabel: row.paymentMethod ? (PAYMENT_METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod) : "—",
    periodLabel: row.period != null ? `${row.period}개월` : "—",
    depositLabel: depositName ? `${depositName}${depositMoney}` : "—",
    trimPriceLabel: moneyOrDash(row.trimPrice),
    optionLabel: row.optionCount > 0 ? `${row.optionCount}개` : "없음",
    statusLabel: row.status ? (STATUS_LABEL[row.status] ?? row.status) : "—",
    matchLabel,
    matchType: row.matchType,
  };
}

export async function fetchAppQuoteRequests(): Promise<AppQuoteRequest[]> {
  return (await getJson<AppQuoteRequestRow[]>("/api/quote-requests")).map(toAppQuoteRequest);
}
