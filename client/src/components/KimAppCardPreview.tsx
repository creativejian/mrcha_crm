import type { AppCardModel } from "@/lib/kim-app-card";

// 고객 앱 견적카드 미리보기. 워크벤치 우측 상시 + 확대 모달에서 동일 컴포넌트를 재사용한다.
// model 1개만 받고 DOM/state를 직접 읽지 않는다(조립은 부모 워크벤치 책임).
// 주의: D-6 / "미확인 견적"은 발송 상태값(미리보기 맥락)이라 현행 mock 유지.
export function KimAppCardPreview({ model, inModal = false }: { model: AppCardModel; inModal?: boolean }) {
  return (
    <aside className={`kim-app-card-preview${inModal ? " in-modal" : ""}`} aria-label="앱 견적카드 미리보기">
      <div className="kim-app-card">
        <div className="kim-app-card-status">
          <strong>🔔 미확인 견적</strong>
          <span>● D-6</span>
        </div>
        <div className="kim-app-card-body">
          <div className="kim-app-card-hero">
            <div>
              <span>{model.brand}</span>
              <strong>{model.modelLabel}<br />{model.trimLabel}</strong>
              <p>{[model.yearLabel, `${model.basePriceLabel}원`, "기본 제공 옵션"].filter(Boolean).join(" ㅣ ")}</p>
            </div>
            <div>
              <b>{model.purchaseMethod}</b>
              <b>{model.termLabel}</b>
            </div>
          </div>

          <div className="kim-app-pay-box">
            <span>월 납입금</span>
            <strong>{model.monthlyLabel}</strong>
            <em>금리 {model.rateLabel}</em>
            <p>잔존가치 {model.residualLabel} · 총 비용 {model.totalCostLabel}</p>
          </div>

          <div className="kim-app-discount-box">
            <span>최대 할인 적용</span>
            <strong>-{model.discountLabel}원</strong>
          </div>

          <div className="kim-app-mini-grid">
            <div><span>보증금</span><strong>{model.depositLabel}</strong></div>
            <div><span>주행거리</span><strong>{model.mileageLabel}</strong></div>
          </div>

          <div className="kim-app-detail-block">
            <header>🚗 출고 시기 정보</header>
            <dl>
              <dt>외장 컬러</dt><dd>{model.exteriorColorLabel}</dd>
              <dt>내장 컬러</dt><dd>{model.interiorColorLabel}</dd>
              <dt>재고 여부</dt><dd className="green">{model.stockNotice}</dd>
              <dt>예상 출고</dt><dd>{model.expectedDelivery}</dd>
              <dt>고객 지역</dt><dd>{model.customerRegion}</dd>
            </dl>
          </div>

          <div className="kim-app-detail-block">
            <header>📌 취득원가 구성</header>
            <dl>
              <dt>최종 차량가</dt><dd className="green">{model.finalVehiclePriceLabel}원</dd>
              <dt>등록비용 합계</dt><dd className="green">{model.registrationCostLabel}원</dd>
              <dt>취득원가</dt><dd className="blue">{model.acquisitionCostLabel}원</dd>
            </dl>
          </div>

          <div className="kim-app-detail-block">
            <header>🧾 추천 견적 조건</header>
            {model.hasScenario ? (
              <dl>
                <dt>금융사</dt><dd>{model.lenderLabel}</dd>
                <dt>보증금</dt><dd>{model.depositLabel}</dd>
                <dt>선수금</dt><dd>{model.downPaymentLabel}</dd>
                <dt>최종 월 납입금</dt><dd className="blue">{model.monthlyLabel}</dd>
              </dl>
            ) : (
              <p className="kim-app-detail-empty">조건 저장 후 표시됩니다</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
