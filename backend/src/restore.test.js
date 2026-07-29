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
