import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ARTIFACT_DIR,
  makeArtifactContext,
  resolveArtifactDir,
  writeStandardArtifact,
} from '../src/artifacts.js';

describe('artifact helpers', () => {
  it('resolves explicit, configured, and default artifact directories', () => {
    assert.equal(resolveArtifactDir({ out: '/tmp/pplx-explicit' }), '/tmp/pplx-explicit');
    assert.equal(
      resolveArtifactDir({ config: { artifactDir: '/tmp/pplx-configured' } }),
      '/tmp/pplx-configured',
    );
    assert.equal(resolveArtifactDir(), DEFAULT_ARTIFACT_DIR);
  });

  it('returns null when artifacts are disabled', () => {
    assert.equal(makeArtifactContext({
      command: 'search',
      query: 'hello',
      opts: { artifact: false },
    }), null);
  });

  it('rejects unsafe deterministic artifact ids', () => {
    assert.throws(() => makeArtifactContext({
      command: 'search',
      query: 'hello',
      opts: { artifactId: '../bad' },
    }), /artifact id/);
  });

  it('writes the standard artifact files', () => {
    const root = mkdtempSync(join(tmpdir(), 'pplx-artifacts-'));
    const ctx = makeArtifactContext({
      command: 'search',
      query: 'best ramen nearby',
      opts: { out: root, artifactId: 'fixed-run' },
    });
    const info = writeStandardArtifact(ctx, {
      answer: 'Try the closest well-reviewed option.',
      sources: [{ title: 'Example', url: 'https://example.com' }],
      mode: 'pro',
      model: 'default',
    });

    assert.equal(info.artifactId, 'fixed-run');
    assert.equal(info.artifactDir, join(root, 'fixed-run'));
    assert.match(readFileSync(join(info.artifactDir, 'query.txt'), 'utf8'), /best ramen/);
    assert.match(readFileSync(join(info.artifactDir, 'answer.md'), 'utf8'), /closest/);
    const result = JSON.parse(readFileSync(join(info.artifactDir, 'result.json'), 'utf8'));
    assert.equal(result.artifactId, 'fixed-run');
    assert.equal(result.sources[0].url, 'https://example.com');
  });
});
