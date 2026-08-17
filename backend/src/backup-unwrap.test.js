import { describe, it, expect } from 'vitest';
import {
  unwrapBackupState,
  stableBackupPayload,
  summarizeBackupState,
  bufferToBase64,
  base64ToBuffer,
  DEFAULT_FILE_PACK_LIMITS,
  validateRestoreAgainstLive,
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

  it('stableBackupPayload strips base64 blobs but keeps digests', () => {
    const a = stableBackupPayload({
      exported_at: 't1',
      data: {
        diagnoses: [],
        b2_file_blobs: [
          { key: 'docs/a.pdf', sha256: 'abc', size: 10, base64: 'AAAA' },
        ],
      },
    });
    const b = stableBackupPayload({
      exported_at: 't2',
      data: {
        diagnoses: [],
        b2_file_blobs: [
          { key: 'docs/a.pdf', sha256: 'abc', size: 10, base64: 'DIFFERENT_BYTES' },
        ],
      },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.data.b2_file_blobs).toBeUndefined();
    expect(a.data.b2_file_blob_digests).toEqual([
      { key: 'docs/a.pdf', sha256: 'abc', size: 10 },
    ]);
  });

  it('stableBackupPayload changes when file sha256 changes', () => {
    const a = stableBackupPayload({
      data: {
        diagnoses: [],
        b2_file_blobs: [{ key: 'x', sha256: '111', size: 1, base64: 'A' }],
      },
    });
    const b = stableBackupPayload({
      data: {
        diagnoses: [],
        b2_file_blobs: [{ key: 'x', sha256: '222', size: 1, base64: 'A' }],
      },
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('summarizeBackupState counts tables and embedded files', () => {
    const s = summarizeBackupState({
      version: '2.4.0',
      data: {
        diagnoses: [1, 2],
        timeline: [1],
        b2_file_manifest: { count: 3, files: [] },
        b2_file_blobs: [{ key: 'a' }, { key: 'b' }],
        b2_file_pack_meta: { packed: 2, skipped: 1 },
      },
    });
    expect(s.tables.diagnoses).toBe(2);
    expect(s.tables.timeline).toBe(1);
    expect(s.b2_manifest_count).toBe(3);
    expect(s.b2_embedded_files).toBe(2);
    expect(s.b2_file_pack_meta.packed).toBe(2);
    expect(s.total_rows).toBeGreaterThanOrEqual(3);
  });

  it('bufferToBase64 / base64ToBuffer round-trip', () => {
    const src = new TextEncoder().encode('hello-medical-doc-📎');
    const b64 = bufferToBase64(src);
    const back = new Uint8Array(base64ToBuffer(b64));
    expect(new TextDecoder().decode(back)).toBe('hello-medical-doc-📎');
  });

  it('DEFAULT_FILE_PACK_LIMITS are conservative for Workers', () => {
    expect(DEFAULT_FILE_PACK_LIMITS.maxFiles).toBeLessThanOrEqual(50);
    expect(DEFAULT_FILE_PACK_LIMITS.maxTotalBytes).toBeLessThanOrEqual(30 * 1024 * 1024);
  });

  it('validateRestoreAgainstLive is non-destructive and reports delta', async () => {
    const counts = { diagnoses: 2, timeline: 1 };
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM diagnoses')) return { c: counts.diagnoses };
            if (sql.includes('FROM timeline')) return { c: counts.timeline };
            if (sql.includes('FROM patient')) return { c: 1 };
            return { c: 0 };
          },
        }),
      }),
    };
    const report = await validateRestoreAgainstLive(db, {
      version: '2.4.0',
      scope: 'all_patients',
      data: {
        patient: [{ id: 1, full_name: 'A' }],
        diagnoses: [{ id: 1, name: 'X', patient_id: 1 }, { id: 2, name: 'Y', patient_id: 1 }],
        timeline: [{ id: 1, title: 'Visit', patient_id: 1 }],
      },
    }, 1);

    expect(report.writes).toBe(false);
    expect(report.staging).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.backup_counts.diagnoses).toBe(2);
    expect(report.live_totals.diagnoses).toBe(2);
    expect(report.delta.diagnoses.backup).toBe(2);
  });

  it('validateRestoreAgainstLive blocks empty backup', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({ c: 5 }) }),
      }),
    };
    const report = await validateRestoreAgainstLive(db, {
      data: { diagnoses: [], timeline: [] },
    }, 1);
    expect(report.ready).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});
