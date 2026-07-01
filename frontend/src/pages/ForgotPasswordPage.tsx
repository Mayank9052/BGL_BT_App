// src/pages/ForgotPasswordPage.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotDealerPassword } from "../services/dealerAuthService";
import "./LoginPage.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      await forgotDealerPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <img src="/BGauss_Logo.png" alt="BGauss" className="login-logo-img" />
            <span className="login-logo-text">BGauss</span>
          </div>
          <h1 className="login-brand-headline">Reset your password</h1>
        </div>
      </div>
      <div className="login-card-panel">
        <div className="login-card">
          <div className="login-card-header">
            <h2 className="login-card-title">Forgot Password</h2>
            <p className="login-card-desc">Enter your dealer account email and we'll send a reset link.</p>
          </div>

          {sent ? (
            <p className="login-footer-note">
              If an account exists with that email, a reset link has been sent. Check your inbox.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="login-dealer-form">
              {error && <div className="login-dealer-error">{error}</div>}
              <div className="login-dealer-field">
                <label>Email</label>
                <input type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dealer@example.com" />
              </div>
              <button className="btn-microsoft btn-dealer" type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>
          )}

          <p className="login-footer-note" style={{ marginTop: 16 }}>
            <Link to="/">← Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}