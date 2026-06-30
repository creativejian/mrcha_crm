import { ChevronRight } from "lucide-react";

import { formatKimRecentUpdateTime } from "@/lib/kim-detail-utils";

import type { KimRecentUpdate } from "./types";

type CustomerDetailHeaderProps = {
  now: number;
  recentUpdate: KimRecentUpdate;
  name: string;
  customerCode: string;
  receivedLabel: string;
};

export function CustomerDetailHeader({ now, recentUpdate, name, customerCode, receivedLabel }: CustomerDetailHeaderProps) {
  return (
    <section className="customer-detail-summary kim-detail-summary">
      <div className="kim-header-main">
        <div className="kim-header-read">
          <div className="kim-header-primary">
            <h2 className="kim-header-breadcrumb">
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.2} />
              <span>{name}</span>
              <em className="kim-header-code-text num">{customerCode}</em>
              <em className="kim-header-received-text num">{receivedLabel ? `· ${receivedLabel} 접수` : ""}</em>
            </h2>
            <p>
              {formatKimRecentUpdateTime(recentUpdate.updatedAt, now)}{" "}
              <span className="kim-header-update-mark">{recentUpdate.section} 업데이트</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
