export function deriveGroupedTransferStatus(
  planStatus: string | null | undefined,
  commitments: Array<{ status: string | null | undefined }> = [],
  paymentStatus?: string | null
): string {
  const normalizedPlanStatus = String(planStatus ?? '').toLowerCase();
  const normalizedPaymentStatus = String(paymentStatus ?? '').toLowerCase();

  if (normalizedPlanStatus === 'payment_failed' || normalizedPaymentStatus === 'failed') return 'payment_failed';
  if (normalizedPlanStatus === 'payment_processing' || normalizedPaymentStatus === 'processing') return 'payment_processing';

  if (!commitments.length) {
    if (normalizedPlanStatus === 'awaiting_payment') return 'awaiting_payment';
    if (normalizedPlanStatus === 'funded') return 'funded';
    if (normalizedPlanStatus === 'quoted') return 'quoted';
    if (normalizedPlanStatus === 'draft') return 'draft';
    return normalizedPlanStatus || 'draft';
  }

  const activeStatuses = new Set([
    'pending', 'ready', 'creating', 'creating_unknown', 'submitted',
    'confirming', 'confirming_unknown', 'processing', 'reconciliation_required',
  ]);
  const terminalSuccessStatuses = new Set(['completed', 'successful', 'confirmed']);
  const failedStatuses = new Set(['failed', 'cancelled']);
  const attentionStatuses = new Set(['resolution']);
  const uncertainStatuses = new Set(['creating_unknown', 'confirming_unknown', 'reconciliation_required']);

  const statuses = commitments.map((commitment) => String(commitment.status ?? '').toLowerCase());
  const activeCount = statuses.filter((status) => activeStatuses.has(status)).length;
  const successCount = statuses.filter((status) => terminalSuccessStatuses.has(status)).length;
  const failedCount = statuses.filter((status) => failedStatuses.has(status)).length;
  const uncertainCount = statuses.filter((status) => uncertainStatuses.has(status)).length;
  const attentionCount = statuses.filter((status) => attentionStatuses.has(status)).length;

  if (activeCount > 0) return 'payouts_processing';
  if (successCount === commitments.length) return 'completed';
  if (failedCount === commitments.length) return 'failed';
  if (successCount > 0 && (failedCount > 0 || attentionCount > 0)) return 'partially_failed';
  if (attentionCount > 0 && activeCount === 0) return 'needs_attention';
  if (uncertainCount > 0 || attentionCount > 0) return 'payouts_processing';
  if (normalizedPaymentStatus === 'successful') return 'funded';
  if (normalizedPlanStatus === 'cancelled') return 'cancelled';
  if (normalizedPlanStatus === 'failed') return 'failed';
  if (normalizedPlanStatus === 'partially_failed') return 'partially_failed';
  return normalizedPlanStatus === 'funded' ? 'funded' : normalizedPlanStatus || 'payouts_processing';
}

export function customerFailureReason(
  safeReason: string | null | undefined,
  internalReason?: string | null
): string {
  if (safeReason?.trim()) return safeReason.trim();

  const value = internalReason?.toLowerCase() ?? '';
  if (value.includes('recipient') || value.includes('account')) {
    return 'This transfer needs your attention. Check the recipient\'s payment details.';
  }
  if (value.includes('insufficient') && value.includes('balance')) {
    return 'We couldn\'t complete this transfer right now. Please try again later.';
  }
  if (value.includes('network') || value.includes('timeout') || value.includes('unavailable')) {
    return 'We couldn\'t send this transfer because of a temporary service issue. Please try again.';
  }
  if (value.includes('compliance') || value.includes('verification') || value.includes('kyc')) {
    return 'Additional verification is needed before this transfer can be completed.';
  }
  return 'We couldn\'t complete this transfer. Please review the recipient details.';
}