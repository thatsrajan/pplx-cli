import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/retry.js';

describe('withRetry', () => {
  it('passes through successful responses', async () => {
    const resp = { status: 200, ok: true };
    const result = await withRetry(() => resp);
    assert.equal(result.status, 200);
  });

  it('retries on 500 status', async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts++;
      if (attempts < 3) return { status: 500, headers: { get: () => null } };
      return { status: 200, ok: true };
    }, { baseDelay: 10 });
    assert.equal(attempts, 3);
    assert.equal(result.status, 200);
  });

  it('stops after max retries', async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts++;
      return { status: 500, headers: { get: () => null } };
    }, { maxRetries: 2, baseDelay: 10 });
    assert.equal(attempts, 3); // initial + 2 retries
    assert.equal(result.status, 500);
  });

  it('retries on thrown errors', async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts++;
      if (attempts < 2) throw new Error('network');
      return { status: 200, ok: true };
    }, { baseDelay: 10 });
    assert.equal(attempts, 2);
    assert.equal(result.status, 200);
  });

  it('throws after exhausting retries on errors', async () => {
    await assert.rejects(
      () => withRetry(() => { throw new Error('fail'); }, { maxRetries: 1, baseDelay: 10 }),
      { message: 'fail' }
    );
  });
});
