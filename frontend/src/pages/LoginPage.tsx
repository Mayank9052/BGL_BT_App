// src/pages/LoginPage.tsx
import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { useNavigate, Link } from "react-router-dom";
import { loginRequest } from "../authConfig";
import { dealerLogin, staffLogin } from "../services/dealerAuthService";
import "./LoginPage.css";

interface LoginPageProps {
  onDealerLogin?: () => void;
}

export default function LoginPage({ onDealerLogin }: LoginPageProps) {
  const { instance, inProgress } = useMsal();
  const navigate = useNavigate();
  const isLoading = inProgress !== InteractionStatus.None;

  const [mode, setMode] = useState<"staff" | "dealer">("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dealerLoading, setDealerLoading] = useState(false);
  const [dealerError, setDealerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch(console.error);
  };

  const handleDealerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDealerError(null);
    setDealerLoading(true);
    try {
      // Try dealer login first. If that fails (e.g. wrong role, or this
      // email belongs to an RSM/TSM/ZSM/Commando instead), fall back to
      // staff login with the SAME credentials — one form serves both
      // account types without asking the person to know which bucket
      // their account falls into.
      let result;
      try {
        result = await dealerLogin(email, password);
      } catch {
        result = await staffLogin(email, password);
      }
      onDealerLogin?.();
      // Route by the role actually returned, not by which tab was clicked —
      // a TSM logging in here should land on the staff dashboard, not the
      // dealer one, even though they used the "Dealer / Vendor" tab.
      const destination = result.role === "Dealer" ? "/dealer-dashboard" : "/staff-dashboard";
      navigate(destination, { replace: true });
    } catch (err) {
      setDealerError(err instanceof Error ? err.message : "Invalid email or password.");
    } finally {
      setDealerLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Left panel – brand */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <img
              src="/BGauss_Logo.png"
              alt="BGauss — Powered by BG IT — Below The Line"
              className="login-logo-img"
            />
          </div>
          {/* <p className="login-brand-sub" style={{ marginTop: -8 }}>
            Field activity, budgets, and approvals — powered end to end.
          </p> */}
          <div className="login-scooty-wrap">
            <img src="/login/Bg0-scooty.png" alt="BGauss scooter" className="login-scooty-img" />
          </div>
        </div>
      </div>

      {/* Right panel – login card */}
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
            <h2 className="login-card-title">Welcome back</h2>
            <p className="login-card-desc">
              {mode === "staff"
                ? <><span>Sign in with your </span><strong>bgauss.com</strong><span> Microsoft account</span></>
                : <span>Sign in with your dealer or staff email and password</span>}
            </p>
          </div>

          <div className="login-mode-toggle">
            <button
              className={`login-mode-btn ${mode === "staff" ? "login-mode-btn--active" : ""}`}
              onClick={() => setMode("staff")} type="button">
              Staff
            </button>
            <button
              className={`login-mode-btn ${mode === "dealer" ? "login-mode-btn--active" : ""}`}
              onClick={() => setMode("dealer")} type="button">
              Dealer / Field Staff
            </button>
          </div>

          {mode === "staff" ? (
            <>
              <button className="btn-microsoft" onClick={handleLogin} disabled={isLoading}>
                <MicrosoftIcon />
                {isLoading ? "Redirecting…" : "Continue with Microsoft"}
              </button>

              <div className="login-divider">
                <span>Secured by Microsoft Entra ID</span>
              </div>

              <p className="login-footer-note">
                Only <strong>@bgauss.com</strong> accounts are permitted.
                Contact IT if you need access.
              </p>
            </>
          ) : (
            <form onSubmit={handleDealerLogin} className="login-dealer-form">
              {dealerError && <div className="login-dealer-error">{dealerError}</div>}
              <div className="login-dealer-field">
                <label>Email</label>
                <input type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dealer@example.com" />
              </div>
              <div className="login-dealer-field">
                <label>Password</label>
                <div className="login-password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <Link to="/forgot-password" className="login-forgot-link">Forgot password?</Link>
              </div>
              <button className="btn-microsoft btn-dealer" type="submit" disabled={dealerLoading}>
                {dealerLoading ? "Signing in…" : "Sign In"}
              </button>
              <p className="login-footer-note">
                Dealer and staff accounts are created by BGauss admin. Contact your RSM if you don't have access.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}