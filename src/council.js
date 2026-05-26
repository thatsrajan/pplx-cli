import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ARTIFACT_SCHEMA_VERSION,
  makeArtifactContext,
  readJsonFile,
  writeJson,
} from './artifacts.js';
import { copyTextToClipboard } from './computer.js';

export const COUNCIL_URL = 'https://www.perplexity.ai/';
export const COUNCIL_RESULT_FILE = 'council-result.json';
export const COUNCIL_TEMPLATES = ['competitive-analysis', 'strategy-review'];
export const PENDING_COUNCIL_RESULT = {
  summary: '',
  consensus: [],
  disagreements: [],
  risks: [],
  recommendations: [],
  followups: [],
  sources: [],
  confidence: 'low',
  checked_at: '',
  notes: [],
  _status: 'pending',
};

const RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'pplx council review result',
  type: 'object',
  required: [
    'summary',
    'consensus',
    'disagreements',
    'risks',
    'recommendations',
    'followups',
    'sources',
    'confidence',
    'checked_at',
    'notes',
  ],
  properties: {
    summary: { type: 'string' },
    consensus: { type: 'array' },
    disagreements: { type: 'array' },
    risks: { type: 'array' },
    recommendations: { type: 'array' },
    followups: { type: 'array' },
    sources: { type: 'array' },
    confidence: { enum: ['low', 'medium', 'high'] },
    checked_at: { type: 'string' },
    notes: { type: 'array' },
  },
};

function buildCompetitiveAnalysisCouncilTask({ task, evidencePath, resultPath }) {
  const evidenceBlock = evidencePath
    ? `\n## Evidence brief\n\nUse this local evidence artifact if available:\n\n\`${evidencePath}\`\n`
    : '';

  return `# Perplexity Model Council Task

Use Perplexity Model Council for a multi-model review. This is a judgment and synthesis pass, not the primary web-browsing pass.

## User request

${task}
${evidenceBlock}
## Instructions

- Ask the Council to evaluate the same evidence from multiple model perspectives before synthesizing.
- Focus on the competitor, topic, market, product capability, pricing motion, GTM motion, or customer segment named in the request.
- Separate source-backed facts from strategic interpretation.
- Identify where the models agree and where they disagree.
- Challenge the strongest assumption in the analysis.
- Surface missing evidence that would change the conclusion.
- Produce concrete recommendations and monitoring follow-ups.
- Preserve source URLs from the evidence brief and add any new source URLs used by Council.
- Mark uncertainty explicitly. Do not invent missing values.

## Output target

Return the final result as JSON matching \`result.schema.json\`.

If you can access the local filesystem, save it here:

\`${resultPath}\`

If you cannot access the filesystem, return the JSON in the chat so the local agent or user can place it in that file.
`;
}

function buildStrategyReviewCouncilTask({ task, evidencePath, resultPath }) {
  const evidenceBlock = evidencePath
    ? `\n## Evidence brief\n\nUse this local evidence artifact if available:\n\n\`${evidencePath}\`\n`
    : '';

  return `# Perplexity Model Council Task

Use Perplexity Model Council for a multi-model strategy review.

## User request

${task}
${evidenceBlock}
## Instructions

- Ask the Council to evaluate the request from multiple reasoning perspectives before synthesizing.
- Identify consensus, disagreements, risks, blind spots, and decision criteria.
- Separate source-backed facts from interpretation.
- Challenge the strongest assumption.
- Surface missing evidence that would change the conclusion.
- Produce concrete recommendations and follow-up questions.
- Preserve source URLs from the evidence brief and add any new source URLs used by Council.
- Mark uncertainty explicitly. Do not invent missing values.

## Output target

Return the final result as JSON matching \`result.schema.json\`.

If you can access the local filesystem, save it here:

\`${resultPath}\`

If you cannot access the filesystem, return the JSON in the chat so the local agent or user can place it in that file.
`;
}

export function buildCouncilTask({
  task,
  template = 'competitive-analysis',
  evidencePath,
  resultPath,
}) {
  if (!COUNCIL_TEMPLATES.includes(template)) {
    throw new Error(`unsupported council template: ${template}`);
  }

  if (template === 'strategy-review') {
    return buildStrategyReviewCouncilTask({ task, evidencePath, resultPath });
  }
  return buildCompetitiveAnalysisCouncilTask({ task, evidencePath, resultPath });
}

