export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {}
): string[] {
  const chunkSize = options.chunkSize || 700;
  const overlap = options.overlap || 120;

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + chunkSize);
    const slice = normalized.slice(cursor, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    cursor = Math.max(0, end - overlap);
  }

  return chunks;
}
