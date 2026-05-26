import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COUNCIL_RESULT_FILE,
  buildCouncilTask,
  createCouncilRun,
  importCouncilResult,
  inspectCouncilRun,
} from '../src/council.js';

describe('council artifact workflow', () => {
  it('builds a competitive-analysis Model Council task prompt', () => {
    const prompt = buildCouncilTask({
      task: 'critique competitor A pricing analysis',
      evidencePath: '/tmp/computer-result.json',
      resultPath: '/tmp/council-result.json',
    });
    assert.match(prompt, /Perplexity Model Council Task/);
    assert.match(prompt, /multi-model review/);
    assert.match(prompt, /\/tmp\/computer-result\.json/);
    assert.match(prompt, /\/tmp\/council-result\.json/);
  });

  it('creates a council run folder with handoff files', () => {
    const root = mkdtempSync(join(tmpdir(), 'pplx-council-'));
    const run = createCouncilRun({
      task: 'review competitor strategy',
      opts: { out: root, artifactId: 'competitor-strategy' },
    });

    assert.equal(run.artifactId, 'competitor-strategy');
    assert.equal(run.artifactDir, join(root, 'competitor-strategy'));
    assert.equal(existsSync(join(run.artifactDir, 'task.md')), true);
    assert.equal(existsSync(join(run.artifactDir, COUNCIL_RESULT_FILE)), true);
    assert.equal(inspectCouncilRun(run.artifactDir).status, 'pending');
  });

  it('reports invalid and complete council results', () => {
    const root = mkdtempSync(join(tmpdir(), 'pplx-council-'));
    const run = createCouncilRun({
      task: 'review competitor strategy',
      opts: { out: root, artifactId: 'review-result' },
    });

    writeFileSync(join(run.artifactDir, COUNCIL_RESULT_FILE), '{"summary":"missing most fields"}\n');
    assert.equal(inspectCouncilRun(run.artifactDir).status, 'invalid');

    const result = {
      summary: 'The threat is material but timing is uncertain.',
      consensus: ['Pricing is moving upmarket.'],
      disagreements: ['Whether this is defensive or expansionary.'],
      risks: ['Evidence is thin on enterprise adoption.'],
      recommendations: ['Monitor pricing page and enterprise docs.'],
      followups: ['Check partner pages next week.'],
      sources: [{ url: 'https://example.com' }],
      confidence: 'medium',
      checked_at: '2026-05-26T00:00:00.000Z',
      notes: [],
    };
    writeFileSync(join(run.artifactDir, COUNCIL_RESULT_FILE), `${JSON.stringify(result)}\n`);
    assert.equal(inspectCouncilRun(run.artifactDir).status, 'complete');
    assert.deepEqual(importCouncilResult(run.artifactDir), result);
  });
});
