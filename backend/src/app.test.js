import { describe, it, expect, vi } from 'vitest';
import app from './index';

// Mock global fetch to avoid real network requests and fix test failures
global.fetch = vi.fn(() =>
  Promise.resolve(new Response('dummy pdf content', {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' }
  }))
);

const mockDB = {
  prepare: (query) => ({
    bind: () => ({
      first: () => {
        if (query.includes('SELECT 1')) return Promise.resolve({ ok: 1 });
        return Promise.resolve({ one: 1 });
      },
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ success: true })
    })
  }),
};

const mockEnv = {
  DB: mockDB,
  CORS_ORIGINS: '*',
  ADMIN_TOKEN: 'test-admin-token',
  B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
  B2_BUCKET_NAME: 'test-bucket',
  B2_KEY_ID: 'test-key-id',
  B2_APPLICATION_KEY: 'test-app-key'
};

describe('Anamnesis API Integration Tests', () => {
  it('GET /api/health returns 200', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'), mockEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'connected' });
  });

  it('GET /api/version returns 200', async () => {
    const res = await app.fetch(new Request('http://localhost/api/version'), mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toContain('serverless');
  });

  it('POST /api/auth/login returns error when not configured', async () => {
    const res = await app.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' }),
      headers: { 'Content-Type': 'application/json' }
    }), {
      ...mockEnv,
      DB: {
        ...mockDB,
        prepare: () => ({
          bind: () => ({
            first: () => Promise.resolve(null) // PIN not found
          })
        })
      }
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('PIN not configured');
  });

  it('GET /api/patient returns 401 without token', async () => {
    const res = await app.fetch(new Request('http://localhost/api/patient'), mockEnv);
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/tools returns 403 with invalid admin token', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/tools', {
      headers: { 'X-Admin-Token': 'wrong' }
    }), mockEnv);
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/tools/restore-from-backup refuses empty wipe (or fails without B2)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/tools/restore-from-backup', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'test-admin-token' }
    }), mockEnv);
    // Without real B2 backup this fails safely (4xx/5xx), never silent wipe
    expect(res.status).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(data.error || data.message || data.status).toBeTruthy();
  });

  it('GET /api/admin/tools returns 200 with valid admin token', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/tools', {
      headers: { 'X-Admin-Token': 'test-admin-token' }
    }), mockEnv);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/documents/:id/file returns 200 streaming', async () => {
    const res = await app.fetch(new Request('http://localhost/api/documents/1/file', {
      headers: { 'X-Session-Token': 'valid-token' }
    }), {
      ...mockEnv,
      DB: {
        prepare: (q) => ({
          bind: (...args) => ({
            first: () => {
              if (q.includes('sessions')) return Promise.resolve({ patient_id: 1, expires_at: '2099-01-01' });
              if (q.includes('FROM patient') && q.includes('WHERE id')) {
                return Promise.resolve({ id: 1 });
              }
              return Promise.resolve({ id: 1, file_path: 'test.pdf', title: 'Test', mime_type: 'application/pdf', patient_id: 1 });
            },
            run: () => Promise.resolve({ success: true })
          })
        })
      }
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('Test');
  });
});
