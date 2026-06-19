export function upsertManagedBlock(existing: string, blockName: string, content: string): string {
  const block = formatManagedBlock(blockName, content);
  const pattern = managedBlockPattern(blockName);
  if (pattern.test(existing)) {
    return existing.replace(pattern, block);
  }
  const separator = existing.trim().length === 0 ? '' : '\n\n';
  return `${existing.trimEnd()}${separator}${block}\n`;
}

export function removeManagedBlock(existing: string, blockName: string): string {
  return existing.replace(managedBlockPattern(blockName), '').trimEnd() + '\n';
}

export function hasManagedBlockContent(existing: string, blockName: string): boolean {
  return existing.includes(startMarker(blockName)) && existing.includes(endMarker(blockName));
}

export function formatManagedBlock(blockName: string, content: string): string {
  return `${startMarker(blockName)}\n${content.trim()}\n${endMarker(blockName)}`;
}

export function startMarker(blockName: string): string {
  return `<!-- kyro-ai:${blockName}:start -->`;
}

export function endMarker(blockName: string): string {
  return `<!-- kyro-ai:${blockName}:end -->`;
}

function managedBlockPattern(blockName: string): RegExp {
  return new RegExp(`${escapeRegExp(startMarker(blockName))}[\\s\\S]*?${escapeRegExp(endMarker(blockName))}\\n?`, 'm');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
