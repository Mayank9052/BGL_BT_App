import { useState, useRef, useEffect } from "react";
import "./SearchableSelect.css";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options:      Option[];
  value:        string;
  onChange:     (value: string) => void;
  placeholder?: string;
  loading?:     boolean;
  allowCreate?: boolean;
  className?:   string;
}

export default function SearchableSelect({
  options, value, onChange, placeholder = "Select…",
  loading = false, allowCreate = false, className = "",
}: Props) {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [dropUp,  setDropUp]  = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const dropdownRef  = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const display  = selected?.label ?? value;

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.sublabel ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const showCreate =
    allowCreate &&
    query.trim() &&
    !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  // ── Close on outside click ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Decide whether to open upward or downward ──────────────────────────
  const decideDirection = () => {
    if (!containerRef.current) return;
    const rect       = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropHeight = 240;
    setDropUp(spaceBelow < dropHeight && spaceAbove > spaceBelow);
  };

  const handleOpen = () => {
    decideDirection();
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
  };

  const handleCreate = () => {
    onChange(query.trim());
    setOpen(false);
    setQuery("");
  };

  return (
    <div
      ref={containerRef}
      className={`ss-wrap ${className}`}
      style={{ position: "relative" }}
    >
      {/* Trigger */}
      <button
        type="button"
        className={`ss-trigger ${open ? "ss-trigger--open" : ""} ${!value ? "ss-trigger--empty" : ""}`}
        onClick={open ? () => { setOpen(false); setQuery(""); } : handleOpen}
        disabled={loading}
      >
        <span className="ss-trigger-text">
          {loading ? "Loading…" : (display || placeholder)}
        </span>
        <span className="ss-arrow">{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown — rendered via portal-like fixed positioning */}
      {open && (
        <div
          ref={dropdownRef}
          className={`ss-dropdown ${dropUp ? "ss-dropdown--up" : "ss-dropdown--down"}`}
        >
          {/* Search input */}
          <div className="ss-search-wrap">
            <input
              ref={inputRef}
              className="ss-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && showCreate) handleCreate();
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
              }}
            />
          </div>

          {/* Options */}
          <div className="ss-options">
            {filtered.length === 0 && !showCreate && (
              <div className="ss-no-results">No results</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`ss-option ${o.value === value ? "ss-option--active" : ""}`}
                onClick={() => handleSelect(o.value)}
              >
                <span className="ss-option-label">{o.label}</span>
                {o.sublabel && <span className="ss-option-sub">{o.sublabel}</span>}
              </button>
            ))}
            {showCreate && (
              <button
                type="button"
                className="ss-option ss-option--create"
                onClick={handleCreate}
              >
                <span className="ss-create-icon">+</span>
                <span>Use "<strong>{query.trim()}</strong>"</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}