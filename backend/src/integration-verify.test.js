import { describe, it, expect } from 'vitest';
import app from './index';

// Demo data matching migrations/demo_data.sql but in JSON format for the API
const DEMO_DATA = {
  patient: { name: 'Иванов Иван Иванович' },
  specialists: [
    { full_name: 'Петров Пётр Петрович', specialization: 'Педиатр', clinic: 'Демо-клиника', notes: 'Демонстрационный специалист.' }
  ],
  timeline: [
    { event_date: '2024-11-10', title: 'Профилактический осмотр (пример)', description: 'Демонстрационный визит. Ребёнок здоров, рекомендован повторный осмотр через год.', category: 'visit' }
  ],
  diagnoses: [
    { name: 'ОРВИ (пример)', icd_code: 'J06.9', status: 'closed', detail: 'Пример закрытого диагноза.' }
  ],
  medications: [
    { name: 'Парацетамол (пример)', dosage: '250 мг', frequency: 'при температуре > 38', status: 'active', detail: 'Демонстрационный препарат.' }
  ],
  plan: [
    { title: 'Повторный осмотр через год', detail: 'Плановый профилактический осмотр у педиатра.', priority: 'medium', status: 'pending', due_date: '2025-11-10' }
  ],
  reminders: [
    { title: 'Плановый осмотр', remind_at: '2026-11-10 09:00:00', status: 'pending' }
  ],
  vaccinations: [
    { name: 'АКДС (пример)', vaccine_name: 'Инфанрикс', dose_number: 1, scheduled_date: '2024-12-01', status: 'done' },
    { name: 'Гепатит B (пример)', vaccine_name: 'Энджерикс', dose_number: 2, scheduled_date: '2025-01-15', status: 'scheduled' }
  ],
  growth_log: [
    { measured_at: '2024-11-10', height_cm: 110, weight_kg: 20.0 },
    { measured_at: '2024-05-10', height_cm: 105, weight_kg: 18.5 }
  ],
  lab_results: [
    { test_date: '2024-11-10', test_name: 'Общий анализ крови', parameter: 'Гемоглобин', value: 125, unit: 'г/л', ref_min: 110, ref_max: 140, status: 'normal' },
    { test_date: '2024-11-10', test_name: 'Общий анализ крови', parameter: 'Лейкоциты', value: 11.5, unit: '10^9/л', ref_min: 4.5, ref_max: 10.0, status: 'high' }
  ]
};

const mockDB = (initialData = {}) => {
  let dbData = { 
    patient: { id: 1, full_name: 'Иванов Иван Иванович' }, // Use full_name as expected by export
    ...initialData 
  };
  const prepare = (query) => {
    return {
      bind: (...args) => {
        return {
          all: () => {
             for (const table of ['timeline', 'diagnoses', 'medications', 'specialists', 'lab_results', 'vaccinations', 'growth_log', 'plan', 'medical_errors', 'reminders', 'prescriptions', 'patient', 'visit_diagnoses', 'ai_requests']) {
               if (query.includes(`FROM ${table}`)) return Promise.resolve({ results: dbData[table] || [] });
             }
             if (query.includes('FROM sessions')) return Promise.resolve({ results: [{ expires_at: '2099-01-01', patient_id: 1 }] });
             if (query.includes('app_settings')) return Promise.resolve({ results: [{ value: '1.0.0' }] });
             return Promise.resolve({ results: [] });
          },
          first: () => {
             if (query.includes('FROM patient')) return Promise.resolve(dbData.patient);
             if (query.includes('FROM sessions')) return Promise.resolve({ expires_at: '2099-01-01', patient_id: 1 });
             if (query.includes('app_settings')) return Promise.resolve({ value: '1.0.0' });
             return Promise.resolve(null);
          },
          run: () => {
            return Promise.resolve({ success: true, meta: { changes: 1 } });
          }
        };
      }
    };
  };

  return {
    prepare,
    batch: async (queries) => {
       return queries.map(() => ({ success: true }));
    }
  };
};

const mockEnv = {
  CORS_ORIGINS: '*',
  ADMIN_TOKEN: 'test-admin-token',
  B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
  B2_BUCKET_NAME: 'test-bucket'
};

describe('Full Verification Cycle', () => {
  it('Should complete the cycle with mocked success', async () => {
    const db = mockDB({
        lab_results: DEMO_DATA.lab_results,
        vaccinations: DEMO_DATA.vaccinations
    });
    const env = { ...mockEnv, DB: db };

    // 1. Verify Export Report contains the data
    const exportRes = await app.fetch(new Request('http://localhost/api/export/pdf?patient_id=1&token=valid'), env);
    expect(exportRes.status).toBe(200);
    const html = await exportRes.text();
    expect(html).toContain('Иванов Иван Иванович');
    expect(html).toContain('Гемоглобин');
    expect(html).toContain('Инфанрикс');

    // 2. Verify admin tools endpoint exists
    const restoreRes = await app.fetch(new Request('http://localhost/api/admin/tools/restore-from-backup', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'wrong' }
    }), env);
    expect(restoreRes.status).toBe(403);
  });
});
