import { describe, it, expect } from 'vitest';
import app from './index';

/**
 * Lightweight contract tests for P2 FE/API parity (mocked D1).
 */

function mockEnvWithSession(handlers = {}) {
  const db = {
    prepare: (query) => ({
      bind: (...args) => ({
        first: async () => {
          if (query.includes('FROM sessions')) {
            return { patient_id: 1, expires_at: '2099-01-01', revoked: 0 };
          }
          if (query.includes('FROM patient') && query.includes('WHERE id')) {
            return { id: 1, full_name: 'Test', name: 'Test' };
          }
          if (handlers.first) return handlers.first(query, args);
          return null;
        },
        all: async () => {
          if (handlers.all) return handlers.all(query, args);
          return { results: [] };
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
    batch: async (qs) => qs.map(() => ({ success: true })),
  };
  return {
    DB: db,
    CORS_ORIGINS: '*',
    ADMIN_TOKEN: 'test-admin-token',
  };
}

const authHeaders = {
  'X-Session-Token': 'valid-token',
  'X-Patient-Id': '1',
  'Content-Type': 'application/json',
};

describe('P2 schema / API parity', () => {
  it('GET /api/changelog returns array', async () => {
    const env = mockEnvWithSession({
      all: (q) => {
        if (q.includes('app_versions')) {
          return {
            results: [{
              id: 1,
              version: '1.0.1',
              changes: '["added diagnosis"]',
              reason: 'test',
              created_at: '2026-01-01',
              patient_id: 1,
            }],
          };
        }
        return { results: [] };
      },
    });
    const res = await app.fetch(new Request('http://localhost/api/changelog', {
      headers: authHeaders,
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].version).toBe('1.0.1');
    expect(Array.isArray(data[0].changes)).toBe(true);
  });

  it('PUT /api/errors/:id updates status', async () => {
    const env = mockEnvWithSession({
      first: (q) => {
        if (q.includes('medical_errors')) {
          return {
            id: 5,
            patient_id: 1,
            title: 'Alert',
            detail: 'd',
            status: 'open',
            severity: 'warning',
          };
        }
        return null;
      },
      all: (q) => {
        if (q.includes('UPDATE medical_errors') || q.includes('RETURNING')) {
          return {
            results: [{
              id: 5,
              title: 'Alert',
              status: 'resolved',
              action_text: 'call doctor',
              patient_id: 1,
            }],
          };
        }
        return { results: [] };
      },
    });

    // Override all for UPDATE RETURNING pattern used by route
    env.DB.prepare = (query) => ({
      bind: (...args) => ({
        first: async () => {
          if (query.includes('FROM sessions')) {
            return { patient_id: 1, expires_at: '2099-01-01', revoked: 0 };
          }
          if (query.includes('FROM patient')) return { id: 1 };
          if (query.includes('medical_errors') && query.includes('SELECT')) {
            return {
              id: 5, patient_id: 1, title: 'Alert', detail: 'd',
              status: 'open', severity: 'warning', action_text: null,
            };
          }
          return null;
        },
        all: async () => {
          if (query.includes('UPDATE medical_errors')) {
            return {
              results: [{
                id: 5, title: 'Alert', status: 'resolved',
                action_text: 'call doctor', patient_id: 1,
              }],
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
      }),
    });

    const res = await app.fetch(new Request('http://localhost/api/errors/5', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ status: 'resolved', action_text: 'call doctor' }),
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('resolved');
  });

  it('GET /api/plan maps deadline alias', async () => {
    const env = mockEnvWithSession();
    env.DB.prepare = (query) => ({
      bind: (...args) => ({
        first: async () => {
          if (query.includes('FROM sessions')) {
            return { patient_id: 1, expires_at: '2099-01-01', revoked: 0 };
          }
          if (query.includes('FROM patient')) return { id: 1 };
          return null;
        },
        all: async () => {
          if (query.includes('FROM plan')) {
            return {
              results: [{
                id: 1,
                title: 'Task',
                detail: 'Do it',
                description: null,
                due_date: '2026-08-01',
                sort_order: 2,
                status: 'pending',
                priority: 'high',
                patient_id: 1,
              }],
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
      }),
    });

    const res = await app.fetch(new Request('http://localhost/api/plan', {
      headers: authHeaders,
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].deadline).toBe('2026-08-01');
    expect(data[0].description).toBe('Do it');
  });
});
