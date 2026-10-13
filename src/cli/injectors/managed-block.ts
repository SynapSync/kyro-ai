export type ManagedBlockCommentStyle = 'html' | 'hash';

export function upsertManagedBlock(existing: string, blockName: string, content: string, style: ManagedBlockCommentStyle = 'html'): string {
  const block = formatManagedBlock(blockName, content, style);
  const pattern = managedBlockPattern(blockName, style);
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
