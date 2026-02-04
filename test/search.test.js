import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNestedText } from '../src/search.js';

describe('parseNestedText', () => {
  it('does nothing for non-string text', () => {
    const json = { text: 123 };
    parseNestedText(json);
    assert.equal(json.text, 123);
  });

  it('parses nested FINAL step with answer', () => {
    const innerAnswer = JSON.stringify({ answer: 'hello world', chunks: ['hello', ' world'] });
    const text = JSON.stringify([{ step_type: 'FINAL', content: { answer: innerAnswer } }]);
    const json = { text };
    parseNestedText(json);
    assert.equal(json.answer, 'hello world');
    assert.deepEqual(json.chunks, ['hello', ' world']);
  });

  it('sets _parseError on invalid JSON text', () => {
    const json = { text: 'not json' };
    parseNestedText(json);
    assert.equal(json._parseError, true);
  });

  it('sets _parseError on invalid inner answer JSON', () => {
    const text = JSON.stringify([{ step_type: 'FINAL', content: { answer: 'not json' } }]);
    const json = { text };
    parseNestedText(json);
    assert.equal(json._parseError, true);
  });
});
