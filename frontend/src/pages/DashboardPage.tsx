import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import "./DashboardPage.css";

export default function DashboardPage() {
  const { instance } = useMsal();
  const { user, loading } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: "/" }).catch(console.error);
  };

  const initials = user
    ? (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? user.displayName[0] ?? "")
    : "?";

  return (
    <div className="dash-root">
      {/* Top navbar */}
      <nav className="dash-nav">
        <div className="dash-nav-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="dash-nav-logo" />
          <span>BGauss Portal</span>
        </div>
        <div className="dash-nav-right">
          <span className="dash-nav-email">{user?.email}</span>
          <button className="btn-logout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="dash-main">
        {loading ? (
          <div className="dash-loading">
            <div className="spinner" />
            <p>Loading your profile…</p>
          </div>
        ) : (
          <>
            {/* Profile card */}
            <div className="profile-card">
              <div className="profile-avatar">{initials.toUpperCase()}</div>
              <div className="profile-info">
                <h1 className="profile-name">{user?.displayName ?? "—"}</h1>
                <p className="profile-email">{user?.email}</p>
                <div className="profile-meta">
                  {user?.jobTitle && <span className="meta-chip">{user.jobTitle}</span>}
                  {user?.department && <span className="meta-chip">{user.department}</span>}
                  <span className={`role-chip role-${user?.role?.toLowerCase()}`}>
                    {user?.role ?? "User"}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="quick-actions">
              <button
                className="action-card"
                onClick={() => navigate("/rsm-form")}
              >
                <span className="action-icon">📋</span>
                <span className="action-title">RSM Proposal Form</span>
                <span className="action-desc">
                  Submit a new marketing / sales activity proposal
                </span>
              </button>
            </div>

            {/* Info grid */}
            <div className="info-grid">
              <InfoCard label="Full name" value={user?.displayName} />
              <InfoCard label="Email" value={user?.email} />
              <InfoCard label="Department" value={user?.department ?? "—"} />
              <InfoCard label="Job title" value={user?.jobTitle ?? "—"} />
              <InfoCard label="Role" value={user?.role} />
              <InfoCard
                label="Last login"
                value={
                  user?.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "—"
                }
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="info-card">
      <span className="info-label">{label}</span>
      <span className="info-value">{value ?? "—"}</span>
    </div>
  );
}
