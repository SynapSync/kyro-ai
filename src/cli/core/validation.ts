import { readJsonSafely } from '../artifacts/json';
import { KYRO_PROJECT_ROOT } from '../constants';
import type { ContextPackValidation, ValidationMap, ValidationTaskRule } from '../types';

export const VALIDATION_MAP_PATH = `${KYRO_PROJECT_ROOT}/validation.json`;

export interface LoadedValidationMap {
  map: ValidationMap | null;
  issues: string[];
}

/** Optional project-owned map. Absent → null without issues; invalid → null with issues (never throws). */
export function loadValidationMap(): LoadedValidationMap {
  const read = readJsonSafely(VALIDATION_MAP_PATH);
  if (!read.exists) return { map: null, issues: [] };
  if (read.error) return { map: null, issues: [`${VALIDATION_MAP_PATH}: invalid JSON (${read.error})`] };
  const issues = validateValidationMap(read.value).map((issue) => `${VALIDATION_MAP_PATH} ${issue}`);
  if (issues.length > 0) return { map: null, issues };
  const value = read.value as Partial<ValidationMap>;
  return {
    map: {
      validationVersion: 1,
      task: (value.task ?? []).map((rule) => ({ id: rule.id, paths: [...rule.paths], commands: [...rule.commands] })),
      fallback: [...(value.fallback ?? [])],
      // Required by validateValidationMap: an omitted close is invalid, an explicit [] declares no aggregate.
      close: [...(value.close ?? [])],
    },
    issues: [],
  };
}

export function validateValidationMap(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['<root>: must be an object'];
  if (value.validationVersion !== 1) issues.push('validationVersion: must be literal 1');
  for (const key of Object.keys(value)) {
    if (!['validationVersion', 'task', 'fallback', 'close'].includes(key)) issues.push(`${key}: unknown field`);
  }
  if ('task' in value) {
    if (!Array.isArray(value.task)) {
      issues.push('task: must be an array');
    } else {
      const ids = new Set<string>();
      value.task.forEach((rule, index) => {
        const field = `task[${index}]`;
        if (!isRecord(rule)) { issues.push(`${field}: must be an object`); return; }
        if (typeof rule.id !== 'string' || !rule.id.trim()) issues.push(`${field}.id: must be a non-empty string`);
        else if (ids.has(rule.id)) issues.push(`${field}.id: duplicate rule id "${rule.id}"`);
        else ids.add(rule.id);
        if (!isNonEmptyStringArray(rule.paths)) issues.push(`${field}.paths: must be a non-empty array of strings`);
        if (!isNonEmptyStringArray(rule.commands)) issues.push(`${field}.commands: must be a non-empty array of strings`);
      });
    }
  }
  for (const key of ['task', 'fallback', 'close'] as const) {
    if (!(key in value)) issues.push(`${key}: required (use [] for none)`);
  }
  for (const key of ['fallback', 'close'] as const) {
    if (key in value && !isStringArray(value[key])) issues.push(`${key}: must be an array of strings`);
  }
  return issues;
}

/**
 * Resolves both tiers for a pack. Task tier: commands of every rule matching any task file (declared rule
 * order), then `fallback` when any file matched no rule (or there are no files), de-duplicated globally.
 * `uncoveredFiles` lists files without a rule — "no rule", never "validated". Scope packs get only close.
 */
export function resolveValidation(taskFiles: string[] | null, loaded: LoadedValidationMap = loadValidationMap()): ContextPackValidation {
  const { map } = loaded;
  const issues = loaded.issues.map((issue) => `validation map ignored: ${issue}`);
  if (!map) return { source: 'none', task: [], matchedRules: [], uncoveredFiles: [], close: [], issues };
  if (taskFiles === null) return { source: 'validation.json', task: [], matchedRules: [], uncoveredFiles: [], close: [...map.close], issues };
  const files = taskFiles.map(normalizeTaskFile).filter(Boolean);
  const matched = map.task.filter((rule) => files.some((file) => ruleMatches(rule, file)));
  const uncoveredFiles = files.filter((file) => !map.task.some((rule) => ruleMatches(rule, file)));
  const needsFallback = files.length === 0 || uncoveredFiles.length > 0;
  const commands = [...matched.flatMap((rule) => rule.commands), ...(needsFallback ? map.fallback : [])];
  if (uncoveredFiles.length > 0 && map.fallback.length === 0) {
    issues.push(`validation: no rule or fallback covers ${uncoveredFiles.join(', ')} — choose focused checks for them`);
  }
  return {
    source: 'validation.json',
    task: [...new Set(commands)],
    matchedRules: matched.map((rule) => rule.id),
    uncoveredFiles,
    close: [...map.close],
    issues,
  };
}

const AGGREGATE_PHRASES = /\b(full|entire|whole|complete|aggregate)\s+(project\s+|repository\s+|repo\s+)?(test\s+|validation\s+|check\s+)?(suite|check)\b|\bsuite\s+complet[ao]\b/i;

/**
 * Close-tier commands or aggregate-suite phrases named in a task criterion. Close commands that a task
 * rule or the fallback also uses (e.g. `npm run build`) are focused, so they never count as aggregate.
 */
export function aggregateValidationMentions(criterion: string, map: ValidationMap | null): string[] {
  const hits: string[] = [];
  const phrase = AGGREGATE_PHRASES.exec(criterion);
  if (phrase) hits.push(phrase[0]);
  if (map) {
    const focused = new Set([...map.fallback, ...map.task.flatMap((rule) => rule.commands)]);
    for (const command of map.close) {
      if (!focused.has(command) && mentionsCommand(criterion, command)) hits.push(command);
    }
  }
  return hits;
}

function mentionsCommand(text: string, command: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(command, from);
    if (at < 0) return false;
    const next = text.charAt(at + command.length);
    if (!/[\w:-]/.test(next)) return true;
    from = at + 1;
  }
}

function ruleMatches(rule: ValidationTaskRule, file: string): boolean {
  return rule.paths.some((pattern) => pathMatches(normalizePath(pattern), file));
}

function pathMatches(pattern: string, file: string): boolean {
  if (!/[*?]/.test(pattern)) {
    const dir = pattern.replace(/\/+$/, '');
    return file === dir || file.startsWith(`${dir}/`);
  }
  return globToRegExp(pattern).test(file);
}

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') { i += 1; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const TASK_FILE_ANNOTATION = /\s+\((?:new|created|modified|deleted|removed|renamed)\)$/i;

/**
 * Task files may end with one recognized change marker ("src/a.ts (new)"); only that marker is removed.
 * Spaces and any other parenthesized text belong to the path. Configured patterns are never trimmed.
 */
function normalizeTaskFile(value: string): string {
  return normalizePath(value.trim().replace(TASK_FILE_ANNOTATION, ''));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0;
}
