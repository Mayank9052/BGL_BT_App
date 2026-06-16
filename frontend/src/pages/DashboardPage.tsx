import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import "./DashboardPage.css";

export default function DashboardPage() {
  const { instance } = useMsal();
  const { user, loading } = useAuthStore();

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
          <svg width="32" height="32" viewBox="0 0 52 52" fill="none">
            <rect width="52" height="52" rx="14" fill="#00B4D8"/>
            <path d="M13 26L22 16L31 26L22 36L13 26Z" fill="white" opacity="0.9"/>
            <path d="M21 26L30 16L39 26L30 36L21 26Z" fill="white" opacity="0.5"/>
          </svg>
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