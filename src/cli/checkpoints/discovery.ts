import { lstatSync, readdirSync } from 'node:fs';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import { EFFECTIVE_CHECKPOINT_STATUS, resolveEffectiveCheckpointAtPath } from './effective';
import type { SprintCloseCheckpointV1 } from '../types';

export const CHECKPOINT_DISCOVERY_STATUS = {
  ABSENT: 'absent',
  SAFE: 'safe',
  UNSAFE_PATH: 'unsafe-path',
  UNREADABLE: 'unreadable',
} as const;

export type CheckpointDiscoveryStatus =
  (typeof CHECKPOINT_DISCOVERY_STATUS)[keyof typeof CHECKPOINT_DISCOVERY_STATUS];

export const MANAGED_PATH_LEVEL = {
  SCOPE_ROOT: 'scope-root',
  SPRINT: 'sprint',
  ARCHIVE: 'archive',
  CHECKPOINT: 'checkpoint',
  RECORD_DIRECTORY: 'record-directory',
} as const;

export type ManagedPathLevel = (typeof MANAGED_PATH_LEVEL)[keyof typeof MANAGED_PATH_LEVEL];

const MANAGED_RECORD_DIRECTORIES: ReadonlySet<string> = new Set([
  'certifications',
  'remediations',
  'checkpoint-remediations',
]);

export interface ManagedPathInspection {
  path: string;
  level: ManagedPathLevel;
  status: CheckpointDiscoveryStatus;
  detail: string;
}

interface CheckpointCandidate {
  file: string;
  path: string;
  level: ManagedPathLevel;
  safeRegularFile: boolean;
  detail: string | null;
}

interface CheckpointDiscoveryResult {
  root: ManagedPathInspection;
  sprint: ManagedPathInspection;
  container: ManagedPathInspection;
  issues: ManagedPathInspection[];
  candidates: CheckpointCandidate[];
}

export interface UsableScopeCheckpoint {
  path: string;
  checkpoint: SprintCloseCheckpointV1;
}

export interface UnusableScopeCheckpoint {
  path: string;
  level: ManagedPathLevel;
  status: string;
  detail: string;
}

/** Canonical safety and recovery facts for one scope's checkpoint path. */
export interface ScopeCheckpointSurvey {
  root: ManagedPathInspection;
  sprint: ManagedPathInspection;
  container: ManagedPathInspection;
  issues: ManagedPathInspection[];
  files: string[];
  safeFiles: string[];
  usable: UsableScopeCheckpoint[];
  unusable: UnusableScopeCheckpoint[];
}

export function surveyScopeCheckpoints(scope: string): ScopeCheckpointSurvey {
  const discovery = discoverCheckpointCandidates(scope);
  const files = discovery.candidates.map((candidate) => candidate.file);
  const safeFiles = discovery.candidates
    .filter((candidate) => candidate.safeRegularFile)
    .map((candidate) => candidate.file);
  const usable: UsableScopeCheckpoint[] = [];
  const unusable: UnusableScopeCheckpoint[] = discovery.issues.map((issue) => ({
    path: issue.path,
    level: issue.level,
    status: issue.status,
    detail: issue.detail,
  }));

  for (const candidate of discovery.candidates) {
    const { path } = candidate;
    if (!candidate.safeRegularFile) {
      unusable.push({
        path,
        level: candidate.level,
        status: CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH,
        detail: candidate.detail ?? 'checkpoint candidate is not a safe regular file',
      });
      continue;
    }
    const resolved = resolveEffectiveCheckpointAtPath(scope, path);
    const resolvedOk =
      resolved.status === EFFECTIVE_CHECKPOINT_STATUS.VALID
      || resolved.status === EFFECTIVE_CHECKPOINT_STATUS.CANONICALIZED;
    if (resolvedOk && resolved.checkpoint && resolved.checkpoint.identity.scope === scope) {
      usable.push({ path, checkpoint: resolved.checkpoint });
    } else {
      unusable.push({
        path,
        level: candidate.level,
        status: resolved.status,
        detail: resolved.detail,
      });
    }
  }

  return {
    root: discovery.root,
    sprint: discovery.sprint,
    container: discovery.container,
    issues: discovery.issues,
    files,
    safeFiles,
    usable,
    unusable,
  };
}

export function inspectManagedDirectory(path: string, level: ManagedPathLevel): ManagedPathInspection {
  return inspectManagedEntry(path, level, true);
}

export function inspectManagedRegularFile(path: string, level: ManagedPathLevel): ManagedPathInspection {
  return inspectManagedEntry(path, level, false);
}

