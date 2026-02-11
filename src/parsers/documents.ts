export async function parseTextDocument(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const decoder = new TextDecoder('utf-8');

  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.md')
  ) {
    return decoder.decode(buffer);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.endsWith('.docx')
  ) {
    try {
      const content = decoder.decode(buffer);
      const textMatches = content.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      const extractedText = textMatches
        .map((match) => match.replace(/<[^>]+>/g, ''))
        .join(' ');

      if (extractedText.length > 100) {
        return extractedText;
      }

      return content
        .replace(/[^\x20-\x7E\u0400-\u04FF\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000);
    } catch {
      return '[Не удалось распарсить DOCX файл]';
    }
  }

  return '[Неподдерживаемый формат документа]';
}
