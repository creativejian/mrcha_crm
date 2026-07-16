import { useEffect, useState } from "react";

// 앱 소유 콘텐츠(인사이트·지식베이스) 읽기 전용 목록↔상세 상태머신 SSOT.
// 두 미러 페이지(InsightsPage·KnowledgeBasePage)가 공유한다.
//
// 핵심 계약(배치 6 C#1): 목록 로드 실패(listError)와 상세 로드 실패(detailError)를 **분리**한다.
// 과거엔 단일 error 플래그를 공유해, 목록 정상 로드 후 한 행의 상세 fetch가 실패하면 정상 목록이
// 통째로 에러 문구로 대체되고 리셋 경로가 없어 새로고침 전까지 복구 불가였다. 이제 상세 실패는
// 목록을 건드리지 않고, closeDetail이 detailError를 리셋한다.
export function useReadonlyContent<L, D>(
  fetchList: () => Promise<L[]>,
  fetchDetail: (id: string) => Promise<D>,
) {
  const [items, setItems] = useState<L[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<D | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchList()
      .then((rows) => { if (alive) setItems(rows); })
      .catch(() => { if (alive) setListError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchList]);

  function openDetail(id: string) {
    setDetailLoading(true);
    setDetailError(false);
    fetchDetail(id)
      .then((row) => setSelected(row))
      .catch(() => setDetailError(true))
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setSelected(null);
    setDetailError(false);
  }

  return { items, loading, listError, selected, detailLoading, detailError, openDetail, closeDetail };
}
