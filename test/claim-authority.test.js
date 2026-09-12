import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimAuthority } from '../src/core/claim-authority.js';

test('resource scope conflicts prevent concurrent mutation', () => {
  const claims = new ClaimAuthority();
  const first = claims.claim({ taskKey: 'a', ownerId: 'w1', scopes: ['repo:x'] }, 1000);
  assert.ok(first);
  assert.equal(claims.claim({ taskKey: 'b', ownerId: 'w2', scopes: ['repo:x'] }, 1001), null);
  assert.ok(claims.claim({ taskKey: 'c', ownerId: 'w2', scopes: ['repo:y'] }, 1001));
});

test('fencing invalidates stale claim token', () => {
  const claims = new ClaimAuthority();
  const first = claims.claim({ taskKey: 'a', ownerId: 'w1' }, 1000);
  assert.equal(claims.validate(first, 1001), true);
  claims.fence('a');
  assert.equal(claims.validate(first, 1002), false);
  const second = claims.claim({ taskKey: 'a', ownerId: 'w2' }, 1003);
  assert.ok(second.generation > first.generation);
});

test('expired claims release resource locks', () => {
  const claims = new ClaimAuthority();
  claims.claim({ taskKey: 'a', ownerId: 'w1', scopes: ['repo:x'], ttlMs: 10 }, 1000);
  const expired = claims.sweepExpired(1010);
  assert.equal(expired.length, 1);
  assert.ok(claims.claim({ taskKey: 'b', ownerId: 'w2', scopes: ['repo:x'] }, 1011));
});
