import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_ROOT } from '../constants';
import {
  CHECKPOINT_DISCOVERY_STATUS,
  inspectManagedDirectory,
  inspectManagedRegularFile,
  MANAGED_PATH_LEVEL,
  surveyScopeCheckpoints,
} from '../checkpoints/discovery';
import { resolveManagedPath } from '../fs';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import { readProjectState } from '../state';
import { readJsonSafely } from './json';
import { archiveDir, scopeRoot, sprintJsonPath } from './paths';
import { asSprintFile, validateSprintFile } from './schema';
import type { Dirent } from 'node:fs';
import type { ManagedPathInspection } from '../checkpoints/discovery';
import type { SprintFile } from '../types';

/**
 * What a directory under `.agents/kyro/scopes/` actually is.
 *
 * Scope identity used to be inferred from "a directory exists here", which made any stray folder — a
 * manual backup, an editor artifact, a half-finished checkout — a hard integrity blocker, and let
 * install/sync persist it into project.json as a real scope. Identity now comes from evidence.
 *
 * The two failure modes this taxonomy exists to keep apart:
 * - Refusing to call a directory a scope must not hide a scope that lost its sprint.json but still
 *   has resumable checkpoints (RECOVERABLE) — that is exactly what recover mode rescues.
 * - Finding *something* Kyro-shaped must not promise a recovery that does not exist
 *   (OWNED_DAMAGED). Remediation records, certifications, a retirement checkpoint, or a corrupt
 *   checkpoint prove ownership, not resumability.
 */
export const SCOPE_DIR_CLASS = {
  VALID_SCOPE: 'valid-scope',
  CORRUPT_SPRINT: 'corrupt-sprint',
  RECOVERABLE: 'recoverable',
  OWNED_DAMAGED: 'owned-damaged',
  FOREIGN: 'foreign',
} as const;

export type ScopeDirClass = (typeof SCOPE_DIR_CLASS)[keyof typeof SCOPE_DIR_CLASS];

export interface ScopeDirectory {
  id: string;
  class: ScopeDirClass;
  detail: string;
  issues: ManagedPathInspection[];
}

/** Kyro-owned directories: everything except foreign. */
const OWNED_CLASSES: ReadonlySet<ScopeDirClass> = new Set([
  SCOPE_DIR_CLASS.VALID_SCOPE,
  SCOPE_DIR_CLASS.CORRUPT_SPRINT,
  SCOPE_DIR_CLASS.RECOVERABLE,
  SCOPE_DIR_CLASS.OWNED_DAMAGED,
]);

const CHECKPOINT_LEVELS: ReadonlySet<ManagedPathInspection['level']> = new Set([
  MANAGED_PATH_LEVEL.CHECKPOINT,
]);

/** Files only Kyro writes directly under a scope root. `sprint.json` is classified before these. */
const OWNED_ROOT_FILES = ['retirement.checkpoint.json'] as const;

/**
 * Subdirectories of `archive/` whose names Kyro alone chooses, each paired with the record filename
 * its writer produces. The directory name alone is not evidence: an empty `remediations/` holds no
 * history to protect, so it stays foreign. A record whose *contents* are corrupt still counts — the
 * recognizable name is what proves Kyro wrote here, not whether the bytes still parse.
 *
 * The index is three digits or more because every writer pads to three
 * (`String(n).padStart(3, '0')`, ids constrained to `/^R-\d{3,}$/` and `/^C-\d{3,}$/`). Accepting
 * `remediation-1.json` would recognize a name Kyro cannot produce.
 */
const OWNED_ARCHIVE_RECORD_DIRS: ReadonlyMap<string, RegExp> = new Map([
  ['certifications', /^certification-\d{3,}\.json$/],
  ['remediations', /^remediation-\d{3,}\.json$/],
  ['checkpoint-remediations', /^canonicalization-\d{3,}\.json$/],
]);

/** The close artifacts: `archive/sprint-001-slug.json`, `.md` and `.checkpoint.json`. */
const OWNED_ARCHIVE_FILE = /^sprint-\d{3,}-.+\.(?:json|md)$/;

export type ScopeSprintRead =
  | { kind: 'valid'; sprint: SprintFile }
  | { kind: 'invalid'; detail: string }
  | { kind: 'unsafe'; issue: ManagedPathInspection }
  | { kind: 'absent' };

/**
 * Single reader for "what is this scope's sprint.json". Previously duplicated in
 * project/reconcile.ts (deriveFromSprint) and core/scopes.ts (discoverScopeEntry), each with
 * slightly different tolerance; both now consume this.
 */
