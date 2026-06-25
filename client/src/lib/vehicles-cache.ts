import { fetchWorkbenchVehicle, type WorkbenchVehicle } from "./vehicles";

// 견적 워크벤치 수정 진입 prefetch 캐시. trimId 단일 키.
// mc-master catalog-cache의 makeCache와 로직이 닮았으나, /api/vehicles 전용으로 격리(mc-master 경로를
// 건드리지 않기 위해) 별도 구현한다. TTL 60s 신선도 + 동시 호출 inflight dedupe.
const TTL_MS = 60_000;
const cache = new Map<number, { value: WorkbenchVehicle; at: number }>();
const inflight = new Map<number, Promise<WorkbenchVehicle>>();

// 캐시 hit(신선)면 즉시, 아니면 fetch+저장. 동시 호출은 inflight 1요청 공유. 실패 시 캐시 미저장.
export function fetchWorkbenchVehicleCached(trimId: number): Promise<WorkbenchVehicle> {
  const entry = cache.get(trimId);
  if (entry && Date.now() - entry.at < TTL_MS) return Promise.resolve(entry.value);
  const existing = inflight.get(trimId);
  if (existing) return existing;
  const p = fetchWorkbenchVehicle(trimId)
    .then((value) => {
      cache.set(trimId, { value, at: Date.now() });
      return value;
    })
    .finally(() => inflight.delete(trimId));
  inflight.set(trimId, p);
  return p;
}

// 견적 행 hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchWorkbenchVehicle(trimId: number): void {
  void fetchWorkbenchVehicleCached(trimId).catch(() => {});
}
