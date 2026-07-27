import crypto from 'node:crypto';

/**
 * Проверка логики шифрования, используемой в системе бэкапов.
 * Использует Web Crypto API (доступен в Node 20+).
 */
async function testEncryption(password) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const data = enc.encode('Test connection and encryption key');

  try {
    // 1. Деривация
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const passwordKey = await crypto.subtle.importKey(
      'raw', enc.encode(password),
      { name: 'PBKDF2' },
      false, ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );

    // 2. Шифрование
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // 3. Расшифровка (проверка ключа)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    const result = dec.decode(decrypted);
    if (result !== 'Test connection and encryption key') {
      throw new Error('Decryption result mismatch');
    }

    console.log('✅ Encryption logic and key validation: OK');
  } catch (err) {
    console.error('❌ Encryption test failed:', err.message);
    process.exit(1);
  }
}

const key = process.env.BACKUP_ENCRYPTION_KEY;
if (!key || key.length < 4) {
  console.error('❌ BACKUP_ENCRYPTION_KEY is missing or too short');
  process.exit(1);
}

testEncryption(key);
