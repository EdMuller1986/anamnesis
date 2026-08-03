import { describe, it, expect } from 'vitest';
import {
  timingSafeEqualHex,
  isValidPin,
  hashPin,
  verifyPin,
} from './services/auth-session.js';
import { buildB2FileManifest } from './services/backup.js';

describe('auth hardening', () => {
  it('timingSafeEqualHex is true for equal strings', () => {
    expect(timingSafeEqualHex('abc', 'abc')).toBe(true);
    expect(timingSafeEqualHex('abc', 'abd')).toBe(false);
    expect(timingSafeEqualHex('ab', 'abc')).toBe(false);
  });

  it('PIN policy accepts exactly 6 digits only', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('1234')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12ab56')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });

  it('verifyPin works with timing-safe compare', async () => {
    const hash = await hashPin('123456');
    expect(await verifyPin('123456', hash)).toBe(true);
    expect(await verifyPin('000000', hash)).toBe(false);
  });
});

describe('backup B2 manifest', () => {
  it('collects document and vaccination photo keys', () => {
    const m = buildB2FileManifest({
      documents: [
        { id: 1, file_path: 'uuid.pdf' },
        { id: 2, file_path: 'uuid.pdf' }, // dedupe
      ],
      vaccinations: [
        { id: 9, photos: JSON.stringify(['vaccinations/a.jpg', 'vaccinations/b.png']) },
      ],
    });
    expect(m.count).toBe(3);
    expect(m.files.map((f) => f.key).sort()).toEqual([
      'uuid.pdf',
      'vaccinations/a.jpg',
      'vaccinations/b.png',
    ].sort());
  });
});
