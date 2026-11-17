/**
 * Parse the stdout of `npm pack --json` into the single pack record.
 *
 * npm 10 and earlier print an array: `[ { id, name, version, filename, files, ... } ]`.
 * npm 12 prints an object keyed by package name: `{ "kyro-ai": { id, name, version, ... } }`.
 * The record fields (`version`, `filename`, `files[].path`) are the same in both shapes.
 *
 * @param {string} stdout raw stdout of `npm pack --json` for exactly one package
 * @returns {{ version: string, filename: string, files: Array<{ path: string }> } & Record<string, unknown>}
 */
export function parseNpmPackJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm pack --json output is not JSON (${error.message}): ${String(stdout).slice(0, 200)}`);
  }
  let record;
  if (Array.isArray(parsed)) {
    record = parsed[0];
  } else if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed);
    record = values.length === 1 ? values[0] : undefined;
  }
  if (!record || typeof record !== 'object' || typeof record.version !== 'string' || typeof record.filename !== 'string') {
    throw new Error(`npm pack --json output has no usable pack record (expected an array or an object keyed by package name with version and filename), got: ${String(stdout).slice(0, 200)}`);
  }
  return record;
}
