#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getKyroDir() {
  return path.join(process.cwd(), '.agents', 'kyro-workflow');
}

function getSprintForgeDir() {
  return path.join(getKyroDir(), 'sprint-forge');
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
  // Try .active-session first
  const sessionPath = getActiveSessionPath();
  try {
    if (fs.existsSync(sessionPath)) {
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (data.projectDir && fs.existsSync(data.projectDir)) {
        return {
          name: data.project || path.basename(data.projectDir),
          dir: data.projectDir,
          sprintsDir: path.join(data.projectDir, 'sprints'),
          reentryPath: path.join(data.projectDir, 'RE-ENTRY.md')
        };
      }
    }
  } catch (_) {}

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

function findLatestSprint(sprintsDir) {
  if (!fs.existsSync(sprintsDir)) return null;
  const files = fs.readdirSync(sprintsDir).filter(f => f.endsWith('.md')).sort();
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  const content = fs.readFileSync(path.join(sprintsDir, file), 'utf8');
  return { file, content };
}

module.exports = {
  getKyroDir,
  getSprintForgeDir,
  getRulesPath,
  getActiveSessionPath,
  getDistDir,
  findProjectDirs,
  findActiveProject,
  getSprintsDir,
  getReentryPath,
  findLatestSprint
};
