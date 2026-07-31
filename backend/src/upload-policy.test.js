import { describe, it, expect } from 'vitest';
import { validateUpload, fileResponseHeaders, MAX_UPLOAD_BYTES } from './services/upload-policy.js';

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
