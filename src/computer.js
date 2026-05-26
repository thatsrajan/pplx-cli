import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ARTIFACT_SCHEMA_VERSION,
  makeArtifactContext,
  readJsonFile,
  writeJson,
} from './artifacts.js';

export const COMPUTER_URL = 'https://www.perplexity.ai/computer';
export const COMPUTER_RESULT_FILE = 'computer-result.json';
export const COMPUTER_TEMPLATES = ['compare', 'competitive-analysis'];
export const PENDING_COMPUTER_RESULT = {
  summary: '',
  winner: '',
  confidence: 'low',
  items: [],
  sources: [],
  checked_at: '',
  notes: [],
  council_review_prompt: '',
  _status: 'pending',
};

const RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'pplx computer comparison result',
  type: 'object',
  required: ['summary', 'winner', 'confidence', 'items', 'sources', 'checked_at', 'notes'],
  properties: {
    summary: { type: 'string' },
    winner: { type: 'string' },
    confidence: { enum: ['low', 'medium', 'high'] },
    items: { type: 'array' },
    sources: { type: 'array' },
    checked_at: { type: 'string' },
    notes: { type: 'array' },
    council_review_prompt: { type: 'string' },
  },
};

function buildCompareTask({ task, resultPath }) {
  return `# Perplexity Computer Task

You are running a live comparison task for a local agent workflow.

## User request

${task}

## Instructions

- Use live web pages and direct source pages where possible, not only search snippets.
- Compare any relevant prices, fees, availability, location, timing, quality signals, eligibility rules, and constraints.
- This template is intentionally broad: it can cover products, real estate, restaurants, food prices, travel, rewards portals, services, and other comparison tasks.
- Preserve source URLs for every material claim.
- Include the time the information was checked.
- Mark uncertainty explicitly. Do not invent missing values.
- Prefer structured evidence over prose.

## Output target

Write the final result as JSON matching \`result.schema.json\`.

If you can access the local filesystem, save it here:

\`${resultPath}\`

If you cannot access the filesystem, return the JSON in the chat so the local agent or user can place it in that file.
`;
}

function buildCompetitiveAnalysisTask({ task, resultPath }) {
  return `# Perplexity Computer Task

You are running a live competitive-analysis task for a local agent workflow.

## User request

${task}

## Instructions

- Treat this as "one competitor or competitor set" plus "one topic, market, product surface, capability, pricing motion, GTM motion, or customer segment."
- Use live web pages and direct source pages where possible, not only search snippets.
- Check competitor-owned pages first: home page, product docs, pricing, changelog, blog, help center, release notes, status pages, public roadmaps, job postings, and app marketplace listings.
- Add independent evidence where useful: customer reviews, forum threads, analyst commentary, news, benchmark posts, partner pages, search ads, and social posts.
- Preserve source URLs for every material claim.
- Separate facts from interpretation.
- Identify:
  - current positioning
  - recent changes or launches
  - pricing and packaging implications
  - GTM and distribution signals
  - customer pain or praise signals
  - likely strategic intent
  - threat level to the user request's context
  - evidence gaps that need follow-up
- Include the time the information was checked.
- Mark uncertainty explicitly. Do not invent missing values.
- Prefer structured evidence over prose.
- Include \`council_review_prompt\`: a concise prompt that can be pasted into Perplexity Model Council to critique the evidence and strategy read.

## Output target

Write the final result as JSON matching \`result.schema.json\`.

If you can access the local filesystem, save it here:

\`${resultPath}\`

If you cannot access the filesystem, return the JSON in the chat so the local agent or user can place it in that file.
`;
}

export function buildComputerTask({ task, template = 'compare', resultPath }) {
  if (!COMPUTER_TEMPLATES.includes(template)) {
    throw new Error(`unsupported computer template: ${template}`);
  }

  if (template === 'competitive-analysis') {
    return buildCompetitiveAnalysisTask({ task, resultPath });
  }
  return buildCompareTask({ task, resultPath });
}

