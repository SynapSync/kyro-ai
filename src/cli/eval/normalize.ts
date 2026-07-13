export function normalizeSprintJson(value: unknown, sandboxRoot: string): unknown {
  return normalizeValue(value, sandboxRoot, []);
}

function normalizeValue(value: unknown, sandboxRoot: string, path: string[]): unknown {
  const field = path[path.length - 1];
  if (typeof value === 'string') {
    if (field === 'lastUpdated' || field === 'closedAt' || field === 'date' || field === 'checkpointSha256') return '<NORMALIZED>';
    return sandboxRoot ? value.replaceAll(sandboxRoot, '<SANDBOX>') : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeValue(item, sandboxRoot, [...path, String(index)]));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = normalizeValue(child, sandboxRoot, [...path, key]);
    return out;
  }
  return value;
}

export function deepEqualNormalized(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
