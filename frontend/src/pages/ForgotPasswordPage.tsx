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
    setError(null);
    setLoading(true);
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
      {/* Left panel – brand — identical structure to LoginPage */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <img
              src="/BGauss_Logo.png"
              alt="BGauss — Powered by BG IT — Below The Line"
              className="login-logo-img"
            />
          </div>
          <div className="login-scooty-wrap">
            <img src="/login/Bg0-scooty.png" alt="BGauss scooter" className="login-scooty-img" />
          </div>
        </div>
      </div>

      {/* Right panel – card — identical structure to LoginPage */}
      <div className="login-card-panel">
        <div className="login-card-logo-top">
          <img
            src="/login/BGauss_Logo_transparent.png"
            alt="BGauss"
            className="login-card-logo-img"
          />
        </div>
        <div className="login-card">
          <div className="login-card-header">
            <h2 className="login-card-title">Forgot password?</h2>
            <p className="login-card-desc">
              Enter your dealer or staff account email and we'll send you a reset link.
            </p>
          </div>

          {sent ? (
            <div>
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderLeft: "3px solid #16a34a",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontSize: "0.85rem",
                  color: "#166534",
                  marginBottom: 4,
                }}
              >
                ✓ If an account exists with that email, a reset link has been sent.
                Check your inbox (and spam folder).
              </div>
              <p className="login-footer-note" style={{ marginTop: 16 }}>
                Didn't get it?{" "}
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#1e3a5f",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  Try again
                </button>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-dealer-form">
              {error && <div className="login-dealer-error">{error}</div>}
              <div className="login-dealer-field">
                <label>Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dealer@example.com"
                  autoFocus
                />
              </div>
              <button className="btn-microsoft btn-dealer" type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>
          )}

          <div className="login-divider">
            <span>or</span>
          </div>

          <p className="login-footer-note">
            <Link to="/" style={{ color: "#1e3a5f", fontWeight: 600, textDecoration: "none" }}>
              ← Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}