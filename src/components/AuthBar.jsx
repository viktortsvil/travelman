import { useAuth } from "../context/AuthContext.jsx";
import "./AuthBar.css";

export default function AuthBar() {
  const { user, loading, configured, signInWithGoogle, signOut } = useAuth();

  if (loading) {
    return <div className="auth-bar auth-bar--loading">Loading…</div>;
  }

  if (user) {
    const label = user.user_metadata?.full_name ?? user.email ?? "Signed in";

    return (
      <div className="auth-bar">
        <span className="auth-bar__user" title={user.email ?? undefined}>
          {label}
        </span>
        <button type="button" className="auth-bar__btn" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <button
        type="button"
        className="auth-bar__btn auth-bar__btn--primary"
        onClick={() => signInWithGoogle()}
      >
        Sign in with Google
      </button>
    </div>
  );
}