function discoverCheckpointCandidates(scope: string): CheckpointDiscoveryResult {
  const root = inspectManagedDirectory(scopeRoot(scope), MANAGED_PATH_LEVEL.SCOPE_ROOT);
  const directory = archiveDir(scope);
  if (isIssue(root)) {
    const sprint = dependentUnsafeInspection(
      sprintJsonPath(scope),
      MANAGED_PATH_LEVEL.SPRINT,
      root,
    );
    return {
      root,
      sprint,
      container: dependentUnsafeContainer(directory, root),
      issues: [root],
      candidates: [],
    };
  }

  const sprint = inspectManagedRegularFile(sprintJsonPath(scope), MANAGED_PATH_LEVEL.SPRINT);
  const issues = isIssue(sprint) ? [sprint] : [];
  const container = inspectManagedDirectory(directory, MANAGED_PATH_LEVEL.ARCHIVE);
  if (container.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) {
    if (isIssue(container)) issues.push(container);
    return { root, sprint, container, issues, candidates: [] };
  }

  try {
    const entries = readdirSync(assertSafeManagedPath(directory), { withFileTypes: true });
    for (const entry of entries.filter((candidate) => MANAGED_RECORD_DIRECTORIES.has(candidate.name))) {
      const path = `${directory}/${entry.name}`;
      const inspection = entry.isDirectory()
        ? inspectManagedDirectory(path, MANAGED_PATH_LEVEL.RECORD_DIRECTORY)
        : {
          path,
          level: MANAGED_PATH_LEVEL.RECORD_DIRECTORY,
          status: CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH,
          detail: entry.isSymbolicLink()
            ? 'managed record directory is a symbolic link'
            : 'managed record directory is not a real directory',
        } as ManagedPathInspection;
      if (isIssue(inspection)) issues.push(inspection);
    }
    const candidates = entries
      .filter((entry) => entry.name.endsWith('.checkpoint.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry): CheckpointCandidate => {
        const path = `${directory}/${entry.name}`;
        if (!entry.isFile()) {
          return {
            file: entry.name,
            path,
            level: MANAGED_PATH_LEVEL.CHECKPOINT,
            safeRegularFile: false,
            detail: entry.isSymbolicLink()
              ? 'checkpoint path is a symbolic link and cannot be resumed safely'
              : 'checkpoint candidate is not a regular file',
          };
        }
        const inspection = inspectManagedRegularFile(path, MANAGED_PATH_LEVEL.CHECKPOINT);
        if (inspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) {
          return {
            file: entry.name,
            path,
            level: MANAGED_PATH_LEVEL.CHECKPOINT,
            safeRegularFile: false,
            detail: inspection.detail,
          };
        }
        return {
          file: entry.name,
          path,
          level: MANAGED_PATH_LEVEL.CHECKPOINT,
          safeRegularFile: true,
          detail: null,
        };
      });
    return { root, sprint, container, issues, candidates };
  } catch (error) {
    const unreadable = inspectionFromError(directory, MANAGED_PATH_LEVEL.ARCHIVE, error);
    return { root, sprint, container: unreadable, issues: [...issues, unreadable], candidates: [] };
  }
}

function inspectManagedEntry(
  path: string,
  level: ManagedPathLevel,
  expectDirectory: boolean,
): ManagedPathInspection {
  let absolute: string;
  try {
    absolute = assertSafeManagedPath(path);
  } catch (error) {
    return inspectionFromError(path, level, error);
  }
  try {
    const stat = lstatSync(absolute);
    const expectedType = expectDirectory ? stat.isDirectory() : stat.isFile();
    if (!expectedType) {
      return {
        path,
        level,
        status: CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH,
        detail: expectDirectory
          ? 'managed path is not a real directory'
          : 'managed path is not a regular file',
      };
    }
    return { path, level, status: CHECKPOINT_DISCOVERY_STATUS.SAFE, detail: 'managed path is safe' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, level, status: CHECKPOINT_DISCOVERY_STATUS.ABSENT, detail: 'managed path is absent' };
    }
    return inspectionFromError(path, level, error);
  }
}

function dependentUnsafeContainer(path: string, ancestor: ManagedPathInspection): ManagedPathInspection {
  return dependentUnsafeInspection(path, MANAGED_PATH_LEVEL.ARCHIVE, ancestor);
}

function dependentUnsafeInspection(
  path: string,
  level: ManagedPathLevel,
  ancestor: ManagedPathInspection,
): ManagedPathInspection {
  return {
    path,
    level,
    status: ancestor.status,
    detail: `${level} cannot be inspected because ${ancestor.level} is unsafe (${ancestor.detail})`,
  };
}

function inspectionFromError(
  path: string,
  level: ManagedPathLevel,
  error: unknown,
): ManagedPathInspection {
  const code = (error as NodeJS.ErrnoException).code;
  const unreadable = code === 'EACCES' || code === 'EPERM' || code === 'EIO';
  return {
    path,
    level,
    status: unreadable ? CHECKPOINT_DISCOVERY_STATUS.UNREADABLE : CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function isIssue(inspection: ManagedPathInspection): boolean {
  return inspection.status === CHECKPOINT_DISCOVERY_STATUS.UNSAFE_PATH
    || inspection.status === CHECKPOINT_DISCOVERY_STATUS.UNREADABLE;
}