export function createCouncilRun({
  task,
  template = 'competitive-analysis',
  evidencePath,
  opts = {},
  config = {},
}) {
  const ctx = makeArtifactContext({ command: 'council', query: task, opts, config });
  if (!ctx) {
    throw new Error('council runs require artifacts; omit --no-artifact for this command');
  }

  mkdirSync(ctx.artifactDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const resultPath = join(ctx.artifactDir, COUNCIL_RESULT_FILE);
  const taskText = buildCouncilTask({ task, template, evidencePath, resultPath });
  const meta = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    command: 'council',
    query: task,
    template,
    evidencePath: evidencePath || null,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
    status: 'pending',
  };
  const result = {
    query: task,
    answer: '',
    sources: [],
    command: 'council',
    mode: 'council',
    model: 'model-council',
    template,
    evidencePath: evidencePath || null,
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    createdAt,
    status: 'pending',
    councilResultFile: COUNCIL_RESULT_FILE,
  };

  writeJson(join(ctx.artifactDir, 'meta.json'), meta);
  writeFileSync(join(ctx.artifactDir, 'query.txt'), `${task}\n`, 'utf8');
  writeFileSync(join(ctx.artifactDir, 'answer.md'), taskText, 'utf8');
  writeJson(join(ctx.artifactDir, 'result.json'), result);
  writeJson(join(ctx.artifactDir, 'sources.json'), []);
  writeFileSync(join(ctx.artifactDir, 'task.md'), taskText, 'utf8');
  writeJson(join(ctx.artifactDir, 'result.schema.json'), RESULT_SCHEMA);
  writeJson(join(ctx.artifactDir, COUNCIL_RESULT_FILE), PENDING_COUNCIL_RESULT);

  return {
    artifactId: ctx.artifactId,
    artifactDir: ctx.artifactDir,
    taskPath: join(ctx.artifactDir, 'task.md'),
    resultPath,
  };
}

function assertCouncilResult(value) {
  const missing = [
    'summary',
    'consensus',
    'disagreements',
    'risks',
    'recommendations',
    'followups',
    'sources',
    'confidence',
    'checked_at',
    'notes',
  ].filter((key) => !(key in value));
  if (missing.length) return { ok: false, reason: `missing fields: ${missing.join(', ')}` };
  if (!['low', 'medium', 'high'].includes(value.confidence)) {
    return { ok: false, reason: 'confidence must be low, medium, or high' };
  }
  for (const key of ['consensus', 'disagreements', 'risks', 'recommendations', 'followups', 'sources', 'notes']) {
    if (!Array.isArray(value[key])) return { ok: false, reason: `${key} must be an array` };
  }
  return { ok: true, reason: null };
}

export function inspectCouncilRun(runDir) {
  const artifactDir = resolve(runDir);
  const resultPath = join(artifactDir, COUNCIL_RESULT_FILE);
  const metaPath = join(artifactDir, 'meta.json');
  if (!existsSync(metaPath)) {
    return { status: 'missing', artifactDir, resultPath, reason: 'meta.json not found' };
  }
  if (!existsSync(resultPath)) {
    return { status: 'pending', artifactDir, resultPath, reason: `${COUNCIL_RESULT_FILE} not found` };
  }
  try {
    const result = readJsonFile(resultPath);
    if (result._status === 'pending') {
      return { status: 'pending', artifactDir, resultPath, reason: `${COUNCIL_RESULT_FILE} is still pending` };
    }
    const validation = assertCouncilResult(result);
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

export function importCouncilResult(runDir) {
  const status = inspectCouncilRun(runDir);
  if (status.status !== 'complete') {
    throw new Error(`council result is ${status.status}: ${status.reason}`);
  }
  return status.result;
}

export function openCouncilUrl() {
  if (process.platform === 'darwin') {
    execFileSync('open', [COUNCIL_URL]);
    return true;
  }
  return false;
}

export function copyCouncilTaskToClipboard(runDir) {
  const taskText = readCouncilTaskFile(runDir);
  return copyTextToClipboard(taskText);
}

export function readCouncilTaskFile(runDir) {
  return readFileSync(join(resolve(runDir), 'task.md'), 'utf8');
}
