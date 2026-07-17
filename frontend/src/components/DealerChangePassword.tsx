// src/components/DealerChangePassword.tsx
// Dealer profile page — self-service password change + forgot password link
// Usage: <DealerChangePassword />

import { useState } from "react";
import { Link } from "react-router-dom";
import { changeMyPassword } from "../services/dealerAuthService";

export default function DealerChangePassword() {
  const [current,  setCurrent]  = useState("");
  const [newPass,  setNewPass]  = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [error,    setError]    = useState<string|null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSuccess(false);
    if (newPass !== confirm) { setError("New passwords do not match."); return; }
    if (newPass.length < 8)  { setError("New password must be at least 8 characters."); return; }

    setLoading(true);
    try {
      await changeMyPassword(current, newPass);
      setSuccess(true);
      setCurrent(""); setNewPass(""); setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ background:"#fff",border:"1px solid #e2e8f0",
      borderRadius:10,padding:"20px 24px",maxWidth:420 }}>
      <h3 style={{ margin:"0 0 4px",fontSize:14,fontWeight:700,color:"#0a2540" }}>
        🔐 Change Password
      </h3>
      <p style={{ margin:"0 0 16px",fontSize:12,color:"#6b7280" }}>
        Update your dealer portal password.
        Forgot your password?{" "}
        <Link to="/forgot-password" style={{ color:"#2563eb",fontWeight:600 }}>
          Reset via email →
        </Link>
      </p>

      {success && (
        <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",
          borderRadius:7,padding:"10px 14px",fontSize:13,color:"#166534",
          fontWeight:600,marginBottom:14 }}>
          ✓ Password changed successfully.
        </div>
      )}
      {error && (
        <div style={{ background:"#fef2f2",border:"1px solid #fecaca",
          borderRadius:7,padding:"10px 14px",fontSize:12,color:"#991b1b",
          marginBottom:14 }}>
          ⚠ {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {[
          {label:"Current Password", value:current, set:setCurrent, id:"cur"},
          {label:"New Password",     value:newPass,  set:setNewPass,  id:"np"},
          {label:"Confirm New Password", value:confirm, set:setConfirm, id:"cf"},
        ].map(({label,value,set,id})=>(
          <div key={id} style={{ marginBottom:12 }}>
            <label style={{ fontSize:12,fontWeight:600,color:"#374151",
              display:"block",marginBottom:4 }}>{label}</label>
            <input type="password" required value={value}
              onChange={(e)=>set(e.target.value)}
              minLength={id==="cur"?1:8}
              style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:7,
                padding:"9px 12px",fontSize:13,outline:"none",
                boxSizing:"border-box" as const }}/>
          </div>
        ))}
        <button type="submit" disabled={loading}
          style={{ width:"100%",background:"#0a2540",color:"#fff",
            border:"none",borderRadius:8,padding:"11px 20px",
            fontSize:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",
            opacity:loading?0.7:1,marginTop:4 }}>
          {loading ? "Changing…" : "Change Password"}
        </button>
      </form>
    </div>
  );
}