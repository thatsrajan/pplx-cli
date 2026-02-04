import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_FILE = join(homedir(), '.config', 'pplx', 'config.json');

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
