export function redactHeaders(
  headers: Record<string, unknown> | undefined,
  redactKeys: string[]
): Record<string, unknown> {
  if (!headers) {
    return {};
  }

  const denySet = new Set(redactKeys.map((key) => key.toLowerCase()));
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    copy[key] = denySet.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return copy;
}

export function clampBody(payload: unknown, maxBodySizeBytes: number): unknown {
  if (payload === undefined || payload === null) {
    return payload;
  }

  try {
    const asString = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (asString.length <= maxBodySizeBytes) {
      return payload;
    }

    return {
      _truncated: true,
      _sizeBytes: asString.length,
      _preview: asString.slice(0, maxBodySizeBytes)
    };
  } catch {
    return "[Unserializable payload]";
  }
}
