import assert from 'node:assert/strict';
import test from 'node:test';
import { isPermanentAdminSyncStatus } from './admin-sync.js';

test('AdminDuni outage and rate limits remain retryable', () => {
  assert.equal(isPermanentAdminSyncStatus(null), false);
  assert.equal(isPermanentAdminSyncStatus(500), false);
  assert.equal(isPermanentAdminSyncStatus(503), false);
  assert.equal(isPermanentAdminSyncStatus(408), false);
  assert.equal(isPermanentAdminSyncStatus(429), false);
});

test('fixed client errors can eventually move to dead-letter', () => {
  assert.equal(isPermanentAdminSyncStatus(400), true);
  assert.equal(isPermanentAdminSyncStatus(401), true);
  assert.equal(isPermanentAdminSyncStatus(409), true);
});
