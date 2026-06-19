import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { loginRequest } from "../authConfig";
import "./LoginPage.css";

export default function LoginPage() {
  const { instance, inProgress } = useMsal();
  const isLoading = inProgress !== InteractionStatus.None;

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch(console.error);
  };

  return (
    <div className="login-root">
      {/* Left panel – brand */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <img src="/BGauss_Logo.png" alt="BGauss" className="login-logo-img" />
            <span className="login-logo-text">BGauss</span>
          </div>
          <h1 className="login-brand-headline">
            BTL
          </h1>
          <p className="login-brand-sub">
            The internal operations portal for BGauss Auto — connect with your
            Microsoft 365 account to continue.
          </p>
          {/* Scooty image */}
          <div className="login-scooty-wrap">
            <img
              src="/login/Bg0-scooty.png"
              alt="BGauss scooter"
              className="login-scooty-img"
            />
          </div>
        </div>
      </div>

      {/* Right panel – login card */}
      <div className="login-card-panel">
        <div className="login-card">
          <div className="login-card-header">
            <h2 className="login-card-title">Welcome back</h2>
            <p className="login-card-desc">
              Sign in with your <strong>bgauss.com</strong> Microsoft account
            </p>
          </div>

          <button
            className="btn-microsoft"
            onClick={handleLogin}
            disabled={isLoading}
          >
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