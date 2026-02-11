import { TELEGRAM_API_BASE, TELEGRAM_TOKEN, REQUEST_TIMEOUTS } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';

export async function downloadFile(
  fileId: string,
  suggestedMimeType?: string
): Promise<{ data: string; mimeType: string; buffer: ArrayBuffer; fileName?: string }> {
  const fileRes = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/getFile?file_id=${fileId}`,
    {},
    REQUEST_TIMEOUTS.telegram
  );
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const response = await fetchWithTimeout(fileUrl, {}, REQUEST_TIMEOUTS.fileDownload);
  const buffer = await response.arrayBuffer();

  let mimeType = suggestedMimeType || 'application/octet-stream';

  if (!suggestedMimeType || suggestedMimeType === 'application/octet-stream') {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    if (ext && mimeMap[ext]) {
      mimeType = mimeMap[ext];
    }
  }

  return {
    data: Buffer.from(buffer).toString('base64'),
    mimeType,
    buffer,
    fileName: filePath.split('/').pop(),
  };
}
