import { useState } from "react";

// 고객 아바타(앱 미러): avatar_url 있으면 이미지, 없거나 로드 실패면 더미 사람 아이콘.
export function CustomerAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span aria-hidden="true" className="message-avatar">
      {url && !failed ? (
        <img alt="" onError={() => setFailed(true)} src={url} />
      ) : (
        <svg fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7.2 2.2-7.2 5v1.2h14.4V19c0-2.8-3.2-5-7.2-5Z" />
        </svg>
      )}
    </span>
  );
}
