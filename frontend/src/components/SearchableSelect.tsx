import { useState, useRef, useEffect, useCallback } from "react";
import "./SearchableSelect.css";

interface Option {
  value:     string;
  label:     string;
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
  const [open,      setOpen]      = useState(false);
  const [query,     setQuery]     = useState("");
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const triggerRef   = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

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

  // ── Compute fixed position from trigger rect ───────────────────────────
  const updateDropPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect       = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropHeight = 260;
    const openUp     = spaceBelow < dropHeight && spaceAbove > spaceBelow;

    if (openUp) {
      setDropStyle({
        position: "fixed",
        bottom:   window.innerHeight - rect.top + 2,
        left:     rect.left,
        width:    rect.width,
        zIndex:   9999,
      });
    } else {
      setDropStyle({
        position: "fixed",
        top:      rect.bottom + 2,
        left:     rect.left,
        width:    rect.width,
        zIndex:   9999,
      });
    }
  }, []);

  // ── Reposition on scroll / resize while open ───────────────────────────
  useEffect(() => {
    if (!open) return;
    updateDropPosition();
    window.addEventListener("scroll",  updateDropPosition, true);
    window.addEventListener("resize",  updateDropPosition);
    return () => {
      window.removeEventListener("scroll",  updateDropPosition, true);
      window.removeEventListener("resize",  updateDropPosition);
    };
  }, [open, updateDropPosition]);

  // ── Close on outside click ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check container and also the fixed dropdown (which is outside DOM tree)
      const dropdown = document.getElementById("ss-fixed-dropdown");
      if (
        !containerRef.current?.contains(target) &&
        !dropdown?.contains(target)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    updateDropPosition();
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
  };

  const handleSelect = (val: string) => {
    onChange(val);
    handleClose();
  };

  const handleCreate = () => {
    onChange(query.trim());
    handleClose();
  };

  return (
    <>
      {/* Trigger wrapper */}
      <div ref={containerRef} className={`ss-wrap ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          className={`ss-trigger ${open ? "ss-trigger--open" : ""} ${!value ? "ss-trigger--empty" : ""}`}
          onClick={open ? handleClose : handleOpen}
          disabled={loading}
        >
          <span className="ss-trigger-text">
            {loading ? "Loading…" : (display || placeholder)}
          </span>
          <span className="ss-arrow">{open ? "▲" : "▼"}</span>
        </button>
      </div>

      {/* Dropdown — rendered at document body level via fixed positioning */}
      {open && (
        <div
          id="ss-fixed-dropdown"
          className="ss-dropdown"
          style={dropStyle}
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
                if (e.key === "Escape") handleClose();
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
                {o.sublabel && (
                  <span className="ss-option-sub">{o.sublabel}</span>
                )}
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
    </>
  );
}