import { createContext, useContext, useEffect, useState } from "react";

type Tab = "json" | "table";

interface TreeCtx {
  expandRev: number;
  collapseRev: number;
}

const JsonTreeCtx = createContext<TreeCtx>({ expandRev: 0, collapseRev: 0 });

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function parseValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpandable(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.length > 0) ||
    (isObject(value) && Object.keys(value).length > 0)
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "boolean") return <span className="json-bool">{String(value)}</span>;
  if (typeof value === "number") return <span className="json-number">{value}</span>;
  return <span className="json-string">"{String(value)}"</span>;
}

interface NodeProps {
  value: unknown;
  propKey?: string;
  comma?: boolean;
  depth?: number;
}

function CollapsibleNode({ value, propKey, comma = false, depth = 0 }: NodeProps) {
  const { expandRev, collapseRev } = useContext(JsonTreeCtx);

  // Derive initial open state from the latest global signal so that nodes
  // mounting *after* a global expand/collapse (e.g. children revealed by the
  // first opened layer) immediately adopt the correct state without waiting
  // for a new effect cycle.
  const [open, setOpen] = useState(() => {
    if (expandRev > collapseRev) return true;
    if (collapseRev > expandRev) return false;
    return depth < 3;
  });

  useEffect(() => { if (expandRev > 0) setOpen(true); }, [expandRev]);
  useEffect(() => { if (collapseRev > 0) setOpen(false); }, [collapseRev]);

  const keyLabel = propKey !== undefined
    ? <><span className="json-key">"{propKey}"</span><span className="json-bracket">: </span></>
    : null;
  const trailComma = comma ? <span className="json-comma">,</span> : null;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="json-line">
          {keyLabel}<span className="json-bracket">[]</span>{trailComma}
        </div>
      );
    }
    return (
      <div>
        <div className="json-line">
          <button
            type="button"
            className="json-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▼" : "▶"}
          </button>
          {keyLabel}
          <span className="json-bracket">[</span>
          {!open && (
            <>
              <span className="json-count">&nbsp;{value.length} item{value.length !== 1 ? "s" : ""}&nbsp;</span>
              <span className="json-bracket">]</span>
              {trailComma}
            </>
          )}
        </div>
        {open && (
          <>
            <div className="json-children">
              {value.map((item, i) => (
                <CollapsibleNode
                  key={i}
                  value={item}
                  comma={i < value.length - 1}
                  depth={depth + 1}
                />
              ))}
            </div>
            <div className="json-line">
              <span className="json-bracket">]</span>{trailComma}
            </div>
          </>
        )}
      </div>
    );
  }

  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="json-line">
          {keyLabel}<span className="json-bracket">{"{}"}</span>{trailComma}
        </div>
      );
    }
    return (
      <div>
        <div className="json-line">
          <button
            type="button"
            className="json-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▼" : "▶"}
          </button>
          {keyLabel}
          <span className="json-bracket">{"{"}</span>
          {!open && (
            <>
              <span className="json-count">&nbsp;{entries.length} key{entries.length !== 1 ? "s" : ""}&nbsp;</span>
              <span className="json-bracket">{"}"}</span>
              {trailComma}
            </>
          )}
        </div>
        {open && (
          <>
            <div className="json-children">
              {entries.map(([k, v], i) => (
                isExpandable(v) ? (
                  <CollapsibleNode
                    key={k}
                    value={v}
                    propKey={k}
                    comma={i < entries.length - 1}
                    depth={depth + 1}
                  />
                ) : (
                  <div key={k} className="json-line">
                    <span className="json-key">"{k}"</span>
                    <span className="json-bracket">: </span>
                    <PrimitiveValue value={v} />
                    {i < entries.length - 1 && <span className="json-comma">,</span>}
                  </div>
                )
              ))}
            </div>
            <div className="json-line">
              <span className="json-bracket">{"}"}</span>{trailComma}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="json-line">
      {keyLabel}<PrimitiveValue value={value} />{trailComma}
    </div>
  );
}

function TableView({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="json-table-wrap">
      <table className="json-table">
        <tbody>
          {Object.entries(data).map(([key, val]) => (
            <tr key={key}>
              <td className="json-table-key">{key}</td>
              <td className="json-table-val">
                {typeof val === "string" || typeof val === "number" || typeof val === "boolean"
                  ? String(val)
                  : JSON.stringify(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface TabbedJsonViewerProps {
  sections: { title: string; data: unknown }[];
}

export function TabbedJsonViewer({ sections }: TabbedJsonViewerProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewMode, setViewMode] = useState<Tab>("json");
  const [copied, setCopied] = useState(false);
  const [expandRev, setExpandRev] = useState(0);
  const [collapseRev, setCollapseRev] = useState(0);

  const active = sections[activeIdx];
  const parsed = parseValue(active?.data);
  const canTable = isObject(parsed);
  const hasTree = viewMode === "json" && isExpandable(parsed);

  function handleCopy() {
    navigator.clipboard.writeText(formatValue(active?.data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="tabbed-viewer">
      <div className="tabbed-viewer-header">
        <div className="tabbed-viewer-tabs">
          {sections.map((s, i) => (
            <button
              key={s.title}
              className={`viewer-tab${i === activeIdx ? " viewer-tab--active" : ""}`}
              onClick={() => { setActiveIdx(i); setViewMode("json"); }}
              type="button"
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="tabbed-viewer-actions">
          {canTable && (
            <button
              type="button"
              className={`view-mode-btn${viewMode === "table" ? " active" : ""}`}
              onClick={() => setViewMode((v) => (v === "table" ? "json" : "table"))}
              title="Toggle table view"
            >
              ⊞ Table
            </button>
          )}
          {hasTree && (
            <>
              <span className="viewer-actions-sep" />
              <button
                type="button"
                className="view-mode-btn"
                onClick={() => setExpandRev((v) => v + 1)}
                title="Expand all nodes"
              >
                ⊞ Expand
              </button>
              <button
                type="button"
                className="view-mode-btn"
                onClick={() => setCollapseRev((v) => v + 1)}
                title="Collapse all nodes"
              >
                ⊟ Collapse
              </button>
              <span className="viewer-actions-sep" />
            </>
          )}
          <button
            type="button"
            className={`copy-btn${copied ? " copy-btn--done" : ""}`}
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? "✓ Copied" : "⎘ Copy"}
          </button>
        </div>
      </div>

      <div className="tabbed-viewer-body">
        {viewMode === "table" && canTable ? (
          <TableView data={parsed as Record<string, unknown>} />
        ) : (
          <JsonTreeCtx.Provider value={{ expandRev, collapseRev }}>
            <div className="json-tree">
              <CollapsibleNode value={parsed} />
            </div>
          </JsonTreeCtx.Provider>
        )}
      </div>
    </div>
  );
}
