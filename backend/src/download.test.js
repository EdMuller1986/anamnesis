import { describe, it, expect, vi, beforeAll } from 'vitest';
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
    bind: (...args) => ({
      first: () => {
        if (query.includes('sessions')) {
           const token = args[0];
           if (token === 'valid-token') return Promise.resolve({ patient_id: 1, expires_at: '2099-01-01' });
           return Promise.resolve(null);
        }
        if (query.includes('documents')) {
          return Promise.resolve({ id: 1, file_path: 'test.pdf', title: 'Test', mime_type: 'application/pdf', patient_id: 1 });
        }
        return Promise.resolve(null);
      },
      run: () => Promise.resolve({ success: true }),
      all: () => Promise.resolve({ results: [] })
    })
  }),
};

const mockEnv = {
  DB: mockDB,
  CORS_ORIGINS: '*',
  B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
  B2_BUCKET_NAME: 'test-bucket',
  B2_KEY_ID: 'test-key-id',
  B2_APPLICATION_KEY: 'test-app-key'
};

describe('Document Download Authorization', () => {
  it('GET /api/documents/1/file returns 401 without token', async () => {
    const res = await app.fetch(new Request('http://localhost/api/documents/1/file'), mockEnv);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('Unauthorized');
  });

  it('GET /api/documents/1/file returns 200 with token in header', async () => {
    const res = await app.fetch(new Request('http://localhost/api/documents/1/file', {
      headers: { 'X-Session-Token': 'valid-token' }
    }), mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('GET /api/documents/1/file returns 200 with token in query param', async () => {
    const res = await app.fetch(new Request('http://localhost/api/documents/1/file?token=valid-token'), mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});
