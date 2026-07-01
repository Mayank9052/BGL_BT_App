// src/pages/ResetPasswordPage.tsx
import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { resetDealerPassword } from "../services/dealerAuthService";
import "./LoginPage.css";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetDealerPassword(email, token, password);
      setDone(true);
      setTimeout(() => navigate("/"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (!email || !token) {
    return (
      <div className="login-root">
        <div className="login-card-panel" style={{ flex: 1 }}>
          <div className="login-card">
            <p className="login-footer-note">Invalid or missing reset link. <Link to="/forgot-password">Request a new one</Link>.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-root">
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <img src="/BGauss_Logo.png" alt="BGauss" className="login-logo-img" />
            <span className="login-logo-text">BGauss</span>
          </div>
          <h1 className="login-brand-headline">Set a new password</h1>
        </div>
      </div>
      <div className="login-card-panel">
        <div className="login-card">
          <div className="login-card-header">
            <h2 className="login-card-title">Reset Password</h2>
            <p className="login-card-desc">For account: <strong>{email}</strong></p>
          </div>

          {done ? (
            <p className="login-footer-note">Password reset! Redirecting to sign in…</p>
          ) : (
            <form onSubmit={handleSubmit} className="login-dealer-form">
              {error && <div className="login-dealer-error">{error}</div>}
              <div className="login-dealer-field">
                <label>New Password</label>
                <input type="password" required minLength={8} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" />
              </div>
              <div className="login-dealer-field">
                <label>Confirm Password</label>
                <input type="password" required minLength={8} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password" />
              </div>
              <button className="btn-microsoft btn-dealer" type="submit" disabled={loading}>
                {loading ? "Saving…" : "Reset Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}