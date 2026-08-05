#!/usr/bin/env node
/**
 * Upload local files (legacy backend/uploads) to B2.
 *
 * Env: B2_ENDPOINT, B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY
 *
 * Usage:
 *   node scripts/upload-uploads-to-b2.mjs ./backend/uploads
 *   node scripts/upload-uploads-to-b2.mjs ./uploads --dry-run
 *   node scripts/upload-uploads-to-b2.mjs ./uploads --basename-only
 *
 * Default key = relative path under uploads dir.
 * --basename-only uses only the file name (matches Worker UUID.ext storage).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const dir = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const basenameOnly = process.argv.includes('--basename-only');

if (!dir) {
  console.error('Usage: node upload-uploads-to-b2.mjs <uploads-dir> [--dry-run] [--basename-only]');
  process.exit(1);
}

const endpoint = (process.env.B2_ENDPOINT || '').replace(/^https?:\/\//, '');
const bucket = process.env.B2_BUCKET_NAME;
const keyId = process.env.B2_KEY_ID;
const appKey = process.env.B2_APPLICATION_KEY;

if (!endpoint || !bucket || !keyId || !appKey) {
  console.error('Missing B2_ENDPOINT, B2_BUCKET_NAME, B2_KEY_ID, or B2_APPLICATION_KEY');
  process.exit(1);
}

const parts = endpoint.split('.');
const region = parts[0] === 's3' ? parts[1] : parts[0];

const client = new S3Client({
  region,
  endpoint: `https://${endpoint}`,
  credentials: { accessKeyId: keyId, secretAccessKey: appKey },
  forcePathStyle: true,
});

function walk(d, base = d) {
  const out = [];
  for (const name of readdirSync(d)) {
    if (name === '.gitkeep') continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push({ abs: p, rel: relative(base, p).replace(/\\/g, '/') });
  }
  return out;
}

function guessMime(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

const files = walk(dir);
console.log(`Found ${files.length} files under ${dir}`);

let ok = 0;
let fail = 0;

for (const f of files) {
  const key = basenameOnly ? basename(f.rel) : f.rel;
  const mime = guessMime(f.rel);
  const body = readFileSync(f.abs);

  if (dryRun) {
    console.log(`[dry-run] ${f.abs} → ${key} (${body.length} bytes, ${mime})`);
    ok++;
    continue;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mime,
    });
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 600 });
    const res = await fetch(signedUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': mime },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t}`);
    }
    console.log(`OK ${key}`);
    ok++;
  } catch (e) {
    console.error(`FAIL ${key}: ${e.message}`);
    fail++;
  }
}

console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
