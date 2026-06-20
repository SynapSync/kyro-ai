type JsonObject = Record<string, unknown>;

export function mergeJsonObjectContent(existing: string, patchContent: string): string {
  const base = existing.trim() === '' ? {} : parseJsonObject(existing);
  const patch = parseJsonObject(patchContent);
  return `${JSON.stringify(deepMerge(base, patch), null, 2)}\n`;
}

export function removeJsonPathContent(existing: string, jsonPath: string): string {
  if (existing.trim() === '') return `${JSON.stringify({}, null, 2)}\n`;
  const base = parseJsonObject(existing);
  removeJsonPath(base, jsonPath.split('.').filter(Boolean));
  return `${JSON.stringify(base, null, 2)}\n`;
}

function parseJsonObject(content: string): JsonObject {
  const parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(content)) as unknown;
  if (!isPlainObject(parsed)) throw new Error('JSON merge target must be an object');
  return parsed;
}

function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = merged[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      merged[key] = deepMerge(baseValue, patchValue);
    } else {
      merged[key] = patchValue;
    }
  }
  return merged;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeJsonPath(target: JsonObject, path: string[]): void {
  if (path.length === 0) return;
  const [head, ...tail] = path;
  if (tail.length === 0) {
    delete target[head];
    return;
  }
  const child = target[head];
  if (isPlainObject(child)) removeJsonPath(child, tail);
}

function stripJsonCommentsAndTrailingCommas(content: string): string {
  return stripTrailingCommas(stripJsonComments(content));
}

function stripJsonComments(content: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      index += 1;
      while (index + 1 < content.length && content[index + 1] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      index += 1;
      while (index + 1 < content.length && !(content[index] === '*' && content[index + 1] === '/')) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }

  return output;
}

function stripTrailingCommas(content: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      const nextNonWhitespace = findNextNonWhitespace(content, index + 1);
      if (nextNonWhitespace === '}' || nextNonWhitespace === ']') continue;
    }

    output += char;
  }

  return output;
}

function findNextNonWhitespace(content: string, start: number): string | null {
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (!/\s/.test(char)) return char;
  }
  return null;
}
