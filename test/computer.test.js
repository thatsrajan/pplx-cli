import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPUTER_RESULT_FILE,
  buildComputerTask,
  createComputerRun,
  importComputerResult,
  inspectComputerRun,
} from '../src/computer.js';

describe('computer artifact workflow', () => {
  it('builds a broad comparison task prompt', () => {
    const prompt = buildComputerTask({
      task: 'compare dinner options nearby',
      resultPath: '/tmp/result.json',
    });
    assert.match(prompt, /products, real estate, restaurants/);
    assert.match(prompt, /\/tmp\/result\.json/);
  });

  it('creates a computer run folder with handoff files', () => {
    const root = mkdtempSync(join(tmpdir(), 'pplx-computer-'));
    const run = createComputerRun({
      task: 'compare grocery prices',
      opts: { out: root, artifactId: 'compare-groceries' },
    });

    assert.equal(run.artifactId, 'compare-groceries');
    assert.equal(run.artifactDir, join(root, 'compare-groceries'));
    assert.equal(existsSync(join(run.artifactDir, COMPUTER_RESULT_FILE)), true);
    assert.equal(inspectComputerRun(run.artifactDir).status, 'pending');
  });

  it('reports invalid and complete computer results', () => {
    const root = mkdtempSync(join(tmpdir(), 'pplx-computer-'));
    const run = createComputerRun({
      task: 'compare real estate listings',
      opts: { out: root, artifactId: 'compare-homes' },
    });

    writeFileSync(join(run.artifactDir, COMPUTER_RESULT_FILE), '{"summary":"missing most fields"}\n');
    assert.equal(inspectComputerRun(run.artifactDir).status, 'invalid');

    const result = {
      summary: 'Option A is better.',
      winner: 'Option A',
      confidence: 'medium',
      items: [{ name: 'Option A' }],
      sources: [{ url: 'https://example.com' }],
      checked_at: '2026-05-22T00:00:00.000Z',
      notes: [],
    };
    writeFileSync(join(run.artifactDir, COMPUTER_RESULT_FILE), `${JSON.stringify(result)}\n`);
    assert.equal(inspectComputerRun(run.artifactDir).status, 'complete');
    assert.deepEqual(importComputerResult(run.artifactDir), result);
  });
});
