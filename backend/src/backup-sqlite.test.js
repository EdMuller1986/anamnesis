/**
 * Real SQLite smoke: apply migrations, insert visit_diagnoses (no id), run getFullState.
 */
import { describe, it, expect } from 'vitest';
import { getFullState, stableBackupPayload } from './services/backup.js';
import { openMigratedDb, d1Adapter } from './test-utils/sqlite-d1.js';

describe('backup getFullState on real schema', () => {
  it('exports visit_diagnoses without ORDER BY id and produces stable hash', async () => {
    const sqlite = openMigratedDb();

    sqlite.prepare(
      `INSERT INTO patient (id, name, full_name) VALUES (1, 'Test', 'Test User')`
    ).run();
    sqlite.prepare(
      `INSERT INTO timeline (id, patient_id, event_date, title) VALUES (10, 1, '2024-01-01', 'Visit')`
    ).run();
    sqlite.prepare(
      `INSERT INTO diagnoses (id, patient_id, name, status) VALUES (20, 1, 'Asthma', 'active')`
    ).run();
    sqlite.prepare(
      `INSERT INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id) VALUES (10, 20, 'discussed', 1)`
    ).run();
    sqlite.prepare(
      `INSERT INTO documents (id, patient_id, title, file_path) VALUES (1, 1, 'Lab', 'abc.pdf')`
    ).run();

    const state = await getFullState(d1Adapter(sqlite));
    expect(state.data.visit_diagnoses).toHaveLength(1);
    expect(state.data.visit_diagnoses[0].visit_id).toBe(10);
    expect(state.data.documents).toHaveLength(1);
    expect(state.data.b2_file_manifest.count).toBe(1);
    expect(state.backup_errors).toBeUndefined();

    const a = JSON.stringify(stableBackupPayload(state));
    // second call — same medical data
    const state2 = await getFullState(d1Adapter(sqlite));
    const b = JSON.stringify(stableBackupPayload(state2));
    expect(a).toBe(b);
  });
});
