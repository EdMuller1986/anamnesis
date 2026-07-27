import { describe, it, expect } from 'vitest';
import app from './index';

const mockDB = {
  prepare: (query) => ({
    bind: () => ({
      first: () => Promise.resolve({ one: 1 }),
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

  it('GET /api/admin/tools returns 200 with valid admin token', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/tools', {
      headers: { 'X-Admin-Token': 'test-admin-token' }
    }), mockEnv);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/documents/:id/file returns 302 redirect', async () => {
    const res = await app.fetch(new Request('http://localhost/api/documents/1/file', {
      headers: { 'X-Session-Token': 'valid-token' }
    }), {
      ...mockEnv,
      DB: {
        prepare: (q) => ({
          bind: (...args) => ({
            first: () => {
              if (q.includes('sessions')) return Promise.resolve({ patient_id: 1 });
              return Promise.resolve({ id: 1, file_path: 'test.pdf', title: 'Test', mime_type: 'application/pdf' });
            },
            run: () => Promise.resolve({ success: true })
          })
        })
      }
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('s3.us-west-004.backblazeb2.com');
  });
});
