import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RESEARCH_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  parseTimeoutMs,
  resolveTimeoutMs,
} from '../src/timeout.js';

describe('timeout helpers', () => {
  it('parses millisecond, second, and minute values', () => {
    assert.equal(parseTimeoutMs('120000'), 120000);
    assert.equal(parseTimeoutMs('120s'), 120000);
    assert.equal(parseTimeoutMs('2m'), 120000);
  });

  it('uses a longer default for deep research', () => {
    assert.equal(resolveTimeoutMs({ mode: 'pro' }), DEFAULT_SEARCH_TIMEOUT_MS);
    assert.equal(resolveTimeoutMs({ mode: 'deep-research' }), DEFAULT_RESEARCH_TIMEOUT_MS);
  });

  it('lets explicit CLI values override defaults', () => {
    assert.equal(resolveTimeoutMs({ mode: 'deep-research', timeoutMs: '30s' }), 30000);
  });

  it('rejects invalid timeout values', () => {
    assert.throws(() => parseTimeoutMs('later'), /positive duration/);
    assert.throws(() => parseTimeoutMs('0'), /positive duration/);
  });
});
