import { KYRO_MANIFEST_PATH, KYRO_STATE_PATH } from './constants';
import { readJsonFromManagedPath, readJsonFromWorkspace } from './fs';
import type { KyroManifest, KyroProjectState } from './types';

export function readProjectState(): KyroProjectState | null {
  return readJsonFromWorkspace<KyroProjectState>(KYRO_STATE_PATH);
}

export function readManifest(): KyroManifest | null {
  return readJsonFromManagedPath<KyroManifest>(KYRO_MANIFEST_PATH);
}
