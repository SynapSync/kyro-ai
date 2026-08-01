#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
rmSync(resolve(root, 'dist'), { recursive: true, force: true });
