import assert from 'node:assert/strict';
import test from 'node:test';
import { customerFailureReason, deriveGroupedTransferStatus } from '../lib/status.ts';

const commitments = (...statuses: string[]) => statuses.map((status) => ({ status }));

test('payment states remain distinct from payout states', () => {
  assert.equal(deriveGroupedTransferStatus('awaiting_payment', [], 'pending'), 'awaiting_payment');
  assert.equal(deriveGroupedTransferStatus('payment_processing', [], 'processing'), 'payment_processing');
  assert.equal(deriveGroupedTransferStatus('funded', [], 'successful'), 'funded');
  assert.equal(deriveGroupedTransferStatus('payment_failed', [], 'failed'), 'payment_failed');
});

test('grouped transfer only completes when every transfer succeeds', () => {
  assert.equal(deriveGroupedTransferStatus('completed', commitments('completed')), 'completed');
  assert.equal(deriveGroupedTransferStatus('completed', commitments('completed', 'processing')), 'payouts_processing');
  assert.equal(deriveGroupedTransferStatus('completed', commitments('completed', 'confirming_unknown')), 'payouts_processing');
  assert.equal(deriveGroupedTransferStatus('completed', commitments('completed', 'creating')), 'payouts_processing');
  assert.equal(deriveGroupedTransferStatus('completed', commitments('completed', 'reconciliation_required')), 'payouts_processing');
});

test('grouped transfer handles successful, failed, and uncertain mixes', () => {
  assert.equal(deriveGroupedTransferStatus('funded', commitments('successful', 'successful')), 'completed');
  assert.equal(deriveGroupedTransferStatus('funded', commitments('successful', 'processing')), 'payouts_processing');
  assert.equal(deriveGroupedTransferStatus('funded', commitments('successful', 'failed')), 'partially_failed');
  assert.equal(deriveGroupedTransferStatus('funded', commitments('failed', 'failed')), 'failed');
  assert.equal(deriveGroupedTransferStatus('funded', commitments('resolution')), 'needs_attention');
});

test('safe customer failure wording is preserved or mapped', () => {
  assert.equal(customerFailureReason('Please review the recipient details.', 'raw provider error'), 'Please review the recipient details.');
  assert.equal(customerFailureReason(null, 'recipient account rejected'), "This transfer needs your attention. Check the recipient's payment details.");
  assert.equal(customerFailureReason(null, 'provider stack trace 500'), "We couldn't complete this transfer. Please review the recipient details.");
});