export function createComputerRun({ task, template = 'compare', opts = {}, config = {} }) {
  const ctx = makeArtifactContext({ command: 'computer', query: task, opts, config });
  if (!ctx) {
    throw new Error('computer runs require artifacts; omit --no-artifact for this command');
  }

  mkdirSync(ctx.artifactDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const resultPath = join(ctx.artifactDir, COMPUTER_RESULT_FILE);
  const taskText = buildComputerTask({ task, template, resultPath });
  const meta = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    command: 'computer',
    query: task,
    template,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
    status: 'pending',
  };
  const result = {
    query: task,
    answer: '',
    sources: [],
    command: 'computer',
    mode: 'computer',
    model: null,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
    status: 'pending',
    computerResultFile: COMPUTER_RESULT_FILE,
  };

  writeJson(join(ctx.artifactDir, 'meta.json'), meta);
  writeFileSync(join(ctx.artifactDir, 'query.txt'), `${task}\n`, 'utf8');
  writeFileSync(join(ctx.artifactDir, 'answer.md'), taskText, 'utf8');
  writeJson(join(ctx.artifactDir, 'result.json'), result);
  writeJson(join(ctx.artifactDir, 'sources.json'), []);
  writeFileSync(join(ctx.artifactDir, 'task.md'), taskText, 'utf8');
  writeJson(join(ctx.artifactDir, 'result.schema.json'), RESULT_SCHEMA);
  writeJson(resultPath, PENDING_COMPUTER_RESULT);

  return {
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    taskPath: join(ctx.artifactDir, 'task.md'),
    resultPath,
  };
}

function assertComputerResult(value) {
  const missing = ['summary', 'winner', 'confidence', 'items', 'sources', 'checked_at', 'notes']
    .filter((key) => !(key in value));
  if (missing.length) return { ok: false, reason: `missing fields: ${missing.join(', ')}` };
  if (!['low', 'medium', 'high'].includes(value.confidence)) {
    return { ok: false, reason: 'confidence must be low, medium, or high' };
  }
  if (!Array.isArray(value.items)) return { ok: false, reason: 'items must be an array' };
  if (!Array.isArray(value.sources)) return { ok: false, reason: 'sources must be an array' };
  if (!Array.isArray(value.notes)) return { ok: false, reason: 'notes must be an array' };
  return { ok: true, reason: null };
}

export function inspectComputerRun(runDir) {
  const artifactDir = resolve(runDir);
  const resultPath = join(artifactDir, COMPUTER_RESULT_FILE);
  const metaPath = join(artifactDir, 'meta.json');
  if (!existsSync(metaPath)) {
    return { status: 'missing', artifactDir, resultPath, reason: 'meta.json not found' };
  }
  if (!existsSync(resultPath)) {
    return { status: 'pending', artifactDir, resultPath, reason: `${COMPUTER_RESULT_FILE} not found` };
  }
  try {
    const result = readJsonFile(resultPath);
    if (result._status === 'pending') {
      return { status: 'pending', artifactDir, resultPath, reason: `${COMPUTER_RESULT_FILE} is still pending` };
    }
    const validation = assertComputerResult(result);
    return {
      status: validation.ok ? 'complete' : 'invalid',
      artifactDir,
      resultPath,
      reason: validation.reason,
      result,
    };
  } catch (e) {
    return { status: 'invalid', artifactDir, resultPath, reason: e.message };
  }
}

export function importComputerResult(runDir) {
  const status = inspectComputerRun(runDir);
  if (status.status !== 'complete') {
    throw new Error(`computer result is ${status.status}: ${status.reason}`);
  }
  return status.result;
}

export function copyTextToClipboard(text) {
  if (process.platform === 'darwin') {
    execFileSync('pbcopy', { input: text });
    return true;
  }
  return false;
}

export function openComputerUrl() {
  if (process.platform === 'darwin') {
    execFileSync('open', [COMPUTER_URL]);
    return true;
  }
  return false;
}

export function readTaskFile(runDir) {
  return readFileSync(join(resolve(runDir), 'task.md'), 'utf8');
}
