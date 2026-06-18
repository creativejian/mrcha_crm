import { signInWithKakao, signOut } from "@/lib/auth";

export function LoginPage({ deniedReason }: { deniedReason?: boolean }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Mr. Cha CRM</h1>
        {deniedReason ? (
          <>
            <p>이 계정은 CRM 접근 권한이 없습니다.</p>
            <button type="button" className="btn" onClick={() => void signOut()}>
              다른 계정으로 로그인
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => void signInWithKakao()}
          >
            카카오로 로그인
          </button>
        )}
      </div>
    </div>
  );
}
