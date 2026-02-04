import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSources } from '../src/format.js';

describe('formatSources', () => {
  it('returns empty string for null/empty input', () => {
    assert.equal(formatSources(null), '');
    assert.equal(formatSources([]), '');
  });

  it('formats basic sources', () => {
    const result = formatSources([{ url: 'https://example.com' }]);
    assert.ok(result.includes('example.com'));
  });

  it('formats full sources with title', () => {
    const result = formatSources([{ name: 'Example', url: 'https://example.com' }], { full: true });
    assert.ok(result.includes('Example'));
    assert.ok(result.includes('example.com'));
  });
});
