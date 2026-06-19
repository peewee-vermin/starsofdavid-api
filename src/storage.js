// src/storage.js
// Stars of David — certificate storage adapter
//
// Uses S3-compatible storage (Cloudflare R2 recommended — no egress
// fees, important for a donation-funded nonprofit). Falls back to
// local disk storage when no storage credentials are configured,
// so the certificate pipeline works out of the box in development.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_STORAGE_DIR = join(__dirname, '../public/certificates');

const useRemoteStorage = Boolean(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME
);

let s3Client = null;
if (useRemoteStorage) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Uploads a certificate PDF and returns its public URL.
 *
 * @param {Uint8Array} pdfBytes
 * @param {string} filename - e.g. "certificate-SOD-271302.pdf"
 * @returns {Promise<string>} public URL
 */
export async function uploadCertificate(pdfBytes, filename) {
  if (useRemoteStorage) {
    return uploadToR2(pdfBytes, filename);
  }
  return saveLocally(pdfBytes, filename);
}

async function uploadToR2(pdfBytes, filename) {
  const key = `certificates/${filename}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: Buffer.from(pdfBytes),
    ContentType: 'application/pdf',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  // R2 public bucket URL or custom domain, e.g. cdn.stars-of-david.org
  const publicBase = process.env.R2_PUBLIC_URL || `https://${process.env.R2_BUCKET_NAME}.r2.dev`;
  return `${publicBase}/${key}`;
}

async function saveLocally(pdfBytes, filename) {
  await mkdir(LOCAL_STORAGE_DIR, { recursive: true });
  const filePath = join(LOCAL_STORAGE_DIR, filename);
  await writeFile(filePath, pdfBytes);

  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  return `${baseUrl}/certificates/${filename}`;
}

export const isUsingRemoteStorage = useRemoteStorage;