export function readScopeSprint(id: string): ScopeSprintRead {
  const path = sprintJsonPath(id);
  const inspection = inspectManagedRegularFile(path, MANAGED_PATH_LEVEL.SPRINT);
  if (inspection.status === CHECKPOINT_DISCOVERY_STATUS.ABSENT) return { kind: 'absent' };
  if (inspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) return { kind: 'unsafe', issue: inspection };
  const read = readJsonSafely(path);
  if (!read.exists) {
    return {
      kind: 'unsafe',
      issue: {
        path,
        level: MANAGED_PATH_LEVEL.SPRINT,
        status: CHECKPOINT_DISCOVERY_STATUS.UNREADABLE,
        detail: 'sprint.json disappeared after its safety inspection',
      },
    };
  }
  if (read.error) return { kind: 'invalid', detail: `invalid JSON (${read.error})` };
  const issues = validateSprintFile(read.value, path);
  if (issues.length > 0) {
    return { kind: 'invalid', detail: issues.map((issue) => `${issue.field} ${issue.message}`).join('; ') };
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) return { kind: 'invalid', detail: 'does not match the v4 sprint shape' };
  return { kind: 'valid', sprint };
}

export function classifyScopeDirectory(id: string): ScopeDirectory {
  const checkpoints = surveyScopeCheckpoints(id);
  const issues = collectSafetyIssues(checkpoints.issues, checkpoints.unusable);
  const sprint = readScopeSprint(id);
  if (sprint.kind === 'valid') {
    return { id, class: SCOPE_DIR_CLASS.VALID_SCOPE, detail: detailWithIssues('sprint.json is valid', issues), issues };
  }
  if (sprint.kind === 'invalid') {
    return {
      id,
      class: SCOPE_DIR_CLASS.CORRUPT_SPRINT,
      detail: detailWithIssues(`sprint.json is present but invalid (${sprint.detail})`, issues),
      issues,
    };
  }
  if (sprint.kind === 'unsafe' && !issues.some((issue) => issue.path === sprint.issue.path)) {
    issues.push(sprint.issue);
  }
  if (checkpoints.usable.length > 0 && issues.length === 0) {
    return {
      id,
      class: SCOPE_DIR_CLASS.RECOVERABLE,
      detail: 'sprint.json is absent but a usable close checkpoint exists',
      issues,
    };
  }
  const ownedMarker = hasOwnedMarkers(id);
  const checkpointEvidence = checkpoints.files.length > 0 || checkpoints.unusable.some(isCheckpointEvidence);
  if (checkpointEvidence || ownedMarker) {
    const unsafe = issues[0];
    const detail = unsafe
      ? `managed path is unsafe at ${unsafe.level} (${unsafe.path}: ${unsafe.detail})`
      : 'Kyro artifacts are present but no usable close checkpoint exists';
    return { id, class: SCOPE_DIR_CLASS.OWNED_DAMAGED, detail, issues };
  }
  return {
    id,
    class: SCOPE_DIR_CLASS.FOREIGN,
    detail: detailWithIssues('no recognizable Kyro artifacts', issues),
    issues,
  };
}

export function classifyScopeDirectories(): ScopeDirectory[] {
  return listNamespaceEntries().map((id) => classifyScopeDirectory(id));
}

/**
 * Directories Kyro owns, whatever their health. This is what discovery, resolution, Doctor and
 * integrity prepare consume: a corrupt or recoverable scope must stay visible so it can be
 * diagnosed, while a foreign directory must never enter any of those paths.
 */
export function listOwnedScopeDirectories(): string[] {
  return classifyScopeDirectories()
    .filter((entry) => OWNED_CLASSES.has(entry.class))
    .map((entry) => entry.id)
    .sort();
}

/** Only directories Kyro can describe truthfully in project.json. */
export function listRegistrableScopeDirectories(): string[] {
  return classifyScopeDirectories()
    .filter((entry) => entry.class === SCOPE_DIR_CLASS.VALID_SCOPE && entry.issues.length === 0)
    .map((entry) => entry.id)
    .sort();
}

/** Directories under scopes/ that are not Kyro's, surfaced by global Doctor as advisory only. */
export function listForeignScopeDirectories(): ScopeDirectory[] {
  return classifyScopeDirectories().filter((entry) => entry.class === SCOPE_DIR_CLASS.FOREIGN);
}

