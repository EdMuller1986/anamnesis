/**
 * Upload / download security policy for medical documents and photos.
 * Mirrors upstream whitelist intent: size limit, MIME+extension allowlist, no SVG/HTML.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB for vaccination photos

/** extension (lowercase, no dot) -> allowed MIME types */
const ALLOWED = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heic', 'image/heif'],
  gif: ['image/gif'],
  txt: ['text/plain'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

const INLINE_SAFE_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export function getExtension(filename) {
  if (!filename || !filename.includes('.')) return '';
  return filename.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Validate File for upload.
 * @returns {{ ok: true, extension: string, mime: string } | { ok: false, error: string, status: number }}
 */
export function validateUpload(file, { maxBytes = MAX_UPLOAD_BYTES, photoOnly = false } = {}) {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'File is required', status: 400 };
  }

  const size = file.size;
  if (typeof size === 'number' && size > maxBytes) {
    return {
      ok: false,
      error: `File too large (max ${Math.floor(maxBytes / (1024 * 1024))} MB)`,
      status: 413,
    };
  }
  if (typeof size === 'number' && size <= 0) {
    return { ok: false, error: 'Empty file', status: 400 };
  }

  const extension = getExtension(file.name || '');
  if (!extension || !ALLOWED[extension]) {
    return {
      ok: false,
      error: `File type not allowed (.${extension || 'unknown'}). Allowed: ${Object.keys(ALLOWED).join(', ')}`,
      status: 415,
    };
  }

  if (photoOnly && !['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'pdf'].includes(extension)) {
    return { ok: false, error: 'Only images or PDF allowed for photos', status: 415 };
  }

  const clientMime = (file.type || '').toLowerCase().split(';')[0].trim();
  const allowedMimes = ALLOWED[extension];

  // Client MIME may be empty on some platforms; if present must match whitelist for extension
  let mime = allowedMimes[0];
  if (clientMime) {
    if (!allowedMimes.includes(clientMime)) {
      // Also reject if client claims a dangerous type even with matching ext
      if (
        clientMime.includes('svg') ||
        clientMime.includes('html') ||
        clientMime.includes('javascript') ||
        clientMime === 'application/xhtml+xml'
      ) {
        return { ok: false, error: 'Disallowed content type', status: 415 };
      }
      return {
        ok: false,
        error: `MIME type ${clientMime} does not match extension .${extension}`,
        status: 415,
      };
    }
    mime = clientMime;
  }

  return { ok: true, extension, mime };
}

/**
 * Response headers for serving stored medical files.
 */
export function fileResponseHeaders(mimeType, fileName, { asAttachment = false } = {}) {
  const mime = (mimeType || 'application/octet-stream').toLowerCase();
  const safeName = encodeURIComponent(fileName || 'document');
  const inline = !asAttachment && INLINE_SAFE_MIME.has(mime);
  const disposition = inline ? 'inline' : 'attachment';

  return {
    'Content-Type': mimeType || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${safeName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}
