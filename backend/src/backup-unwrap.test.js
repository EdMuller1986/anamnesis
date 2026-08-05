import { describe, it, expect } from 'vitest';
import {
  unwrapBackupState,
  stableBackupPayload,
  summarizeBackupState,
} from './services/backup.js';

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

  it('stableBackupPayload drops exported_at and volatile settings for dedup', () => {
    const a = stableBackupPayload({
      exported_at: 't1',
      data: {
        diagnoses: [{ id: 1 }],
        app_settings: [
          { key: 'pin_hash_1', value: 'x' },
          { key: 'last_backup_hash', value: 'h1' },
          { key: 'last_backup_status', value: '{}' },
        ],
      },
    });
    const b = stableBackupPayload({
      exported_at: 't2',
      data: {
        diagnoses: [{ id: 1 }],
        app_settings: [
          { key: 'last_backup_status', value: 'other' },
          { key: 'pin_hash_1', value: 'x' },
          { key: 'last_backup_hash', value: 'h2' },
        ],
      },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.data.app_settings).toEqual([{ key: 'pin_hash_1', value: 'x' }]);
  });

  it('summarizeBackupState counts tables', () => {
    const s = summarizeBackupState({
      version: '2.3.0',
      data: {
        diagnoses: [1, 2],
        timeline: [1],
        b2_file_manifest: { count: 3, files: [] },
      },
    });
    expect(s.tables.diagnoses).toBe(2);
    expect(s.tables.timeline).toBe(1);
    expect(s.b2_manifest_count).toBe(3);
    expect(s.total_rows).toBeGreaterThanOrEqual(3);
  });
});
