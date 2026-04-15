import { useMemo } from "react";

interface Props {
  data: unknown;
  title: string;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function JsonViewer({ data, title }: Props) {
  const serialized = useMemo(() => formatValue(data), [data]);

  return (
    <section className="json-card">
      <header className="json-card-head">
        <h4>{title}</h4>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => navigator.clipboard.writeText(serialized)}
        >
          Copy
        </button>
      </header>
      <details open>
        <summary>View JSON</summary>
        <pre>{serialized}</pre>
      </details>
    </section>
  );
}
