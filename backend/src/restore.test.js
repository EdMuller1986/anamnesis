import { describe, it, expect, beforeEach } from 'vitest';
import app from './index';

const mockDB = {
  prepare: (query) => ({
    bind: (...args) => ({
      all: () => Promise.resolve({ results: [] }),
      first: () => {
         if (query.includes('app_settings')) return Promise.resolve({ value: '1.0.0' });
         return Promise.resolve(null);
      },
      run: () => Promise.resolve({ success: true, meta: { changes: 1 } })
    })
  }),
  batch: (queries) => Promise.resolve(queries.map(() => ({ success: true })))
};

const mockEnv = {
  DB: mockDB,
  CORS_ORIGINS: '*',
  ADMIN_TOKEN: 'test-admin-token',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_CHAT_ID: '123'
};

describe('Admin Import/Restore Logic', () => {
  it('POST /api/admin/import with wipe:true should send DELETE commands for all tables', async () => {
    const spy = {
      deleteQueries: []
    };
    
    const dbWithSpy = {
      ...mockDB,
      prepare: (q) => {
        if (q.startsWith('DELETE FROM')) {
          spy.deleteQueries.push(q);
        }
        return mockDB.prepare(q);
      }
    };

    const payload = {
      wipe: true,
      diagnoses: [{ name: 'Test', status: 'active' }]
    };

    const res = await app.fetch(new Request('http://localhost/api/admin/import', {
      method: 'POST',
      headers: { 
        'X-Admin-Token': 'test-admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }), { ...mockEnv, DB: dbWithSpy });

    expect(res.status).toBe(200);
    // Check that major tables were wiped
    expect(spy.deleteQueries).toContain('DELETE FROM diagnoses WHERE patient_id = ?');
    expect(spy.deleteQueries).toContain('DELETE FROM timeline WHERE patient_id = ?');
    expect(spy.deleteQueries).toContain('DELETE FROM documents WHERE patient_id = ?');
  });

  it('POST /api/admin/import unwraps backup wrapper and accepts rows with id on wipe', async () => {
    const inserts = [];
    const dbWithSpy = {
      prepare: (q) => ({
        bind: (...args) => {
          if (q.startsWith('INSERT INTO diagnoses')) inserts.push({ q, args });
          return {
            all: () => Promise.resolve({ results: [] }),
            first: () => {
              if (q.includes('app_settings')) return Promise.resolve({ value: '1.0.0' });
              return Promise.resolve(null);
            },
            run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
      batch: (queries) => Promise.resolve(queries.map(() => ({ success: true }))),
    };

    const backupShape = {
      version: '2.1.0',
      exported_at: '2026-07-30T00:00:00.000Z',
      patient_id: 1,
      wipe: true,
      data: {
        diagnoses: [{ id: 42, name: 'Asthma', status: 'active' }],
      },
    };

    const res = await app.fetch(new Request('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'X-Admin-Token': 'test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backupShape),
    }), { ...mockEnv, DB: dbWithSpy });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(inserts.some((i) => i.q.includes('id,') && i.args.includes(42))).toBe(true);
  });

  it('POST /api/admin/import multi-patient wipe preserves patient_ids', async () => {
    const deletes = [];
    const diagInserts = [];
    const dbWithSpy = {
      prepare: (q) => ({
        bind: (...args) => {
          if (q.startsWith('DELETE FROM diagnoses')) deletes.push({ q, args });
          if (q.startsWith('INSERT INTO diagnoses')) diagInserts.push({ q, args });
          return {
            all: () => Promise.resolve({ results: [] }),
            first: () => {
              if (q.includes('app_settings')) return Promise.resolve({ value: '1.0.0' });
              return Promise.resolve(null);
            },
            run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
      batch: (queries) => Promise.resolve(queries.map(() => ({ success: true }))),
    };

    const payload = {
      wipe: true,
      scope: 'all_patients',
      patient: [
        { id: 1, full_name: 'Child A' },
        { id: 2, full_name: 'Child B' },
      ],
      diagnoses: [
        { id: 10, name: 'Dx A', status: 'active', patient_id: 1 },
        { id: 20, name: 'Dx B', status: 'active', patient_id: 2 },
      ],
    };

    const res = await app.fetch(new Request('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'X-Admin-Token': 'test-admin-token',
        'Content-Type': 'application/json',
        'X-Patient-Id': '1',
      },
      body: JSON.stringify(payload),
    }), { ...mockEnv, DB: dbWithSpy });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Both patients wiped
    expect(deletes.some((d) => d.args.includes(1))).toBe(true);
    expect(deletes.some((d) => d.args.includes(2))).toBe(true);
    // Inserts keep original patient ids (last bind arg is patient_id)
    const pids = diagInserts.map((i) => i.args[i.args.length - 1]);
    expect(pids).toContain(1);
    expect(pids).toContain(2);
  });

  it('POST /api/admin/import refuses wipe with empty nested data', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'X-Admin-Token': 'test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wipe: true,
        version: '2.0.0',
        data: { diagnoses: [] },
      }),
    }), mockEnv);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Refusing wipe/i);
  });

  it('POST /api/admin/import should support full state restoration (all tables)', async () => {
    const fullState = {
      diagnoses: [{ name: 'D1' }],
      medications: [{ name: 'M1' }],
      specialists: [{ full_name: 'S1' }],
      lab_results: [{ test_name: 'T1', parameter: 'P1', value: 10, unit: 'U' }],
      vaccinations: [{ name: 'V1' }],
      growth_log: [{ measured_at: '2024-01-01', height_cm: 100, weight_kg: 15 }],
      plan: [{ title: 'P1' }],
      medical_errors: [{ title: 'E1' }],
      reminders: [{ title: 'R1', remind_at: '2025-01-01' }],
      prescriptions: [{ medication_id: 1, dosage: '10mg' }],
      visit_diagnoses: [{ visit_id: 1, diagnosis_id: 1 }]
    };

    const res = await app.fetch(new Request('http://localhost/api/admin/import', {
      method: 'POST',
      headers: { 
        'X-Admin-Token': 'test-admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fullState)
    }), mockEnv);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // 11 tables + 1 version update
    expect(data.changes.length).toBeGreaterThanOrEqual(11);
  });
});
