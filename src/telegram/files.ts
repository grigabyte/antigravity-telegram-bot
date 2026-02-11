import { TELEGRAM_API_BASE, TELEGRAM_TOKEN, REQUEST_TIMEOUTS } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export async function downloadFile(
  fileId: string,
  suggestedMimeType?: string
): Promise<{ data: string; mimeType: string; buffer: ArrayBuffer; fileName?: string }> {
  const fileRes = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/getFile?file_id=${fileId}`,
    {},
    REQUEST_TIMEOUTS.telegram
  );
  if (!fileRes.ok) {
    const errorText = await fileRes.text();
    throw new Error(`TELEGRAM_GET_FILE_FAILED:${fileRes.status}:${errorText.slice(0, 220)}`);
  }
  const fileData = await fileRes.json();
  const filePath = fileData?.result?.file_path;
  const fileSize = Number(fileData?.result?.file_size || 0);
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('TELEGRAM_GET_FILE_FAILED:missing_file_path');
  }
  if (Number.isFinite(fileSize) && fileSize > MAX_DOWNLOAD_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const response = await fetchWithTimeout(fileUrl, {}, REQUEST_TIMEOUTS.fileDownload);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TELEGRAM_FILE_DOWNLOAD_FAILED:${response.status}:${errorText.slice(0, 220)}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0;
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

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
