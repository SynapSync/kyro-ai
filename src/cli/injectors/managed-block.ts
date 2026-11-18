export type ManagedBlockCommentStyle = 'html' | 'hash';

export function upsertManagedBlock(existing: string, blockName: string, content: string, style: ManagedBlockCommentStyle = 'html'): string {
  const block = formatManagedBlock(blockName, content, style);
  const pattern = managedBlockPattern(blockName, style);
  if (style === 'hash') {
    const adopted = adoptUnmarkedTomlTable(existing, content, pattern);
    if (adopted === null) return existing;
    existing = adopted;
  }
  if (pattern.test(existing)) {
    // The pattern consumes one newline after the end marker. Keep it, so replacing a block never
    // joins the marker to the content that follows it.
    return existing.replace(pattern, (match) => (match.endsWith('\n') ? `${block}\n` : block));
  }
  const separator = existing.trim().length === 0 ? '' : '\n\n';
  return `${existing.trimEnd()}${separator}${block}\n`;
}

export function removeManagedBlock(existing: string, blockName: string, style: ManagedBlockCommentStyle = 'html'): string {
  return existing.replace(managedBlockPattern(blockName, style), '').trimEnd() + '\n';
}

export function hasManagedBlockContent(existing: string, blockName: string, style: ManagedBlockCommentStyle = 'html'): boolean {
  return existing.includes(startMarker(blockName, style)) && existing.includes(endMarker(blockName, style));
}

export function formatManagedBlock(blockName: string, content: string, style: ManagedBlockCommentStyle = 'html'): string {
  return `${startMarker(blockName, style)}\n${content.trim()}\n${endMarker(blockName, style)}`;
}

export function startMarker(blockName: string, style: ManagedBlockCommentStyle = 'html'): string {
  return style === 'hash' ? `# kyro-ai:${blockName}:start` : `<!-- kyro-ai:${blockName}:start -->`;
}

export function endMarker(blockName: string, style: ManagedBlockCommentStyle = 'html'): string {
  return style === 'hash' ? `# kyro-ai:${blockName}:end` : `<!-- kyro-ai:${blockName}:end -->`;
}

function managedBlockPattern(blockName: string, style: ManagedBlockCommentStyle): RegExp {
  return new RegExp(`${escapeRegExp(startMarker(blockName, style))}[\\s\\S]*?${escapeRegExp(endMarker(blockName, style))}\\n?`, 'm');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * TOML forbids two tables with the same header, so a managed block that holds a table must not be
 * added next to an unmarked copy of that table (a hand-written or pre-marker Kyro entry). Returns
 * the text to upsert into: the input when there is no unmarked copy; the input without the copy
 * when it holds only Kyro's own keys (`command`, `args`), which the managed block then replaces;
 * or null when the copy carries anything else (sub-tables, `env`, ...), which is the user's
 * configuration and is left untouched with no second table added.
 */
function adoptUnmarkedTomlTable(existing: string, content: string, pattern: RegExp): string | null {
  const header = /^\s*\[([^\]\n]+)\]\s*$/m.exec(content)?.[1]?.trim();
  if (!header) return existing;
  const normalizeHeader = (value: string): string => value.replace(/\s+/g, '').replace(/"/g, '');
  const wanted = normalizeHeader(header);
  const blockMatch = pattern.exec(existing);
  const blockStart = blockMatch ? blockMatch.index : -1;
  const blockEnd = blockMatch ? blockMatch.index + blockMatch[0].length : -1;
  const lines = existing.split('\n');
  let offset = 0;
  const spans: Array<{ start: number; end: number; keys: string[]; lineStart: number; lineEnd: number }> = [];
  let open: { start: number; keys: string[]; lineStart: number; unmarked: boolean } | null = null;
  const close = (end: number, lineEnd: number): void => {
    if (open && open.unmarked) spans.push({ start: open.start, end, keys: open.keys, lineStart: open.lineStart, lineEnd });
    open = null;
  };
  let subTable = false;
  lines.forEach((line, index) => {
    const lineStart = offset;
    offset += line.length + 1;
    const inBlock = blockStart >= 0 && lineStart >= blockStart && lineStart < blockEnd;
    const headerMatch = /^\s*\[\[?([^\]\n]+)\]\]?\s*(#.*)?$/.exec(line);
    if (headerMatch) {
      close(lineStart, index);
      const name = normalizeHeader(headerMatch[1]!);
      if (!inBlock && name.startsWith(`${wanted}.`)) subTable = true;
      if (!inBlock && name === wanted) open = { start: lineStart, keys: [], lineStart: index, unmarked: true };
      return;
    }
    if (open && !inBlock) {
      const key = /^\s*([A-Za-z0-9_.\-"']+)\s*=/.exec(line)?.[1];
      if (key) open.keys.push(key.replace(/["']/g, ''));
    }
  });
  close(offset, lines.length);
  if (spans.length === 0 && !subTable) return existing;
  if (subTable || spans.some((span) => span.keys.some((key) => key !== 'command' && key !== 'args'))) return null;
  let result = existing;
  for (const span of [...spans].reverse()) {
    result = `${result.slice(0, span.start)}${result.slice(Math.min(span.end, result.length))}`;
  }
  return result.replace(/\n{3,}/g, '\n\n');
}
