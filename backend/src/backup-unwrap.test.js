import { describe, it, expect } from 'vitest';
import { unwrapBackupState, stableBackupPayload } from './services/backup.js';

describe('backup unwrap / stable payload', () => {
  it('unwraps nested data envelope', () => {
    const raw = {
      version: '2.1.0',
      exported_at: '2026-01-01T00:00:00.000Z',
      data: {
        diagnoses: [{ id: 1, name: 'X' }],
        timeline: [],
      },
      wipe: true,
    };
    const out = unwrapBackupState(raw);
    expect(Array.isArray(out.diagnoses)).toBe(true);
    expect(out.diagnoses[0].name).toBe('X');
    expect(out.wipe).toBe(true);
  });

  it('passes through flat AI import payload', () => {
    const raw = { diagnoses: [{ name: 'Y' }], wipe: false };
    const out = unwrapBackupState(raw);
    expect(out.diagnoses[0].name).toBe('Y');
  });

  it('stableBackupPayload drops exported_at for dedup', () => {
    const a = stableBackupPayload({ exported_at: 't1', data: { diagnoses: [1] } });
    const b = stableBackupPayload({ exported_at: 't2', data: { diagnoses: [1] } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
