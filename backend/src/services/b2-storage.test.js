import { describe, it, expect } from 'vitest';
import { uploadFile, getDownloadUrl, deleteFile } from './b2-storage';

describe('B2 Storage Service Integration', () => {
  it('should upload, sign and delete a file', async () => {
    const env = {
      B2_ENDPOINT: process.env.B2_ENDPOINT,
      B2_BUCKET_NAME: process.env.B2_BUCKET_NAME,
      B2_KEY_ID: process.env.B2_KEY_ID,
      B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY,
    };

    if (!env.B2_KEY_ID || env.B2_KEY_ID === 'YOUR_B2_KEY_ID') {
      console.warn('Skipping B2 integration test: No credentials in process.env');
      return;
    }

    const fileName = `test-file-${Date.now()}.txt`;
    const content = new TextEncoder().encode('Hello B2!');
    const contentType = 'text/plain';

    try {
      // 1. Upload
      await uploadFile(env, fileName, content, contentType);
      console.log('Uploaded:', fileName);

      // 2. Get Download URL
      const url = await getDownloadUrl(env, fileName);
      expect(url).toContain(env.B2_ENDPOINT);
      expect(url).toContain(fileName);
      console.log('Download URL:', url);

      // 3. Verify download
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Hello B2!');

      // 4. Delete
      await deleteFile(env, fileName);
      console.log('Deleted:', fileName);
    } catch (err) {
      console.error('B2 Test Error:', err);
      throw err;
    }
  });
});
