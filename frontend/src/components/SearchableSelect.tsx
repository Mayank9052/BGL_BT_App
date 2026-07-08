import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
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

// Collapse repeated/irregular whitespace (including pasted trailing spaces,
// tabs, or newlines) and lowercase, so "AARAV AGRO " or "AARAV   AGRO"
// (extra internal spaces from ERP data) still match "aarav agro".
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export default function SearchableSelect({
  options, value, onChange, placeholder = "Select…",
  loading = false, allowCreate = false, className = "",
}: Props) {
  const [open,        setOpen]        = useState(false);
  const [query,       setQuery]       = useState("");
  const [dropStyle,   setDropStyle]   = useState<React.CSSProperties>({});
  // which option the keyboard is currently pointed at
  const [activeIndex, setActiveIndex] = useState(-1);
  // ── FIX: bumped every time the dropdown is opened, and used as the
  // dropdown's React `key`. This forces a full unmount/remount of the
  // dropdown (search input + options list) on every open, so there is
  // zero chance of a previous open's rendered option nodes lingering
  // and showing stale/unfiltered content the next time it's opened
  // (this was the "select dealer once, reopen, search shows unrelated
  // full list" bug).
  const [openId,       setOpenId]       = useState(0);

  const triggerRef   = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const optionsRef    = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const display  = selected?.label ?? value;

  // ── Search: normalized substring match across label / sublabel / value ──
  const trimmedQuery = query.trim();
  const filtered = trimmedQuery
    ? options
        .filter((o) => {
          const q = normalize(trimmedQuery);
          return (
            normalize(o.label).includes(q) ||
            normalize(o.sublabel ?? "").includes(q) ||
            normalize(o.value).includes(q)
          );
        })
        // Relevance sort: exact match → starts-with → contains, so a full
        // correct name (or one that's the only real match) surfaces first.
        .sort((a, b) => {
          const q  = normalize(trimmedQuery);
          const la = normalize(a.label);
          const lb = normalize(b.label);
          const score = (l: string) => (l === q ? 0 : l.startsWith(q) ? 1 : 2);
          return score(la) - score(lb) || la.localeCompare(lb);
        })
    : options;

  const showCreate =
    allowCreate &&
    trimmedQuery &&
    !options.some((o) => normalize(o.label) === normalize(trimmedQuery));

  // ── reset keyboard highlight whenever the visible list changes ─────────
  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [query, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── keep the highlighted row scrolled into view ─────────────────────────
  useEffect(() => {
    if (activeIndex < 0 || !optionsRef.current) return;
    const el = optionsRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // ── focus the search input the instant it mounts, synchronously ────────
  useLayoutEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

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
    setQuery("");           // always start each open with a clean slate
    setOpenId((id) => id + 1); // force a fresh dropdown instance every open
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    handleClose();
  };

  const handleCreate = () => {
    onChange(trimmedQuery);
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

      {/* Dropdown — rendered at document body level via fixed positioning.
          `key={openId}` guarantees a brand-new instance (fresh input,
          fresh option nodes) every single time it opens. */}
      {open && (
        <div
          key={openId}
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
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onPaste={(e) => {
                // Let the paste land normally, then normalize trailing
                // whitespace/newlines that some sources (Excel, PDFs) add.
                setTimeout(() => {
                  setQuery((q) => q.replace(/\s+/g, " "));
                }, 0);
              }}
              placeholder="Search…"
              onKeyDown={(e) => {
                // Enter selects the highlighted/top match — works even
                // when allowCreate is false (e.g. the Dealer field).
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (activeIndex >= 0 && filtered[activeIndex]) {
                    handleSelect(filtered[activeIndex].value);
                  } else if (filtered.length > 0) {
                    handleSelect(filtered[0].value);
                  } else if (showCreate) {
                    handleCreate();
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, filtered.length - 1 + (showCreate ? 1 : 0)));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Escape") handleClose();
              }}
            />
          </div>

          {/* Options */}
          <div className="ss-options" ref={optionsRef}>
            {filtered.length === 0 && !showCreate && (
              <div className="ss-no-results">No results</div>
            )}
            {filtered.map((o, i) => (
              <button
                key={`${o.value}__${i}`}
                type="button"
                className={`ss-option ${o.value === value ? "ss-option--active" : ""} ${i === activeIndex ? "ss-option--highlighted" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
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
                className={`ss-option ss-option--create ${activeIndex === filtered.length ? "ss-option--highlighted" : ""}`}
                onMouseEnter={() => setActiveIndex(filtered.length)}
                onClick={handleCreate}
              >
                <span className="ss-create-icon">+</span>
                <span>Use "<strong>{trimmedQuery}</strong>"</span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}