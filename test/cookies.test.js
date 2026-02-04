import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cookieHeader } from '../src/cookies.js';

describe('cookieHeader', () => {
  it('formats cookies correctly', () => {
    const result = cookieHeader({ foo: 'bar', baz: 'qux' });
    assert.equal(result, 'foo=bar; baz=qux');
  });

  it('handles empty cookies', () => {
    assert.equal(cookieHeader({}), '');
  });

  it('handles single cookie', () => {
    assert.equal(cookieHeader({ a: 'b' }), 'a=b');
  });
});
