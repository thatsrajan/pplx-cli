import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthenticatedSession } from '../src/session.js';

describe('isAuthenticatedSession', () => {
  it('rejects anonymous session payloads', () => {
    assert.equal(isAuthenticatedSession({}), false);
    assert.equal(isAuthenticatedSession(null), false);
  });

  it('accepts session payloads with user identity', () => {
    assert.equal(isAuthenticatedSession({ user: { email: 'user@example.com' } }), true);
    assert.equal(isAuthenticatedSession({ user: { id: 'user-id' } }), true);
    assert.equal(isAuthenticatedSession({ user: { name: 'User Name' } }), true);
  });
});
