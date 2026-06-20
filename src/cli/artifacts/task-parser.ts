export interface ParsedSprintTask {
  taskId: string;
  description: string;
  files: string[];
  verification: string | null;
}

export function parseSprintTask(markdown: string, taskId: string): ParsedSprintTask | null {
  const lines = markdown.split(/\r?\n/);
  const start = findTaskLineIndex(lines, taskId);
  if (start === -1) return null;

  const heading = lines[start];
  const boldMatch = heading.match(/^- \[[ x!~]\] \*\*(T\d+\.\d+)\*\*:\s*(.+)$/);
  const plainMatch = heading.match(/^- \[[ x!~]\] (T\d+\.\d+)\s+(.+)$/);
  const description = boldMatch?.[2]?.trim() ?? plainMatch?.[2]?.trim() ?? '';
  const files: string[] = [];
  let verification: string | null = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (isTaskBoundary(line)) break;

    const filesMatch = line.match(/^\s*- Files:\s*(.+)$/);
    if (filesMatch) {
      files.push(...extractBacktickPaths(filesMatch[1]));
      continue;
    }

    const verifyMatch = line.match(/^\s*- Verification:\s*(.+)$/);
    if (verifyMatch) {
      verification = verifyMatch[1].trim();
    }
  }

  return { taskId, description, files, verification };
}

function findTaskLineIndex(lines: string[], taskId: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    const boldMatch = lines[i].match(/^- \[[ x!~]\] \*\*(T\d+\.\d+)\*\*:/);
    if (boldMatch && boldMatch[1] === taskId) return i;
    const plainMatch = lines[i].match(/^- \[[ x!~]\] (T\d+\.\d+)\b/);
    if (plainMatch && plainMatch[1] === taskId) return i;
  }
  return -1;
}

function isTaskBoundary(line: string): boolean {
  return /^- \[[ x!~]\] \*\*T\d+\.\d+\*\*:/.test(line)
    || /^- \[[ x!~]\] T\d+\.\d+\b/.test(line)
    || /^#{2,3} /.test(line);
}

function extractBacktickPaths(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}