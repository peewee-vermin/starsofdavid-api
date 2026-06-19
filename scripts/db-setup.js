// scripts/db-setup.js
// Run once to initialize the database: npm run db:setup

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env in dev
if (process.env.NODE_ENV !== 'production') {
  const { config } = await import('dotenv');
  config();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSQL = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log('Connected to database.');
  await client.query(schemaSQL);
  console.log('Schema applied successfully.');
  console.log('Stars of David database is ready.');
} catch (err) {
  console.error('Setup failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
