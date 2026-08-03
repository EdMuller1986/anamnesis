/**
 * Upload / download security policy for medical documents and photos.
 * Size limit, MIME+extension allowlist, magic-byte sniff, no SVG/HTML.
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

function bytesStartWith(bytes, sig) {
  if (!bytes || bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Detect content type from magic bytes. Returns null if unknown.
 * @param {ArrayBuffer|Uint8Array} buffer
 */
export function sniffContentType(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4) return null;

  // PDF: %PDF
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  // JPEG
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // PNG
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  // GIF
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // WEBP: RIFF....WEBP
  if (
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF: ftyp....heic/heif/mif1
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (['heic', 'heif', 'mif1', 'msf1', 'hevc'].includes(brand)) {
      return 'image/heic';
    }
  }
  // OLE Compound (legacy .doc): D0 CF 11 E0
  if (bytesStartWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'application/msword';
  // ZIP / OOXML (.docx): PK
  if (bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return 'application/zip'; // further refined by extension (docx)
  }
  // Reject HTML/SVG disguised by extension
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(256, bytes.length))).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<svg') || head.startsWith('<?xml')) {
    return 'text/html';
  }
  // plain text: only if mostly printable
  let printable = 0;
  const sample = Math.min(bytes.length, 512);
  for (let i = 0; i < sample; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 160) printable++;
  }
  if (sample > 0 && printable / sample > 0.95) return 'text/plain';

  return null;
}

/**
 * Validate File metadata for upload (before reading body).
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

  let mime = allowedMimes[0];
  if (clientMime) {
    if (!allowedMimes.includes(clientMime)) {
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
 * Validate buffer magic bytes against declared extension.
 * @returns {{ ok: true, mime: string } | { ok: false, error: string, status: number }}
 */
export function validateBufferSignature(buffer, extension, declaredMime) {
  const sniffed = sniffContentType(buffer);
  const ext = (extension || '').toLowerCase();

  if (sniffed === 'text/html') {
    return { ok: false, error: 'Active content (HTML/SVG/XML) is not allowed', status: 415 };
  }

  const rules = {
    pdf: (s) => s === 'application/pdf',
    jpg: (s) => s === 'image/jpeg',
    jpeg: (s) => s === 'image/jpeg',
    png: (s) => s === 'image/png',
    gif: (s) => s === 'image/gif',
    webp: (s) => s === 'image/webp',
    heic: (s) => s === 'image/heic',
    heif: (s) => s === 'image/heic',
    // docx is ZIP-based; doc is OLE
    docx: (s) => s === 'application/zip',
    doc: (s) => s === 'application/msword',
    // plain text: sniff may return text/plain or null
    txt: (s) => s === 'text/plain' || s === null,
  };

  const check = rules[ext];
  if (!check) {
    return { ok: false, error: 'Unsupported extension for signature check', status: 415 };
  }

  if (!check(sniffed)) {
    return {
      ok: false,
      error: `File content does not match extension .${ext}` + (sniffed ? ` (detected ${sniffed})` : ''),
      status: 415,
    };
  }

  // Canonical storage MIME from extension whitelist
  const mime = (ALLOWED[ext] && ALLOWED[ext][0]) || declaredMime || 'application/octet-stream';
  return { ok: true, mime };
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
