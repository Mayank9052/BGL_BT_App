import { useState, useRef, useEffect } from "react";
import "./SearchableSelect.css";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowCreate?: boolean; // if true, user can type a new value not in list
}

export default function SearchableSelect({
  options, value, onChange, placeholder = "Select…",
  disabled, loading, allowCreate = false,
}: Props) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const containerRef        = useRef<HTMLDivElement>(null);
  const inputRef            = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.sublabel?.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  // Show "create" option when allowCreate + query doesn't exactly match any option
  const showCreate =
    allowCreate &&
    query.trim().length > 0 &&
    !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    if (disabled || loading) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
  };

  const handleCreate = () => {
    const newVal = query.trim();
    if (!newVal) return;
    onChange(newVal);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="ss-wrap" ref={containerRef}>
      <div
        className={`ss-trigger ${open ? "ss-trigger--open" : ""} ${disabled || loading ? "ss-trigger--disabled" : ""}`}
        onClick={handleOpen}
      >
        {loading ? (
          <span className="ss-placeholder">Loading…</span>
        ) : value && !selected && allowCreate ? (
          // Free-typed value not in options list
          <div className="ss-selected">
            <span className="ss-selected-label">{value}</span>
            <span className="ss-selected-sub" style={{ color: "#6366f1" }}>custom</span>
          </div>
        ) : selected ? (
          <div className="ss-selected">
            <span className="ss-selected-label">{selected.label}</span>
            {selected.sublabel && (
              <span className="ss-selected-sub">{selected.sublabel}</span>
            )}
          </div>
        ) : (
          <span className="ss-placeholder">{placeholder}</span>
        )}
        <div className="ss-icons">
          {value && !disabled && (
            <button className="ss-clear" onClick={handleClear} tabIndex={-1}>×</button>
          )}
          <span className="ss-arrow">{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div className="ss-dropdown">
          <div className="ss-search-wrap">
            <input
              ref={inputRef}
              className="ss-search"
              placeholder={allowCreate ? "Search or type a new name…" : "Type to search…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && showCreate) handleCreate();
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
              }}
            />
          </div>
          <div className="ss-list">
            {/* Create new option */}
            {showCreate && (
              <div className="ss-option ss-option--create" onClick={handleCreate}>
                <span className="ss-option-label">+ Use "<b>{query.trim()}</b>"</span>
                <span className="ss-option-sub">Add as new entry</span>
              </div>
            )}

            {filtered.length === 0 && !showCreate ? (
              <div className="ss-empty">
                {allowCreate ? `No results — press Enter to use "${query}"` : "No results found"}
              </div>
            ) : (
              filtered.map((opt) => (
                <div
                  key={opt.value}
                  className={`ss-option ${opt.value === value ? "ss-option--selected" : ""}`}
                  onClick={() => handleSelect(opt.value)}
                >
                  <span className="ss-option-label">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="ss-option-sub">{opt.sublabel}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}