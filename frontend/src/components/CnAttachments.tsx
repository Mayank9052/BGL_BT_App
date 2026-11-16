// src/components/CnAttachments.tsx — shared by Accounts + Approver dashboards.
import { useEffect, useState } from "react";
import { fetchCnAttachments, resolveMediaUrl, type CnAttachment, type CnAttachmentsResult, type MsalLike } from "../services/cnService";
import "./CnShared.css";

export async function downloadFile(url: string, name: string) {
  try {
    const r = await fetch(url); if (!r.ok) throw new Error();
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = u; a.download = name || "file";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  } catch { window.open(url, "_blank", "noopener"); }
}

const isImg = (t: string | null) => !!t?.toLowerCase().startsWith("image/");
const isVid = (t: string | null) => !!t?.toLowerCase().startsWith("video/");
const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CnAttachments({ activityId, instance, refreshKey, canDownload = true }:
  { activityId: string; instance?: MsalLike; refreshKey?: unknown; canDownload?: boolean }) {
  const [d, setD] = useState<CnAttachmentsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<CnAttachment | null>(null);

  useEffect(() => {
    let live = true; setErr(null);
    fetchCnAttachments(activityId, instance).then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [activityId, instance, refreshKey]);

  if (err) return <div className="cn-msg cn-msg--err">⚠ {err}</div>;
  if (!d) return <div className="cn-msg">Loading attachments…</div>;

  const row = (m: CnAttachment) => {
    const url = resolveMediaUrl(m.url);
    return (
      <div key={m.id} className="cn-att-row">
        <button type="button" className="cn-att-thumb" onClick={() => setView({ ...m, url })} aria-label={`View ${m.name}`}>
          {isImg(m.type) ? <img src={url} alt={m.name} />
            : isVid(m.type) ? <video src={url} muted />
            : <span>{m.type?.includes("pdf") ? "📄" : "📎"}</span>}
        </button>
        <div className="cn-att-info">
          <div className="cn-att-name" title={m.name}>{m.name}</div>
          <div className="cn-att-meta">🕐 {fmt(m.capturedAt)}
            {m.latitude != null && m.longitude != null &&
              <a href={`https://maps.google.com/?q=${m.latitude},${m.longitude}`} target="_blank" rel="noreferrer">📍 GPS</a>}
          </div>
        </div>
        <div className="cn-att-btns">
          <button className="cn-btn" onClick={() => setView({ ...m, url })}>View</button>
          {canDownload && <button className="cn-btn" onClick={() => downloadFile(url, m.name)}>⬇ Download</button>}
        </div>
      </div>
    );
  };
  const list = (items: CnAttachment[], empty: string) => (
    <div className="cn-att-list">
      {items.length === 0 ? <span className="cn-att-empty">{empty}</span> : items.map(row)}
    </div>
  );

  const fi = d.finalInvoice;
  return (
    <div className="cn-att">
      <div className="cn-att-title">📸 Activity Photos: {d.photoCount}</div>
      {list(d.photos, "No photos uploaded.")}

      {d.videos.length > 0 && (<>
        <div className="cn-att-title">🎬 Activity Videos: {d.videos.length}</div>
        {list(d.videos, "")}
      </>)}

      <div className="cn-att-title">🧾 Vendor Invoices: {d.vendorInvoices.length}</div>
      {list(d.vendorInvoices, "None uploaded.")}

      <div className="cn-att-title">🧾 BGauss Invoice</div>
      {fi
        ? <div className="cn-att-list">{row({
            id: "final", url: fi.url,
            name: `${fi.name ?? "BGauss_Invoice"}${fi.amount ? ` — Rs. ${fi.amount.toLocaleString("en-IN")}` : ""}`,
            type: /\.pdf(\?|$)/i.test(fi.url) ? "application/pdf" : /\.(png|jpe?g|webp|gif)(\?|$)/i.test(fi.url) ? "image/*" : null,
            capturedAt: fi.at, latitude: null, longitude: null,
          })}</div>
        : <span className="cn-att-empty">Not uploaded.</span>}

      {view && (
        <div className="cn-lightbox" onClick={() => setView(null)}>
          <div className="cn-lightbox-box" onClick={(e) => e.stopPropagation()}>
            {isImg(view.type) ? <img src={view.url} alt={view.name} />
              : isVid(view.type) ? <video src={view.url} controls autoPlay />
              : <iframe src={view.url} title={view.name} />}
            <div className="cn-lightbox-bar">
              {canDownload && <button className="cn-btn" onClick={() => downloadFile(view.url, view.name)}>⬇ Download</button>}
              {canDownload && <a className="cn-btn" href={view.url} target="_blank" rel="noreferrer">Open ↗</a>}
              <button className="cn-btn" onClick={() => setView(null)}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}