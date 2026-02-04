import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngineIO } from '../src/labs.js';

describe('parseEngineIO', () => {
  it('parses plain JSON', () => {
    const result = parseEngineIO('{"sid":"abc123"}');
    assert.deepEqual(result, { sid: 'abc123' });
  });

  it('parses length-prefixed format', () => {
    const result = parseEngineIO('96:0{"sid":"abc123","upgrades":["websocket"]}');
    assert.equal(result.sid, 'abc123');
  });

  it('handles prefix before JSON brace', () => {
    const result = parseEngineIO('0{"sid":"test"}');
    assert.equal(result.sid, 'test');
  });

  it('throws on no JSON found', () => {
    assert.throws(() => parseEngineIO('no json here'), /No JSON found/);
  });
});
