// src/pages/LoginPage.tsx
import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { useNavigate, Link } from "react-router-dom";
import { loginRequest } from "../authConfig";
import { dealerLogin } from "../services/dealerAuthService";
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

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch(console.error);
  };

  const handleDealerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDealerError(null);
    setDealerLoading(true);
    try {
      await dealerLogin(email, password);
      onDealerLogin?.();
      // Dealers now redirect to /dashboard (same as staff)
      navigate("/dealer-dashboard", { replace: true });
    } catch (err) {
      setDealerError(err instanceof Error ? err.message : "Login failed.");
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
                : <span>Sign in with your dealer email and password</span>}
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
              Dealer / Vendor
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
                <input type="password" required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" />
                <Link to="/forgot-password" className="login-forgot-link">Forgot password?</Link>
              </div>
              <button className="btn-microsoft btn-dealer" type="submit" disabled={dealerLoading}>
                {dealerLoading ? "Signing in…" : "Sign In"}
              </button>
              <p className="login-footer-note">
                Dealer accounts are created by BGauss admin. Contact your RSM if you don't have access.
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