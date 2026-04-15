interface PaginatorProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

const PAGE_SIZES = [25, 50, 100, 0]; // 0 = All

function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  pages.push(1);
  if (left > 2) pages.push("…");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

export function Paginator({ page, pageSize, total, onPage, onPageSize }: PaginatorProps) {
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="paginator">
      <div className="paginator-info">
        {pageSize === 0
          ? `All ${total} results`
          : `Page ${page} of ${totalPages} · ${total} results`}
      </div>

      <div className="paginator-controls">
        <button
          className="page-btn"
          disabled={page <= 1}
          onClick={() => onPage(1)}
          title="First page"
        >
          «
        </button>
        <button
          className="page-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          title="Previous page"
        >
          ‹
        </button>

        {pageSize !== 0 &&
          pageWindow(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="page-ellipsis">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn${p === page ? " page-btn--active" : ""}`}
                onClick={() => onPage(p as number)}
              >
                {p}
              </button>
            )
          )}

        <button
          className="page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          title="Next page"
        >
          ›
        </button>
        <button
          className="page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(totalPages)}
          title="Last page"
        >
          »
        </button>
      </div>

      <div className="paginator-size">
        <span>Rows:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="page-size-select"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? "All" : s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