/** Compatibility wrapper. Prefer listOwnedScopeDirectories() — the name says what it returns. */
export function listScopeFolders(): string[] {
  return listOwnedScopeDirectories();
}

export function listScopeNames(): string[] {
  const names = new Set<string>();
  const projectState = readProjectState();
  if (projectState) {
    for (const scope of projectState.scopes) names.add(scope.id);
    if (projectState.activeScope) names.add(projectState.activeScope);
  }
  for (const scope of listOwnedScopeDirectories()) names.add(scope);
  return [...names].sort();
}

function listNamespaceEntries(): string[] {
  const root = assertSafeManagedPath(ARTIFACT_ROOT);
  try {
    return readdirSync(root, { withFileTypes: true }).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Evidence that Kyro — not a human or another tool — created this directory.
 *
 * Only names Kyro itself writes count. The existence of `archive/`, or anything at all inside it,
 * proves nothing: `archive/` is an ordinary word, so `notes-backup/archive/README.md` would
 * otherwise turn a human's folder into an owned-damaged scope and a project-wide blocker — the same
 * class of defect as inferring a scope from a directory existing, one level deeper.
 *
 * A leftover `trace/` is deliberately not a marker: trace moved out of scopes/ after 4.47.0
 * precisely because a trace write could manufacture a directory discovery mistook for a scope.
 */
function hasOwnedMarkers(id: string): boolean {
  const rootInspection = inspectManagedDirectory(scopeRoot(id), MANAGED_PATH_LEVEL.SCOPE_ROOT);
  if (rootInspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) return false;
  const root = rootInspection.path;
  for (const file of OWNED_ROOT_FILES) {
    if (isRegularFile(join(root, file))) return true;
  }
  return hasOwnedArchiveEntries(archiveDir(id));
}

/**
 * Name-only evidence must come from a real file. `existsSync` follows symlinks, so a link named
 * `retirement.checkpoint.json` would otherwise let anything on the filesystem claim ownership of a
 * directory — the name is the whole proof here, and a link is not the thing it names.
 */
function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function hasOwnedArchiveEntries(archive: string): boolean {
  const inspection = inspectManagedDirectory(archive, MANAGED_PATH_LEVEL.ARCHIVE);
  if (inspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(resolveManagedPath(archive), { withFileTypes: true });
  } catch {
    // Absent or unreadable: no evidence either way, so not a marker.
    return false;
  }
  return entries.some((entry) => {
    if (entry.isDirectory()) return hasRecord(join(archive, entry.name), OWNED_ARCHIVE_RECORD_DIRS.get(entry.name));
    if (!entry.isFile()) return false;
    // Any *.checkpoint.json counts, matching what the checkpoint survey scans: a checkpoint that is
    // corrupt or names another scope must classify as owned-damaged, never as foreign.
    return entry.name.endsWith('.checkpoint.json') || OWNED_ARCHIVE_FILE.test(entry.name);
  });
}

/** True when the directory holds at least one regular file whose name Kyro's writer produces. */
function hasRecord(directory: string, pattern: RegExp | undefined): boolean {
  if (!pattern) return false;
  const inspection = inspectManagedDirectory(directory, MANAGED_PATH_LEVEL.RECORD_DIRECTORY);
  if (inspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) return false;
  try {
    return readdirSync(directory, { withFileTypes: true })
      .some((entry) => entry.isFile() && pattern.test(entry.name));
  } catch {
    return false;
  }
}

function collectSafetyIssues(
  inspections: ManagedPathInspection[],
  unusable: Array<{ path: string; level: ManagedPathInspection['level']; status: string; detail: string }>,
): ManagedPathInspection[] {
  const issues = [...inspections];
  for (const candidate of unusable) {
    if (candidate.status !== CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH
      && candidate.status !== CHECKPOINT_DISCOVERY_STATUS.UNREADABLE) continue;
    if (issues.some((issue) => issue.path === candidate.path && issue.status === candidate.status)) continue;
    issues.push({
      path: candidate.path,
      level: candidate.level,
      status: candidate.status,
      detail: candidate.detail,
    });
  }
  return issues;
}

function isCheckpointEvidence(candidate: { level: ManagedPathInspection['level'] }): boolean {
  return CHECKPOINT_LEVELS.has(candidate.level);
}

function detailWithIssues(detail: string, issues: ManagedPathInspection[]): string {
  if (issues.length === 0) return detail;
  const issue = issues[0]!;
  return `${detail}; managed path is unsafe (${issue.path}: ${issue.detail})`;
}
