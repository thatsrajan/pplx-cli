import { readFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { loadCookies } from './cookies.js';
import { testAuth } from './session.js';
import { search } from './search.js';
import { LabsClient } from './labs.js';
import { resolveTimeoutMs } from './timeout.js';
import { makeArtifactContext, resolveArtifactDir, writeStandardArtifact } from './artifacts.js';
import {
  createComputerRun,
  importComputerResult,
  inspectComputerRun,
  readTaskFile,
} from './computer.js';
import { MODEL_MAP, LABS_MODELS } from './constants.js';

const SERVER_NAME = 'pplx';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SERVER_VERSION = pkg.version;
const SEARCH_MODES = ['auto', 'pro', 'reasoning', 'deep-research'];
const TRANSPORTS = ['auto', 'http', 'playwright', 'curl', 'chrome'];

const optionalArtifactArgs = {
  out: z.string().optional().describe('Artifact root for this run. Defaults to ~/.config/pplx/config.json artifactDir.'),
  artifactId: z.string().optional().describe('Deterministic artifact id for this run.'),
  saveArtifact: z.boolean().optional().default(true).describe('Save the standard pplx artifact files.'),
};

function toTextResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function normalizeSources(sources) {
  if (!sources) return ['web'];
  if (Array.isArray(sources)) return sources;
  return String(sources).split(',').map((source) => source.trim()).filter(Boolean);
}

function normalizeSourceResult(result) {
  return {
    title: result.name || result.title || '',
    url: result.url || '',
  };
}

function mcpArtifactOpts(args = {}) {
  if (args.saveArtifact === false) return { artifact: false };
  return {
    out: args.out,
    artifactId: args.artifactId,
  };
}

function transportOpts(transport, config) {
  if (transport === 'chrome') return { chrome: true };
  if (transport === 'playwright') return { playwright: true };
  if (transport === 'curl') return { curl: true };
  if (transport === 'http') return { playwright: false, chrome: false, curl: false };
  return {
    chrome: config.chrome,
    playwright: config.playwright,
    curl: config.curl,
  };
}

async function assertAuthReady({ cookies, opts }) {
  if (opts.chrome || opts.allowAnonymous) return;
  if (Object.keys(cookies).length === 0) {
    throw new Error('No Perplexity cookies stored. Run: pplx auth --browser auto');
  }
  const ok = await testAuth(cookies);
  if (!ok) {
    throw new Error('Stored Perplexity cookies are invalid or expired. Run: pplx auth --browser auto');
  }
}

export async function runSearchTool(args) {
  const config = loadConfig();
  const mode = args.mode || 'pro';
  const transport = args.transport || 'auto';
  const opts = {
    ...config,
    ...transportOpts(transport, config),
    mode,
    model: args.model,
    sources: normalizeSources(args.sources),
    language: args.language || args.lang || 'en-US',
    incognito: args.incognito ?? false,
    allowAnonymous: args.allowAnonymous ?? false,
    timeoutMs: undefined,
  };
  opts.timeoutMs = resolveTimeoutMs({ ...opts, timeoutMs: args.timeoutMs, mode });

  const cookies = loadCookies() || {};
  await assertAuthReady({ cookies, opts });

  const artifactCtx = makeArtifactContext({
    command: mode === 'deep-research' ? 'research' : mode === 'reasoning' ? 'reason' : 'search',
    query: args.query,
    opts: mcpArtifactOpts(args),
    config,
  });

  let lastAnswer = '';
  let lastData = null;
  for await (const data of search(args.query, cookies, opts)) {
    lastData = data;
    if ((data.answer || '').length >= lastAnswer.length) {
      lastAnswer = data.answer || lastAnswer;
    }
  }

  const answer = lastData?.answer || lastAnswer || '';
  if (!answer) throw new Error('No answer received from Perplexity.');

  const sources = (lastData?.web_results || []).map(normalizeSourceResult);
  const artifactInfo = writeStandardArtifact(artifactCtx, {
    answer,
    sources,
    mode,
    model: args.model || 'default',
  });

  return {
    query: args.query,
    answer,
    sources,
    mode,
    model: args.model || 'default',
    artifactDir: artifactInfo?.artifactDir || null,
    artifactId: artifactInfo?.artifactId || null,
  };
}

export async function runLabsTool(args) {
  const config = loadConfig();
  const model = args.model || 'sonar';
  const artifactCtx = makeArtifactContext({
    command: 'labs',
    query: args.query,
    opts: mcpArtifactOpts(args),
    config,
  });
  const client = new LabsClient();
  let answer = '';
  const events = [];
  try {
    await client.connect();
    for await (const data of client.ask(args.query, model)) {
      events.push(data);
      answer = data.output || answer;
    }
  } finally {
    client.close();
  }

  const artifactInfo = writeStandardArtifact(artifactCtx, {
    answer,
    sources: [],
    mode: 'labs',
    model,
  });

  return {
    query: args.query,
    answer,
    events,
    mode: 'labs',
    model,
    artifactDir: artifactInfo?.artifactDir || null,
    artifactId: artifactInfo?.artifactId || null,
  };
}

export async function getAuthStatus() {
  const cookies = loadCookies() || {};
  const cookieCount = Object.keys(cookies).length;
  if (cookieCount === 0) {
    return {
      authenticated: false,
      cookieCount,
      message: 'No cookies stored. Run: pplx auth --browser auto',
    };
  }
  const authenticated = await testAuth(cookies);
  return {
    authenticated,
    cookieCount,
    message: authenticated
      ? 'Stored Perplexity cookies are valid.'
      : 'Stored Perplexity cookies are invalid or expired. Run: pplx auth --browser auto',
  };
}

function resolveRunDir(run, out, config) {
  if (isAbsolute(run) || run.includes('/')) return resolve(run);
  return join(resolveArtifactDir({ out, config }), run);
}

export function createPplxMcpServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool('pplx_search', {
    title: 'Perplexity Search',
    description: 'Run an authenticated Perplexity search/reasoning/deep-research query and return answer, sources, and artifact paths.',
    inputSchema: {
      query: z.string().min(1).describe('Question or research prompt.'),
      mode: z.enum(SEARCH_MODES).optional().default('pro').describe('Perplexity mode.'),
      model: z.string().optional().describe('Optional model alias or raw Perplexity model id.'),
      sources: z.array(z.string()).optional().default(['web']).describe('Source types such as web, scholar, or social.'),
      language: z.string().optional().default('en-US').describe('Language code.'),
      incognito: z.boolean().optional().default(false).describe('Do not save the query to Perplexity history.'),
      transport: z.enum(TRANSPORTS).optional().default('auto').describe('Transport override for Perplexity calls.'),
      timeoutMs: z.union([z.string(), z.number()]).optional().describe('Overall stream timeout, e.g. 120s, 10m, or milliseconds.'),
      allowAnonymous: z.boolean().optional().default(false).describe('Allow anonymous Perplexity responses when cookies are missing or expired.'),
      ...optionalArtifactArgs,
    },
    annotations: {
      title: 'Perplexity Search',
      readOnlyHint: false,
      openWorldHint: true,
    },
  }, async (args) => toTextResult(await runSearchTool(args)));

  server.registerTool('pplx_labs', {
    title: 'Perplexity Labs',
    description: 'Query Perplexity Labs models without browser-cookie auth.',
    inputSchema: {
      query: z.string().min(1).describe('Question or prompt.'),
      model: z.enum(LABS_MODELS).optional().default('sonar').describe('Labs model.'),
      ...optionalArtifactArgs,
    },
    annotations: {
      title: 'Perplexity Labs',
      readOnlyHint: false,
      openWorldHint: true,
    },
  }, async (args) => toTextResult(await runLabsTool(args)));

  server.registerTool('pplx_auth_status', {
    title: 'Perplexity Auth Status',
    description: 'Check whether stored Perplexity cookies are present and authenticated.',
    inputSchema: {},
    annotations: {
      title: 'Perplexity Auth Status',
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => toTextResult(await getAuthStatus()));

  server.registerTool('pplx_models', {
    title: 'Perplexity Models',
    description: 'List known Perplexity model aliases exposed by pplx-cli.',
    inputSchema: {},
    annotations: {
      title: 'Perplexity Models',
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => toTextResult({ modes: MODEL_MAP, labs: LABS_MODELS }));

  server.registerTool('pplx_computer_create', {
    title: 'Create Perplexity Computer Handoff',
    description: 'Create a Perplexity Computer artifact handoff folder containing task.md, result.schema.json, and computer-result.json.',
    inputSchema: {
      task: z.string().min(1).describe('Live web task for Perplexity Computer.'),
      template: z.literal('compare').optional().default('compare').describe('Computer task template.'),
      out: z.string().optional().describe('Artifact root for this run.'),
      artifactId: z.string().optional().describe('Deterministic artifact id for this run.'),
    },
    annotations: {
      title: 'Create Perplexity Computer Handoff',
      readOnlyHint: false,
      openWorldHint: false,
    },
  }, async (args) => {
    const run = createComputerRun({
      task: args.task,
      template: args.template || 'compare',
      opts: { out: args.out, artifactId: args.artifactId },
      config: loadConfig(),
    });
    return toTextResult(run);
  });

  server.registerTool('pplx_computer_status', {
    title: 'Perplexity Computer Status',
    description: 'Inspect a Perplexity Computer artifact run.',
    inputSchema: {
      run: z.string().min(1).describe('Run id or absolute run folder path.'),
      out: z.string().optional().describe('Artifact root used when run is an id.'),
    },
    annotations: {
      title: 'Perplexity Computer Status',
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async (args) => {
    const runDir = resolveRunDir(args.run, args.out, loadConfig());
    return toTextResult(inspectComputerRun(runDir));
  });

  server.registerTool('pplx_computer_import', {
    title: 'Import Perplexity Computer Result',
    description: 'Read and validate a completed computer-result.json from a Perplexity Computer artifact run.',
    inputSchema: {
      run: z.string().min(1).describe('Run id or absolute run folder path.'),
      out: z.string().optional().describe('Artifact root used when run is an id.'),
    },
    annotations: {
      title: 'Import Perplexity Computer Result',
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async (args) => {
    const runDir = resolveRunDir(args.run, args.out, loadConfig());
    return toTextResult(importComputerResult(runDir));
  });

  server.registerTool('pplx_computer_read_task', {
    title: 'Read Perplexity Computer Task',
    description: 'Read the task.md prompt from a Perplexity Computer artifact run.',
    inputSchema: {
      run: z.string().min(1).describe('Run id or absolute run folder path.'),
      out: z.string().optional().describe('Artifact root used when run is an id.'),
    },
    annotations: {
      title: 'Read Perplexity Computer Task',
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async (args) => {
    const runDir = resolveRunDir(args.run, args.out, loadConfig());
    return toTextResult({ runDir, task: readTaskFile(runDir) });
  });

  return server;
}

export async function runMcpServer() {
  const server = createPplxMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('pplx MCP server running on stdio');
}
