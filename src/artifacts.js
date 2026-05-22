import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR } from './constants.js';

export const DEFAULT_ARTIFACT_DIR = join(CONFIG_DIR, 'artifacts');
export const ARTIFACT_SCHEMA_VERSION = 1;

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

export function resolveArtifactDir({ out, config = {} } = {}) {
  const selected = out || config.artifactDir || DEFAULT_ARTIFACT_DIR;
  const expanded = expandHome(selected);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}

export function createArtifactId(id) {
  if (id) {
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
      throw new Error('artifact id may only contain letters, numbers, dots, underscores, and hyphens');
    }
    return id;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function makeArtifactContext({ command, query, opts = {}, config = {} }) {
  if (opts.artifact === false) return null;
  const artifactId = createArtifactId(opts.artifactId);
  const artifactRoot = resolveArtifactDir({ out: opts.out, config });
  const artifactDir = join(artifactRoot, artifactId);
  return { command, query, artifactId, artifactRoot, artifactDir };
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeStandardArtifact(ctx, payload) {
  if (!ctx) return null;
  mkdirSync(ctx.artifactDir, { recursive: true });

  const createdAt = payload.createdAt || new Date().toISOString();
  const sources = payload.sources || [];
  const result = {
    query: ctx.query,
    answer: payload.answer || '',
    sources,
    command: ctx.command,
    mode: payload.mode || null,
    model: payload.model || null,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
  };
  const meta = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    command: ctx.command,
    query: ctx.query,
    mode: payload.mode || null,
    model: payload.model || null,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
    status: payload.status || 'complete',
  };

  writeJson(join(ctx.artifactDir, 'meta.json'), meta);
  writeFileSync(join(ctx.artifactDir, 'query.txt'), `${ctx.query}\n`, 'utf8');
  writeFileSync(join(ctx.artifactDir, 'answer.md'), payload.answer || '', 'utf8');
  writeJson(join(ctx.artifactDir, 'result.json'), result);
  writeJson(join(ctx.artifactDir, 'sources.json'), sources);
  return { artifactId: ctx.artifactId, artifactDir: ctx.artifactDir };
}

export function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
