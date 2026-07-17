// src/components/BulkImportDealersPanel.tsx
// Admin-only component — import all dealers from BaplFinal with one click
// Usage: <BulkImportDealersPanel instance={instance} />

import { useState } from "react";
import { IPublicClientApplication } from "@azure/msal-browser";
import {
  bulkPreviewDealers, bulkImportDealers, getBulkImportStatus,
  type BulkPreviewResult, type BulkImportResult, type BulkStatusResult,
} from "../services/dealerAuthService";

interface Props { instance: IPublicClientApplication; }

export default function BulkImportDealersPanel({ instance }: Props) {
  const [status,    setStatus]    = useState<BulkStatusResult | null>(null);
  const [preview,   setPreview]   = useState<BulkPreviewResult | null>(null);
  const [result,    setResult]    = useState<BulkImportResult | null>(null);
  const [loading,   setLoading]   = useState<"status"|"preview"|"import"|null>(null);
  const [error,     setError]     = useState<string|null>(null);
  const [showList,  setShowList]  = useState(false);

  const loadStatus = async () => {
    setLoading("status"); setError(null);
    try { setStatus(await getBulkImportStatus(instance)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setLoading(null); }
  };

  const loadPreview = async () => {
    setLoading("preview"); setError(null);
    try { setPreview(await bulkPreviewDealers(instance)); setResult(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setLoading(null); }
  };

  const runImport = async () => {
    if (!confirm(`This will create ${preview?.toCreate ?? "?"} dealer logins with default password Dealer@123. Continue?`))
      return;
    setLoading("import"); setError(null);
    try {
      const r = await bulkImportDealers(instance);
      setResult(r);
      setPreview(null);
      // Refresh status
      setStatus(await getBulkImportStatus(instance));
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setLoading(null); }
  };

  return (
    <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,
      padding:"20px 24px",marginBottom:20 }}>
      {/* Header */}
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",
        marginBottom:16,flexWrap:"wrap",gap:10 }}>
        <div>
          <h3 style={{ margin:0,fontSize:15,fontWeight:700,color:"#0a2540" }}>
            🏪 Bulk Import Dealer Logins
          </h3>
          <p style={{ margin:"4px 0 0",fontSize:12,color:"#6b7280" }}>
            Fetch all active dealers from BaplFinal C_CustomerMaster and create
            portal logins automatically. Default password: <code>Dealer@123</code>
          </p>
        </div>
        <button onClick={loadStatus} disabled={!!loading}
          style={{ background:"#f1f5f9",border:"1px solid #e2e8f0",
            borderRadius:7,padding:"7px 16px",fontSize:12,fontWeight:600,
            cursor:loading?"not-allowed":"pointer",color:"#374151" }}>
          {loading==="status"?"Loading…":"↻ Check Status"}
        </button>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{ display:"flex",gap:16,marginBottom:16,flexWrap:"wrap" }}>
          {[
            {label:"Total in BaplFinal",value:status.totalDealersInBapl,c:"#0a2540"},
            {label:"Logins Created",    value:status.loginsCreated,      c:"#16a34a"},
            {label:"Active Logins",     value:status.activeLogins,       c:"#2563eb"},
            {label:"Pending Import",    value:status.pendingImport,      c:status.pendingImport>0?"#f59e0b":"#16a34a"},
          ].map(({label,value,c})=>(
            <div key={label} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",
              borderRadius:8,padding:"10px 16px",textAlign:"center",minWidth:130 }}>
              <div style={{ fontSize:22,fontWeight:800,color:c }}>{value}</div>
              <div style={{ fontSize:10,color:"#6b7280",textTransform:"uppercase",
                letterSpacing:"0.04em",marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,
          padding:"10px 14px",fontSize:12,color:"#991b1b",marginBottom:14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Action buttons */}
      {!result && (
        <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
          <button onClick={loadPreview} disabled={!!loading}
            style={{ background:"#1e3a5f",color:"#fff",border:"none",
              borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:600,
              cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1 }}>
            {loading==="preview"?"Loading…":"🔍 Preview Import"}
          </button>
          {preview && preview.toCreate > 0 && (
            <button onClick={runImport} disabled={!!loading}
              style={{ background:"#16a34a",color:"#fff",border:"none",
                borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,
                cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1 }}>
              {loading==="import"
                ?"Importing…"
                :`✓ Import ${preview.toCreate} Dealers`}
            </button>
          )}
        </div>
      )}

      {/* Preview table */}
      {preview && !result && (
        <div style={{ marginTop:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
            <span style={{ fontSize:13,fontWeight:600,color:"#0a2540" }}>
              {preview.toCreate} dealers will be created · {preview.alreadyImported} already imported
            </span>
            <button onClick={()=>setShowList(v=>!v)}
              style={{ background:"none",border:"1px solid #e2e8f0",borderRadius:6,
                padding:"3px 10px",fontSize:11,cursor:"pointer",color:"#2563eb" }}>
              {showList?"▲ Hide":"▼ Show list"}
            </button>
          </div>
          {showList && (
            <div style={{ maxHeight:300,overflowY:"auto",border:"1px solid #e2e8f0",
              borderRadius:8,fontSize:11 }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#0a2540",position:"sticky",top:0 }}>
                    {["Code","Dealer Name","City","State","Proposed Email","Real Email?"].map(h=>(
                      <th key={h} style={{ padding:"6px 8px",textAlign:"left",
                        color:"#e2e8f0",fontSize:10,fontWeight:700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.dealers.map((d,i)=>(
                    <tr key={d.customerCode}
                      style={{ background:i%2===0?"#f8fafc":"#fff",
                        borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"4px 8px",fontFamily:"monospace",fontSize:10 }}>
                        {d.customerCode}
                      </td>
                      <td style={{ padding:"4px 8px",fontWeight:600 }}>{d.customerName}</td>
                      <td style={{ padding:"4px 8px",color:"#475569" }}>{d.city}</td>
                      <td style={{ padding:"4px 8px" }}>
                        <span style={{ background:"#eff6ff",color:"#1e40af",
                          padding:"1px 6px",borderRadius:3,fontSize:9,fontWeight:700 }}>
                          {d.state}
                        </span>
                      </td>
                      <td style={{ padding:"4px 8px",color:"#374151",fontSize:10 }}>
                        {d.proposedEmail}
                      </td>
                      <td style={{ padding:"4px 8px",textAlign:"center" }}>
                        {d.hasRealEmail
                          ? <span style={{ color:"#16a34a",fontWeight:700 }}>✓</span>
                          : <span style={{ color:"#f59e0b" }}>fallback</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize:11,color:"#6b7280",marginTop:8 }}>
            ℹ "Real Email" = dealer has a valid email in C_CustomerMaster.
            Fallback uses mobile number or dealer code + <code>@dealer.bgauss.local</code>
          </p>
        </div>
      )}

      {/* Import result */}
      {result && (
        <div style={{ marginTop:16,background:"#f0fdf4",border:"1px solid #bbf7d0",
          borderRadius:8,padding:"14px 18px" }}>
          <div style={{ fontWeight:700,fontSize:14,color:"#166534",marginBottom:8 }}>
            ✓ Import Complete
          </div>
          <div style={{ display:"flex",gap:20,flexWrap:"wrap",marginBottom:10 }}>
            <span style={{ fontSize:13,color:"#166534" }}>
              <strong>{result.created}</strong> created
            </span>
            <span style={{ fontSize:13,color:"#6b7280" }}>
              <strong>{result.skipped}</strong> already existed
            </span>
            {result.failed > 0 && (
              <span style={{ fontSize:13,color:"#dc2626" }}>
                <strong>{result.failed}</strong> failed
              </span>
            )}
          </div>
          <div style={{ fontSize:12,color:"#374151",marginBottom:8 }}>
            Default password for all new accounts: <code style={{ background:"#dcfce7",
              padding:"2px 6px",borderRadius:4,fontWeight:700 }}>{result.defaultPassword}</code>
          </div>
          {result.errors.length > 0 && (
            <details style={{ fontSize:11,color:"#dc2626" }}>
              <summary style={{ cursor:"pointer" }}>
                {result.errors.length} error(s)
              </summary>
              <ul style={{ margin:"6px 0 0",paddingLeft:18 }}>
                {result.errors.map((e,i)=><li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <button onClick={()=>setResult(null)}
            style={{ marginTop:12,background:"#1e3a5f",color:"#fff",
              border:"none",borderRadius:7,padding:"7px 16px",
              fontSize:12,fontWeight:600,cursor:"pointer" }}>
            ↩ Import More / Refresh
          </button>
        </div>
      )}
    </div>
  );
}