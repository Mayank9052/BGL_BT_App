// src/components/TableTools.tsx
// Shared table helpers: header sorting (click = asc → desc → off), pagination, ₹ amount cell.
// Used by ApproverDashboard, DashboardPage and AccountsDashboard.
import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import "./TableTools.css";

export type SortDir = "asc" | "desc";
export type SortGetter<T> = (row: T) => string | number | null | undefined;

const cmp = (a: unknown, b: unknown) => {
  const ea = a === null || a === undefined || a === "", eb = b === null || b === undefined || b === "";
  if (ea && eb) return 0;
  if (ea) return 1;              // blanks always last
  if (eb) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-IN", { numeric: true, sensitivity: "base" });
};

/** Sort + paginate any list. `resetOn` = values that send the user back to page 1 when they change. */
export function useSortPage<T>(rows: T[], getters: Record<string, SortGetter<T>>, opts: {
  pageSize?: number; storageKey?: string; resetOn?: unknown[];
  defaultSort?: { key: string; dir: SortDir };
} = {}) {
  const [sortKey, setSortKey] = useState<string | null>(opts.defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(opts.defaultSort?.dir ?? "asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number>(() => {
    try { return Number(localStorage.getItem(`ps_${opts.storageKey ?? "tbl"}`)) || opts.pageSize || 25; }
    catch { return opts.pageSize || 25; }
  });
  const setPageSize = (n: number) => {
    setPageSizeState(n); setPage(1);
    try { localStorage.setItem(`ps_${opts.storageKey ?? "tbl"}`, String(n)); } catch { /* ignore */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, opts.resetOn ?? []);

  const sorted = useMemo(() => {
    const g = sortKey ? getters[sortKey] : undefined;
    if (!g) return rows;
    const m = sortDir === "asc" ? 1 : -1;
    return rows.map((r, i) => ({ r, i, v: g(r) }))
      .sort((x, y) => {
        const blankX = x.v === null || x.v === undefined || x.v === "";
        const blankY = y.v === null || y.v === undefined || y.v === "";
        if (blankX !== blankY) return blankX ? 1 : -1;
        return (cmp(x.v, y.v) * m) || (x.i - y.i);
      })
      .map((x) => x.r);
  }, [rows, getters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => sorted.slice((curPage - 1) * pageSize, curPage * pageSize), [sorted, curPage, pageSize]);

  const onSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
    setPage(1);
  };

  return { sorted, pageRows, sortKey, sortDir, onSort, page: curPage, setPage, pageSize, setPageSize, total: sorted.length, totalPages };
}

/** Sortable header cell. */
export function SortTh({ k, label, sortKey, sortDir, onSort, className, style, align = "left", title, rowSpan, colSpan }: {
  k: string; label: ReactNode; sortKey: string | null; sortDir: SortDir; onSort: (k: string) => void;
  className?: string; style?: CSSProperties; align?: "left" | "center" | "right"; title?: string;
  rowSpan?: number; colSpan?: number;
}) {
  const active = sortKey === k;
  return (
    <th className={`tt-th${active ? " tt-th--active" : ""}${className ? " " + className : ""}`} rowSpan={rowSpan} colSpan={colSpan}
      style={{ textAlign: align, ...style }} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="tt-sort" onClick={() => onSort(k)}
        style={{ justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}
        title={title ?? (active ? (sortDir === "asc" ? "Sorted A→Z / low→high — click for high→low" : "Sorted high→low — click to clear") : "Click to sort")}>
        <span>{label}</span>
        <span className="tt-arrow">{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

/** Pager: "Showing 26–50 of 137" · rows per page · « ‹ 1 2 … 6 › » */
export function Pager({ page, pageSize, total, onPage, onPageSize, scrollTo }: {
  page: number; pageSize: number; total: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void; scrollTo?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const go = (p: number) => {
    onPage(Math.min(Math.max(1, p), pages));
    if (scrollTo) document.querySelector(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div className="tt-pager">
      <span className="tt-pager-info">Showing <b>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</b> of <b>{total}</b></span>
      <label className="tt-pager-size">Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="tt-pager-btns">
        <button type="button" disabled={page <= 1} onClick={() => go(1)} title="First page">«</button>
        <button type="button" disabled={page <= 1} onClick={() => go(page - 1)} title="Previous page">‹</button>
        {nums.map((n, i) => n === "…"
          ? <span key={`g${i}`} className="tt-pager-gap">…</span>
          : <button type="button" key={n} className={n === page ? "is-active" : ""} onClick={() => go(n)}>{n}</button>)}
        <button type="button" disabled={page >= pages} onClick={() => go(page + 1)} title="Next page">›</button>
        <button type="button" disabled={page >= pages} onClick={() => go(pages)} title="Last page">»</button>
      </div>
    </div>
  );
}

/** ₹ amount that never wraps: "₹1,15,39,294" — the column widens to fit the value. */
export const inrText = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`;
export function Inr({ value, zero = "₹0", className }: { value: number | null | undefined; zero?: string; className?: string }) {
  return <span className={`tt-inr${className ? " " + className : ""}`}>{!value ? zero : inrText(value)}</span>;
}