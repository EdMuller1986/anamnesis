import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  validateBufferSignature,
  sniffContentType,
  fileResponseHeaders,
  MAX_UPLOAD_BYTES,
} from './services/upload-policy.js';

function fakeFile({ name, type, size }) {
  return { name, type, size };
}

describe('upload-policy', () => {
  it('accepts PDF with matching MIME', () => {
    const r = validateUpload(fakeFile({ name: 'lab.pdf', type: 'application/pdf', size: 1024 }));
    expect(r.ok).toBe(true);
    expect(r.extension).toBe('pdf');
    expect(r.mime).toBe('application/pdf');
  });

  it('rejects SVG', () => {
    const r = validateUpload(fakeFile({ name: 'x.svg', type: 'image/svg+xml', size: 100 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(415);
  });

  it('rejects HTML', () => {
    const r = validateUpload(fakeFile({ name: 'x.html', type: 'text/html', size: 100 }));
    expect(r.ok).toBe(false);
  });

  it('rejects MIME/extension mismatch', () => {
    const r = validateUpload(fakeFile({ name: 'x.pdf', type: 'image/png', size: 100 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(415);
  });

  it('rejects oversized files', () => {
    const r = validateUpload(fakeFile({
      name: 'big.pdf',
      type: 'application/pdf',
      size: MAX_UPLOAD_BYTES + 1,
    }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(413);
  });

  it('sniffs PDF magic bytes', () => {
    const buf = new TextEncoder().encode('%PDF-1.4 fake');
    expect(sniffContentType(buf)).toBe('application/pdf');
    const ok = validateBufferSignature(buf, 'pdf', 'application/pdf');
    expect(ok.ok).toBe(true);
  });

  it('rejects HTML content with .pdf extension', () => {
    const buf = new TextEncoder().encode('<!DOCTYPE html><html><body>x</body></html>');
    const r = validateBufferSignature(buf, 'pdf', 'application/pdf');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(415);
  });

  it('accepts JPEG magic with .jpg', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const r = validateBufferSignature(buf, 'jpg', 'image/jpeg');
    expect(r.ok).toBe(true);
    expect(r.mime).toBe('image/jpeg');
  });

  it('uses private no-store cache headers', () => {
    const h = fileResponseHeaders('application/pdf', 'report.pdf');
    expect(h['Cache-Control']).toBe('private, no-store');
    expect(h['Content-Disposition']).toMatch(/^inline/);
  });

  it('forces attachment for unknown MIME', () => {
    const h = fileResponseHeaders('application/octet-stream', 'blob.bin');
    expect(h['Content-Disposition']).toMatch(/^attachment/);
  });
});
