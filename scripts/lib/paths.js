#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function debugLog(msg) {
  if (process.env.KYRO_DEBUG === '1') {
    console.error(`[Kyro:debug] ${msg}`);
  }
}

function getKyroDir() {
  return path.join(process.cwd(), '.agents', 'sprint-forge');
}

function getSprintForgeDir() {
  return getKyroDir();
}

function getRulesPath() {
  return path.join(getKyroDir(), 'rules.md');
}

function getActiveSessionPath() {
  return path.join(getKyroDir(), '.active-session');
}

function getDistDir() {
  return path.join(__dirname, '..', '..', 'dist');
}

function findProjectDirs() {
  const forgeDir = getSprintForgeDir();
  if (!fs.existsSync(forgeDir)) return [];
  return fs.readdirSync(forgeDir)
    .filter(f => {
      try { return fs.statSync(path.join(forgeDir, f)).isDirectory(); }
      catch (_) { return false; }
    })
    .map(name => ({
      name,
      dir: path.join(forgeDir, name)
    }));
}

function findActiveProject() {
  // Try .active-session first (validated reader)
  const data = readActiveSession();
  if (data && data.projectDir && fs.existsSync(data.projectDir)) {
    return {
      name: data.project || path.basename(data.projectDir),
      dir: data.projectDir,
      sprintsDir: path.join(data.projectDir, 'sprints'),
      reentryPath: path.join(data.projectDir, 'RE-ENTRY.md')
    };
  }

  // Fall back to scanning sprint-forge/
  const projects = findProjectDirs();
  if (projects.length === 0) return null;
  const p = projects[0];
  return {
    name: p.name,
    dir: p.dir,
    sprintsDir: path.join(p.dir, 'sprints'),
    reentryPath: path.join(p.dir, 'RE-ENTRY.md')
  };
}

function getSprintsDir(projectDir) {
  return path.join(projectDir, 'sprints');
}

function getReentryPath(projectDir) {
  return path.join(projectDir, 'RE-ENTRY.md');
}

function isSprintActive(content) {
  return /status:\s*["']?active["']?/i.test(content);
}

function findLatestSprint(sprintsDir) {
  if (!fs.existsSync(sprintsDir)) return null;
  const files = fs.readdirSync(sprintsDir).filter(f => f.endsWith('.md')).sort();
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  const content = fs.readFileSync(path.join(sprintsDir, file), 'utf8');
  return { file, content };
}

function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

function readActiveSession() {
  const sessionPath = getActiveSessionPath();
  try {
    if (!fs.existsSync(sessionPath)) return null;
    const raw = fs.readFileSync(sessionPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.sessionId || !data.project) {
      debugLog('readActiveSession: missing required fields');
      return null;
    }
    return data;
  } catch (e) {
    debugLog('readActiveSession: ' + e.message);
    return null;
  }
}

module.exports = {
  debugLog,
  getKyroDir,
  getSprintForgeDir,
  getRulesPath,
  getActiveSessionPath,
  getDistDir,
  findProjectDirs,
  findActiveProject,
  getSprintsDir,
  getReentryPath,
  isSprintActive,
  findLatestSprint,
  writeJsonAtomic,
  readActiveSession
};
