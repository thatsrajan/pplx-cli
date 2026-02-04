import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { CONFIG_DIR, COOKIES_FILE } from './constants.js';

export function loadCookies() {
  if (!existsSync(COOKIES_FILE)) return null;
  try {
    return JSON.parse(readFileSync(COOKIES_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveCookies(cookies) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
}

function getChromeDir(profile) {
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), 'Library/Application Support/Google/Chrome', profile);
  } else if (platform === 'linux') {
    return join(homedir(), '.config/google-chrome', profile);
  }
  throw new Error(`Unsupported platform: ${platform}. Only macOS and Linux are supported.`);
}

function getChromeKey() {
  if (process.platform === 'linux') {
    return crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  }
  // macOS: Keychain
  const accounts = ['Chrome', 'Google Chrome'];
  let lastErr = null;
  for (const account of accounts) {
    try {
      const raw = execSync(
        `security find-generic-password -w -s "Chrome Safe Storage" -a "${account}"`,
        { encoding: 'utf-8' }
      ).trim();
      if (raw) {
        return crypto.pbkdf2Sync(raw, 'saltysalt', 1003, 16, 'sha1');
      }
    } catch (err) {
      lastErr = err;
    }
  }
  const error = new Error(
    'Keychain access denied for "Chrome Safe Storage". Run: ' +
    'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome" ' +
    '(or -a "Google Chrome") and allow access.'
  );
  if (lastErr) error.cause = lastErr;
  throw error;
}

function decryptValue(encrypted, key) {
  if (!Buffer.isBuffer(encrypted)) encrypted = Buffer.from(encrypted);
  if (!encrypted || encrypted.length < 4) return '';
  // Chrome macOS: v10 prefix + AES-128-CBC with IV of 16 spaces
  if (encrypted[0] === 0x76 && encrypted[1] === 0x31 && encrypted[2] === 0x30) {
    const iv = Buffer.alloc(16, 0x20);
    const data = encrypted.slice(3);
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      // The first ~32 bytes may be garbled (CBC IV issue on newer Chrome).
      // Cookie values are printable ASCII — find the longest trailing printable run.
      const str = decrypted.toString('latin1');
      // Find first printable run that extends to the end
      const match = str.match(/[\x20-\x7E]+$/);
      return match ? match[0] : '';
    } catch (e) {
      return '';
    }
  }
  // Unencrypted value
  try {
    const str = encrypted.toString('utf-8');
    const match = str.match(/[\x20-\x7E]+$/);
    return match ? match[0] : '';
  } catch {
    return '';
  }
}

export function extractFromChrome(profile = 'Default') {
  const chromeDir = getChromeDir(profile);
  const cookieDb = join(chromeDir, 'Cookies');

  if (!existsSync(cookieDb)) {
    throw new Error(`Chrome cookie DB not found at ${cookieDb}`);
  }

  // Copy DB + WAL + SHM files to avoid lock issues (REVIEW issue #5)
  const tmpBase = `/tmp/pplx-cookies-${Date.now()}`;
  const tmpDb = `${tmpBase}.db`;
  const tmpWal = `${tmpBase}.db-wal`;
  const tmpShm = `${tmpBase}.db-shm`;

  copyFileSync(cookieDb, tmpDb);
  const walPath = `${cookieDb}-wal`;
  const shmPath = `${cookieDb}-shm`;
  if (existsSync(walPath)) copyFileSync(walPath, tmpWal);
  if (existsSync(shmPath)) copyFileSync(shmPath, tmpShm);

  const key = getChromeKey();
  const db = new Database(tmpDb, { readonly: true });

  const rows = db.prepare(
    "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%perplexity.ai'"
  ).all();

  const cookies = {};
  for (const row of rows) {
    const val = decryptValue(row.encrypted_value, key);
    if (val) cookies[row.name] = val;
  }

  db.close();
  // Cleanup
  try { unlinkSync(tmpDb); } catch {}
  try { unlinkSync(tmpWal); } catch {}
  try { unlinkSync(tmpShm); } catch {}

  return cookies;
}

export function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}
