/**
 * Real SQLite: seed → getFullState → mutate → wipe restore → verify.
 * Catches backup unwrap + applyImport multi-patient bugs that mocks miss.
 */
import { describe, it, expect } from 'vitest';
import { getFullState, unwrapBackupState, summarizeBackupState } from './services/backup.js';
import { applyImport } from './routes/admin.js';
import { openMigratedDb, d1Adapter } from './test-utils/sqlite-d1.js';

function seedFamily(sqlite) {
  sqlite.prepare(
    `INSERT INTO patient (id, name, full_name, birth_date, date_of_birth) VALUES (1, 'A', 'Child A', '2020-01-01', '2020-01-01')`
  ).run();
  sqlite.prepare(
    `INSERT INTO patient (id, name, full_name, birth_date, date_of_birth) VALUES (2, 'B', 'Child B', '2022-06-15', '2022-06-15')`
  ).run();

  sqlite.prepare(
    `INSERT INTO diagnoses (id, patient_id, name, status, icd_code) VALUES (10, 1, 'Asthma', 'active', 'J45')`
  ).run();
  sqlite.prepare(
    `INSERT INTO diagnoses (id, patient_id, name, status, icd_code) VALUES (20, 2, 'Allergy', 'active', 'T78')`
  ).run();

  sqlite.prepare(
    `INSERT INTO timeline (id, patient_id, event_date, title, category) VALUES (100, 1, '2024-03-01', 'Pediatric visit', 'visit')`
  ).run();
  sqlite.prepare(
    `INSERT INTO timeline (id, patient_id, event_date, title, category) VALUES (200, 2, '2024-04-01', 'Allergy consult', 'visit')`
  ).run();

  sqlite.prepare(
    `INSERT INTO documents (id, patient_id, title, file_path, mime_type, original_name, file_size)
     VALUES (1, 1, 'Spirometry', 'docs/spiro.pdf', 'application/pdf', 'spiro.pdf', 1234)`
  ).run();
  sqlite.prepare(
    `INSERT INTO medications (id, patient_id, name, status, dosage) VALUES (1, 1, 'Ventolin', 'active', '2 puffs')`
  ).run();
  sqlite.prepare(
    `INSERT INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id) VALUES (100, 10, 'primary', 1)`
  ).run();
  sqlite.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('pin_hash_1', 'salt$100000$abc')`
  ).run();
  sqlite.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('last_backup_hash', 'should-not-matter')`
  ).run();
}

describe('backup → wipe → restore round-trip (real SQLite)', () => {
  it('restores single patient after destructive mutation', async () => {
    const sqlite = openMigratedDb();
    seedFamily(sqlite);
    const db = d1Adapter(sqlite);

    const state = await getFullState(db);
    expect(state.data.diagnoses).toHaveLength(2);
    expect(state.data.documents[0].original_name).toBe('spiro.pdf');

    // Mutate patient 1
    sqlite.prepare(`UPDATE diagnoses SET name = 'MUTATED' WHERE id = 10`).run();
    sqlite.prepare(
      `INSERT INTO diagnoses (id, patient_id, name, status) VALUES (99, 1, 'Should vanish', 'active')`
    ).run();
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM diagnoses WHERE patient_id = 1`).get().c).toBe(2);

    // Restore only patient 1 from full backup (family partition)
    const result = await applyImport(db, { ...state, wipe: true }, 1);
    expect(result.ok).toBe(true);

    const p1 = sqlite.prepare(`SELECT * FROM diagnoses WHERE patient_id = 1 ORDER BY id`).all();
    expect(p1).toHaveLength(1);
    expect(p1[0].name).toBe('Asthma');
    expect(p1[0].icd_code).toBe('J45');

    // Patient 2 untouched by single-patient path when scope forces multi —
    // full backup has scope all_patients, so BOTH patients restore.
    // applyImport sees scope all_patients → multi path.
    // So patient 2 should also be restored cleanly.
    const p2 = sqlite.prepare(`SELECT * FROM diagnoses WHERE patient_id = 2`).all();
    expect(p2).toHaveLength(1);
    expect(p2[0].name).toBe('Allergy');

    const docs = sqlite.prepare(`SELECT * FROM documents WHERE patient_id = 1`).all();
    expect(docs).toHaveLength(1);
    expect(docs[0].file_path).toBe('docs/spiro.pdf');
    expect(docs[0].original_name).toBe('spiro.pdf');

    const vd = sqlite.prepare(`SELECT * FROM visit_diagnoses WHERE patient_id = 1`).all();
    expect(vd).toHaveLength(1);

    // pin preserved; volatile last_backup_hash may be skipped
    const pin = sqlite.prepare(`SELECT value FROM app_settings WHERE key = 'pin_hash_1'`).get();
    expect(pin?.value).toBe('salt$100000$abc');
  });

  it('multi-patient wipe does not collapse charts onto session pid', async () => {
    const sqlite = openMigratedDb();
    seedFamily(sqlite);
    const db = d1Adapter(sqlite);

    const state = await getFullState(db);
    // Destroy all medical data
    for (const t of ['visit_diagnoses', 'documents', 'medications', 'timeline', 'diagnoses']) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM diagnoses`).get().c).toBe(0);

    // Restore via session patient_id=1 but backup is all_patients
    const result = await applyImport(db, { ...state, wipe: true, scope: 'all_patients' }, 1);
    expect(result.ok).toBe(true);
    expect(result.multi_patient).toBe(true);
    expect(result.patients).toEqual(expect.arrayContaining([1, 2]));

    const names = sqlite.prepare(`SELECT id, name, patient_id FROM diagnoses ORDER BY id`).all();
    expect(names).toHaveLength(2);
    expect(names.find((d) => d.patient_id === 1)?.name).toBe('Asthma');
    expect(names.find((d) => d.patient_id === 2)?.name).toBe('Allergy');

    const timelines = sqlite.prepare(`SELECT patient_id, title FROM timeline ORDER BY id`).all();
    expect(timelines.find((t) => t.patient_id === 2)?.title).toBe('Allergy consult');
  });

  it('summarize + unwrap keep multi-patient counts', async () => {
    const sqlite = openMigratedDb();
    seedFamily(sqlite);
    const state = await getFullState(d1Adapter(sqlite));
    const unwrapped = unwrapBackupState(state);
    expect(unwrapped.diagnoses).toHaveLength(2);
    expect(unwrapped.scope || state.scope).toBe('all_patients');
    const summary = summarizeBackupState(state);
    expect(summary.tables.diagnoses).toBe(2);
    expect(summary.tables.timeline).toBe(2);
    expect(summary.b2_manifest_count).toBe(1);
  });

  it('refuses wipe when backup medical arrays empty', async () => {
    const sqlite = openMigratedDb();
    seedFamily(sqlite);
    const db = d1Adapter(sqlite);
    await expect(
      applyImport(db, { wipe: true, data: { diagnoses: [], timeline: [] } }, 1)
    ).rejects.toThrow(/Refusing wipe/);
  });
});
