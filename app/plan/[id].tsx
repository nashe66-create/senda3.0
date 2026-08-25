import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  ViewStyle,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  Plus,
  Trash2,
  TrendingUp,
  Calendar,
  Users,
  CheckCircle2,
  Smartphone,
  Building2,
  Wallet,
  Receipt,
  ChevronRight,
  Repeat,
  Send,
  Clock,
  AlertCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Loading } from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Colors, Spacing, Typography, COUNTRIES, RECURRING_OPTIONS } from '@/lib/theme';
import {
  fetchPlanWithCommitments,
  fetchRecipients,
  addCommitment,
  deleteCommitment,
  deletePlan,
  updatePlan,
  recalcPlanTotals,
  createTransaction,
  formatGBP,
  formatCurrency,
  formatDate,
  getReceivingMethodLabel,
  getRecurringLabel,
  createQuote,
  lockQuote,
  releasePayouts,
  confirmPayouts,
  retryPayout,
  cancelOrder,
  fetchSupportedPayoutMethods,
} from '@/lib/data';
import {
  PlanWithCommitments,
  Recipient,
  ReceivingMethod,
  CommitmentWithRecipient,
  PayoutMethod,
  QuoteResult,
} from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ShieldAlert } from 'lucide-react-native';

const methodIcons: Record<ReceivingMethod, typeof Smartphone> = {
  mobile_money: Smartphone,
  bank_account: Building2,
  cash_pickup: Wallet,
  bill_payment: Receipt,
};

export default function PlanDetailScreen() {
  const { id, created_recipient_id } = useLocalSearchParams<{
    id: string;
    created_recipient_id?: string;
  }>();
  const { profile } = useAuth();
  const [plan, setPlan] = useState<PlanWithCommitments | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddCommitment, setShowAddCommitment] = useState(false);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [commitmentAmount, setCommitmentAmount] = useState('');
  const [commitmentError, setCommitmentError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Quote state
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteCountdown, setQuoteCountdown] = useState<number | null>(null);
  const [locking, setLocking] = useState(false);

  // Payout state
  const [releasingPayouts, setReleasingPayouts] = useState(false);
  const [confirmingPayouts, setConfirmingPayouts] = useState(false);
  const [payoutResult, setPayoutResult] = useState<{
    total?: number;
    submitted?: number;
    confirmed?: number;
    failed?: number;
    errors?: string[];
  } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [supportedMethods, setSupportedMethods] = useState<PayoutMethod[]>([]);

  // Cancelling
  const [cancelling, setCancelling] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPlan = useCallback(async () => {
    if (!id) return;
    try {
      const [planData, recipData] = await Promise.all([
        fetchPlanWithCommitments(id),
        fetchRecipients(),
      ]);
      setPlan(planData);
      setRecipients(recipData);
    } catch (e) {
      console.error('Failed to load plan:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadPlan();
    }, [loadPlan])
  );

  // Pre-select a recipient that was just created from this plan
  useEffect(() => {
    if (created_recipient_id) {
      setSelectedRecipientId(created_recipient_id);
      setCommitmentAmount('');
      setCommitmentError(null);
      setShowAddCommitment(true);
      router.setParams({ created_recipient_id: undefined });
    }
  }, [created_recipient_id]);

  // Quote countdown timer
  useEffect(() => {
    if (quote?.quote_expires_at && quote.success) {
      const expires = new Date(quote.quote_expires_at).getTime();
      const update = () => {
        const remaining = Math.floor((expires - Date.now()) / 1000);
        setQuoteCountdown(remaining > 0 ? remaining : 0);
        if (remaining <= 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      };
      update();
      countdownRef.current = setInterval(update, 1000);
      return () => {
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      };
    }
  }, [quote?.quote_expires_at, quote?.success]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPlan();
  };

  const canEdit = plan?.status === 'draft';
  const isFixedSource = plan?.pricing_mode === 'fixed_source';
  const destCurrency = plan?.destination_currency || '';

  // Budget tracking for fixed_source mode
  const budget = Number(plan?.source_amount) || 0;
  const totalAllocated = plan?.commitments.reduce(
    (sum, c) => sum + (Number(c.amount_gbp) || 0), 0
  ) ?? 0;
  const remaining = Math.max(0, budget - totalAllocated);

  // =======================================================
  // ADD COMMITMENT — no FX calculation, only user-entered amount
  // =======================================================

  const handleAddCommitment = async () => {
    if (!selectedRecipientId) {
      setCommitmentError('Please select a recipient');
      return;
    }
    const amount = parseFloat(commitmentAmount);
    if (!amount || amount <= 0) {
      setCommitmentError('Please enter a valid amount');
      return;
    }

    const recipient = recipients.find((r) => r.id === selectedRecipientId);
    if (!recipient) return;

    if (recipient.verification_status !== 'verified' || !recipient.flutterwave_recipient_id) {
      setCommitmentError(
        'This recipient needs attention before a payout can be made. Please update the recipient details.'
      );
      return;
    }

    // Enforce same corridor
    if (plan?.destination_country && recipient.country !== plan.destination_country) {
      setCommitmentError(
        `This recipient is in ${recipient.country}, but this plan is for ${plan.destination_country}. All recipients must be in the same country.`
      );
      return;
    }

    // Budget check for fixed_source
    if (isFixedSource && budget > 0) {
      if (amount > remaining + 0.01) {
        setCommitmentError(
          `This exceeds your remaining budget of ${formatGBP(remaining)}. Please enter a smaller amount.`
        );
        return;
      }
    }

    setAdding(true);
    setCommitmentError(null);
    try {
      await addCommitment({
        plan_id: id,
        recipient_id: selectedRecipientId,
        amount_gbp: isFixedSource ? amount : 0,
        destination_currency: destCurrency,
        receiving_method: recipient.receiving_method,
        amount_destination: isFixedSource ? 0 : amount,
        fx_rate: 0,
      });
      await recalcPlanTotals(id);
      setShowAddCommitment(false);
      setSelectedRecipientId(null);
      setCommitmentAmount('');
      await loadPlan();
    } catch (e: any) {
      setCommitmentError(e.message || 'Failed to add commitment');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteCommitment = (commitmentId: string) => {
    Alert.alert(
      'Remove recipient',
      'Remove this recipient from the plan?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteCommitment(commitmentId);
            await recalcPlanTotals(id);
            await loadPlan();
          },
        },
      ]
    );
  };

  // =======================================================
  // QUOTE FLOW — uses pricing_mode from plan, no re-asking
  // =======================================================

  const handleGetQuote = async () => {
    if (!plan || plan.commitments.length === 0) return;
    setShowQuoteModal(true);
    setQuoteError(null);
    setQuote(null);
    setQuoteCountdown(null);
  };

  const handleCreateQuote = async () => {
    if (!plan) return;
    setQuoteLoading(true);
    setQuoteError(null);

    try {
      const destCountry = plan.destination_country || plan.commitments[0]?.recipient?.country || '';
      const dCurrency = plan.destination_currency || plan.commitments[0]?.destination_currency || '';
      const mode = plan.pricing_mode || 'fixed_source';

      if (!destCountry || !dCurrency) {
        setQuoteError('Could not determine destination country/currency.');
        setQuoteLoading(false);
        return;
      }

      const allocPayload = plan.commitments.map((c) => ({
        commitment_id: c.id,
        source_amount: mode === 'fixed_source' ? Number(c.amount_gbp) || 0 : undefined,
        destination_amount: mode === 'fixed_destination' ? Number(c.amount_destination) || 0 : undefined,
      }));

      const result = await createQuote({
        plan_id: id,
        pricing_mode: mode,
        destination_country: destCountry,
        destination_currency: dCurrency,
        allocations: allocPayload,
      });

      if (!result.success) {
        setQuoteError(result.error || 'Failed to create quote');
      } else {
        setQuote(result);
      }
    } catch (e: any) {
      setQuoteError(e.message || 'Failed to create quote');
    } finally {
      setQuoteLoading(false);
    }
  };

  // =======================================================
  // LOCK QUOTE + START PAYMENT
  // =======================================================

  const handleLockAndPay = async () => {
    if (!quote || !quote.success) return;

    if (quoteCountdown !== null && quoteCountdown <= 0) {
      setQuoteError('Quote has expired. Please get a new quote.');
      return;
    }

    setLocking(true);
    setQuoteError(null);

    try {
      const lockResult = await lockQuote(id);
      if (!lockResult.success) {
        setQuoteError(lockResult.error || 'Failed to lock quote');
        setLocking(false);
        return;
      }

      await createTransaction(id, Number(quote.customer_pays));

      setShowQuoteModal(false);
      setQuote(null);
      setQuoteCountdown(null);
      await loadPlan();

      const { data: txn } = await (await import('@/lib/supabase')).supabase
        .from('transactions')
        .select('id')
        .eq('plan_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (txn) {
        router.push(`/collect/${txn.id}`);
      }
    } catch (e: any) {
      setQuoteError(e.message || 'Failed to start payment');
    } finally {
      setLocking(false);
    }
  };

  // =======================================================
  // RELEASE PAYOUTS
  // =======================================================

  const handleReleasePayouts = async () => {
    if (!plan) return;
    setReleasingPayouts(true);
    setPayoutResult(null);
    try {
      const result = await releasePayouts(id);
      setPayoutResult({
        total: result.total,
        submitted: result.submitted,
        failed: result.failed,
        errors: result.errors,
      });
      await loadPlan();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to release payouts');
    } finally {
      setReleasingPayouts(false);
    }
  };

  // =======================================================
  // CONFIRM PAYOUTS
  // =======================================================

  const handleConfirmPayouts = async () => {
    if (!plan) return;
    setConfirmingPayouts(true);
    setPayoutResult(null);
    try {
      const result = await confirmPayouts(id);
      setPayoutResult({
        total: result.total,
        confirmed: result.confirmed,
        failed: result.failed,
        errors: result.errors,
      });
      await loadPlan();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to confirm payouts');
    } finally {
      setConfirmingPayouts(false);
    }
  };

  // =======================================================
  // RETRY FAILED PAYOUT
  // =======================================================

  const handleRetryPayout = async (commitmentId: string, method: PayoutMethod) => {
    setRetryingId(commitmentId);
    try {
      const result = await retryPayout(commitmentId, method);
      if (!result.success) {
        Alert.alert('Retry Failed', result.error || 'Could not retry this payout');
      } else {
        setShowRetryModal(false);
        await loadPlan();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to retry payout');
    } finally {
      setRetryingId(null);
    }
  };

  const openRetryModal = async (commitmentId: string) => {
    setRetryingId(commitmentId);
    setShowRetryModal(true);
    const destCountry = plan?.destination_country || '';
    const methods = await fetchSupportedPayoutMethods(destCountry);
    setSupportedMethods(methods);
    setRetryingId(null);
  };

  // =======================================================
  // CANCEL ORDER
  // =======================================================

  const handleCancelOrder = () => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order? This cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const result = await cancelOrder(id);
              if (!result.success) {
                Alert.alert('Cannot Cancel', result.error || 'This order cannot be cancelled');
              } else {
                await loadPlan();
              }
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to cancel order');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleDeletePlan = () => {
    Alert.alert(
      'Delete Plan',
      'Are you sure you want to delete this plan? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePlan(id);
            router.push('/(tabs)/plans');
          },
        },
      ]
    );
  };

  const handleReopenPlan = () => {
    Alert.alert(
      'Reopen Plan',
      'This will reset the plan to draft so you can edit recipients and get a new quote.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Reopen',
          onPress: async () => {
            try {
              await updatePlan(id, {
                status: 'draft',
                quote_created_at: null,
                quote_expires_at: null,
                quote_locked_at: null,
                customer_pays: 0,
                customer_fx_rate: 0,
                provider_fee: 0,
                payment_status: 'pending',
              });
              await loadPlan();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not reopen plan');
            }
          },
        },
      ]
    );
  };

  if (loading) return <Loading />;

  if (!plan) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        <EmptyState icon="❌" title="Plan not found" subtitle="This plan may have been deleted" />
      </View>
    );
  }

  const cancellableStates = ['draft', 'quoted', 'awaiting_payment', 'funded'];
  const canCancel = cancellableStates.includes(plan.status);

  // Filter recipients to same corridor
  const eligibleRecipients = recipients.filter((r) => {
    if (!plan.destination_country) return true;
    return r.country === plan.destination_country;
  });

  // Total destination amounts for fixed_destination summary
  const totalDestination = plan.commitments.reduce(
    (sum, c) => sum + (Number(c.amount_destination) || 0), 0
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <StatusBadge status={plan.status} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.titleSection}>
          <View style={styles.planIconLarge}>
            <TrendingUp color="#fff" size={24} strokeWidth={2} />
          </View>
          <Text style={styles.planName}>{plan.name}</Text>
          <View style={styles.planMetaRow}>
            <View style={styles.metaItem}>
              <Users color={Colors.neutral[400]} size={14} strokeWidth={2} />
              <Text style={styles.metaText}>
                {plan.total_recipients} recipient{plan.total_recipients !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Repeat color={Colors.neutral[400]} size={14} strokeWidth={2} />
              <Text style={styles.metaText}>{getRecurringLabel(plan.recurring)}</Text>
            </View>
            {plan.next_run_date && (
              <View style={styles.metaItem}>
                <Calendar color={Colors.neutral[400]} size={14} strokeWidth={2} />
                <Text style={styles.metaText}>{formatDate(plan.next_run_date)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* TOTAL CARD — adapts to pricing mode and plan status */}
        <View style={styles.totalCard}>
          {plan.status !== 'draft' && plan.customer_pays > 0 ? (
            <>
              <Text style={styles.totalLabel}>Customer Pays</Text>
              <Text style={styles.totalAmount}>{formatGBP(Number(plan.customer_pays))}</Text>
              {plan.destination_currency && plan.destination_amount > 0 && (
                <Text style={styles.totalSubtext}>
                  {formatCurrency(Number(plan.destination_amount), plan.destination_currency)} to {plan.destination_country}
                </Text>
              )}
              {plan.customer_fx_rate > 0 && (
                <Text style={styles.totalSubtext}>
                  Rate: 1 GBP = {plan.customer_fx_rate} {plan.destination_currency || ''}
                </Text>
              )}
            </>
          ) : isFixedSource ? (
            <>
              <Text style={styles.totalLabel}>Budget</Text>
              <Text style={styles.totalAmount}>{formatGBP(budget)}</Text>
              <View style={styles.budgetTrackerRow}>
                <View style={styles.budgetTrackerItem}>
                  <Text style={styles.budgetTrackerLabel}>Allocated</Text>
                  <Text style={styles.budgetTrackerValue}>{formatGBP(totalAllocated)}</Text>
                </View>
                <View style={styles.budgetTrackerDivider} />
                <View style={styles.budgetTrackerItem}>
                  <Text style={styles.budgetTrackerLabel}>Remaining</Text>
                  <Text style={[
                    styles.budgetTrackerValue,
                    remaining === 0 && totalAllocated > 0 && styles.budgetTrackerComplete,
                  ]}>
                    {formatGBP(remaining)}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.totalLabel}>Recipients receive</Text>
              <Text style={styles.totalAmount}>
                {totalDestination > 0
                  ? formatCurrency(totalDestination, destCurrency)
                  : `${destCurrency} 0`}
              </Text>
              <Text style={styles.totalSubtext}>
                Final GBP cost calculated at quote time
              </Text>
            </>
          )}
          {plan.payment_status && plan.payment_status !== 'pending' && (
            <View style={styles.paymentStatusRow}>
              <Text style={styles.paymentStatusLabel}>Payment: </Text>
              <Text style={styles.paymentStatusValue}>{plan.payment_status}</Text>
            </View>
          )}
        </View>

        {/* MODE INDICATOR */}
        {canEdit && (
          <View style={styles.modeIndicator}>
            <Text style={styles.modeIndicatorText}>
              {isFixedSource
                ? 'Budget mode — allocate your GBP budget between recipients'
                : `Recipient needs mode — set what each person receives in ${destCurrency}`}
            </Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recipients in this plan</Text>
          {canEdit && (
            <TouchableOpacity
              onPress={() => setShowAddCommitment(true)}
              style={styles.addBtn}
            >
              <Plus color={Colors.primary[600]} size={18} strokeWidth={2} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {plan.commitments.length === 0 ? (
          <Card style={styles.emptyCommitCard}>
            <Text style={styles.emptyCommitText}>
              No recipients added yet. Add recipients to this plan to start bundling transfers.
            </Text>
            {canEdit && (
              <Button
                onPress={() => setShowAddCommitment(true)}
                variant="outline"
                size="sm"
                style={styles.emptyAddBtn}
              >
                <Plus color={Colors.primary[600]} size={16} strokeWidth={2} /> Add Recipient
              </Button>
            )}
          </Card>
        ) : (
          plan.commitments.map((commitment: CommitmentWithRecipient) => {
            const Icon = methodIcons[commitment.receiving_method] ?? Smartphone;
            const recipient = commitment.recipient;
            const country = recipient
              ? COUNTRIES.find((c) => c.code === recipient.country)
              : null;
            const isFailed = commitment.status === 'failed';

            const showGbp = Number(commitment.amount_gbp) > 0;
            const showDest = Number(commitment.amount_destination) > 0;

            return (
              <Card key={commitment.id} style={styles.commitmentCard}>
                <View style={styles.commitmentHeader}>
                  <View style={styles.commitmentIconWrap}>
                    <Icon color={Colors.primary[600]} size={18} strokeWidth={2} />
                  </View>
                  <View style={styles.commitmentInfo}>
                    <Text style={styles.commitmentName}>
                      {recipient?.name || 'Unknown recipient'}
                    </Text>
                    <View style={styles.commitmentMeta}>
                      <Text style={styles.commitmentMetaText}>
                        {country ? `${country.flag} ${country.name}` : commitment.destination_currency}
                      </Text>
                      <Text style={styles.commitmentDot}>·</Text>
                      <Text style={styles.commitmentMetaText}>
                        {getReceivingMethodLabel(commitment.receiving_method)}
                      </Text>
                    </View>
                  </View>
                  {canEdit && (
                    <TouchableOpacity
                      onPress={() => handleDeleteCommitment(commitment.id)}
                      style={styles.deleteCommitBtn}
                    >
                      <Trash2 color={Colors.error[500]} size={16} strokeWidth={2} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.commitmentAmountRow}>
                  {isFixedSource ? (
                    <>
                      <View>
                        <Text style={styles.commitmentAmountLabel}>Allocation</Text>
                        <Text style={styles.commitmentAmountGbp}>
                          {formatGBP(Number(commitment.amount_gbp))}
                        </Text>
                      </View>
                      {showDest && commitment.fx_rate > 0 && (
                        <>
                          <View style={styles.commitmentArrow}>
                            <ChevronRight color={Colors.neutral[400]} size={16} strokeWidth={2} />
                          </View>
                          <View>
                            <Text style={styles.commitmentAmountLabel}>Recipient gets</Text>
                            <Text style={styles.commitmentAmountDest}>
                              {formatCurrency(Number(commitment.amount_destination), commitment.destination_currency)}
                            </Text>
                          </View>
                        </>
                      )}
                      {!showDest && (
                        <View>
                          <Text style={styles.commitmentAmountLabel}>Recipient gets</Text>
                          <Text style={styles.commitmentAmountDestPending}>
                            Calculated at quote
                          </Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <View>
                        <Text style={styles.commitmentAmountLabel}>Recipient gets</Text>
                        <Text style={styles.commitmentAmountDest}>
                          {formatCurrency(Number(commitment.amount_destination), commitment.destination_currency)}
                        </Text>
                      </View>
                      {showGbp && commitment.fx_rate > 0 && (
                        <>
                          <View style={styles.commitmentArrow}>
                            <ChevronRight color={Colors.neutral[400]} size={16} strokeWidth={2} />
                          </View>
                          <View>
                            <Text style={styles.commitmentAmountLabel}>Cost</Text>
                            <Text style={styles.commitmentAmountGbp}>
                              {formatGBP(Number(commitment.amount_gbp))}
                            </Text>
                          </View>
                        </>
                      )}
                      {!showGbp && (
                        <View>
                          <Text style={styles.commitmentAmountLabel}>GBP cost</Text>
                          <Text style={styles.commitmentAmountDestPending}>
                            Calculated at quote
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>

                {commitment.fx_rate > 0 && (
                  <View style={styles.fxRow}>
                    <Text style={styles.fxText}>
                      Rate: 1 GBP = {commitment.fx_rate} {commitment.destination_currency}
                    </Text>
                  </View>
                )}

                {commitment.status !== 'pending' && commitment.status !== 'ready' && (
                  <View style={styles.commitmentStatusRow}>
                    <StatusBadge status={commitment.status} />
                  </View>
                )}

                {isFailed && commitment.failure_reason_display && (
                  <View style={styles.failureBox}>
                    <AlertCircle color={Colors.error[600]} size={16} strokeWidth={2} />
                    <Text style={styles.failureText}>{commitment.failure_reason_display}</Text>
                  </View>
                )}

                {isFailed && (plan.status === 'partially_failed' || plan.status === 'failed') && (
                  <TouchableOpacity
                    onPress={() => openRetryModal(commitment.id)}
                    style={styles.retryBtn}
                  >
                    <RefreshCw color={Colors.primary[600]} size={14} strokeWidth={2} />
                    <Text style={styles.retryBtnText}>Try another payout method</Text>
                  </TouchableOpacity>
                )}
              </Card>
            );
          })
        )}

        {payoutResult && (
          <View style={styles.sendResultCard}>
            <Text style={styles.sendResultTitle}>Payout Results</Text>
            {payoutResult.submitted !== undefined && (
              <Text style={styles.sendResultText}>
                {payoutResult.submitted} submitted, {payoutResult.failed} failed
              </Text>
            )}
            {payoutResult.confirmed !== undefined && (
              <Text style={styles.sendResultText}>
                {payoutResult.confirmed} confirmed, {payoutResult.failed} failed
              </Text>
            )}
            {payoutResult.errors?.map((err, i) => (
              <Text key={i} style={styles.sendResultError}>{err}</Text>
            ))}
          </View>
        )}

        {!profile?.flutterwave_sender_id && plan.status !== 'draft' && (
          <TouchableOpacity onPress={() => router.push('/kyc')} style={styles.kycBanner}>
            <ShieldAlert color={Colors.warning[600]} size={20} strokeWidth={2} />
            <View style={styles.kycBannerText}>
              <Text style={styles.kycBannerTitle}>Identity verification required</Text>
              <Text style={styles.kycBannerSubtext}>
                Complete your KYC in Settings to enable transfers
              </Text>
            </View>
            <ChevronRight color={Colors.warning[600]} size={18} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* DRAFT: Get Quote button */}
        {canEdit && plan.commitments.length > 0 && (
          <Button onPress={handleGetQuote} style={styles.confirmBtn}>
            <CheckCircle2 color="#fff" size={20} strokeWidth={2} />
            {'  '}Get Quote
          </Button>
        )}

        {plan.status === 'awaiting_payment' && (
          <View style={styles.statusInfoBox}>
            <Clock color={Colors.warning[600]} size={20} strokeWidth={2} />
            <Text style={styles.statusInfoText}>
              Payment is awaiting processing. Complete your payment to fund this order.
            </Text>
          </View>
        )}

        {plan.status === 'payment_processing' && (
          <View style={styles.statusInfoBox}>
            <Clock color={Colors.primary[600]} size={20} strokeWidth={2} />
            <Text style={styles.statusInfoText}>
              Your payment is being processed. You will be able to release payouts once payment is verified.
            </Text>
          </View>
        )}

        {plan.status === 'payment_failed' && (
          <View style={styles.statusInfoBox}>
            <XCircle color={Colors.error[600]} size={20} strokeWidth={2} />
            <Text style={styles.statusInfoText}>
              Your payment could not be verified. No payouts have been released. Please try again.
            </Text>
          </View>
        )}

        {plan.status === 'funded' && (
          <Button onPress={handleReleasePayouts} loading={releasingPayouts} style={styles.confirmBtn}>
            <Send color="#fff" size={20} strokeWidth={2} />
            {'  '}Release Payouts
          </Button>
        )}

        {plan.status === 'payouts_processing' && (
          <Button onPress={handleConfirmPayouts} loading={confirmingPayouts} style={styles.sendBtn}>
            <Send color="#fff" size={20} strokeWidth={2} />
            {'  '}Confirm Payouts
          </Button>
        )}

        {plan.status === 'partially_failed' && (
          <View style={styles.partialFailBox}>
            <Text style={styles.partialFailTitle}>Some payouts could not be completed</Text>
            <Text style={styles.partialFailText}>
              You can retry failed payouts using a different method, or contact Senda support for a refund.
            </Text>
          </View>
        )}

        {canCancel && plan.status !== 'draft' && (
          <TouchableOpacity
            onPress={handleCancelOrder}
            style={styles.deletePlanBtn}
            disabled={cancelling}
          >
            <XCircle color={Colors.error[500]} size={16} strokeWidth={2} />
            <Text style={styles.deletePlanText}>{cancelling ? 'Cancelling...' : 'Cancel Order'}</Text>
          </TouchableOpacity>
        )}

        {plan.status === 'cancelled' && (
          <Button onPress={handleReopenPlan} variant="outline" style={styles.confirmBtn}>
            Reopen Plan
          </Button>
        )}

        {canEdit && (
          <TouchableOpacity onPress={handleDeletePlan} style={styles.deletePlanBtn}>
            <Trash2 color={Colors.error[500]} size={16} strokeWidth={2} />
            <Text style={styles.deletePlanText}>Delete Plan</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      {/* =====================================================
          QUOTE MODAL — reads pricing_mode from plan, no re-asking
          ===================================================== */}
      <Modal
        visible={showQuoteModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQuoteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Get Quote</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowQuoteModal(false);
                  setQuote(null);
                  setQuoteError(null);
                  setQuoteCountdown(null);
                }}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              {/* Pre-quote summary — show what will be quoted */}
              {!quote?.success && (
                <>
                  <View style={styles.quotePreSummary}>
                    <Text style={styles.quotePreTitle}>
                      {isFixedSource ? 'Budget allocation' : 'Recipient amounts'}
                    </Text>
                    {plan.commitments.map((c) => (
                      <View key={c.id} style={styles.quotePreRow}>
                        <Text style={styles.quotePreName}>{c.recipient?.name || 'Unknown'}</Text>
                        <Text style={styles.quotePreAmount}>
                          {isFixedSource
                            ? formatGBP(Number(c.amount_gbp))
                            : formatCurrency(Number(c.amount_destination), destCurrency)}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.quotePreTotalRow}>
                      <Text style={styles.quotePreTotalLabel}>Total</Text>
                      <Text style={styles.quotePreTotalValue}>
                        {isFixedSource
                          ? formatGBP(totalAllocated)
                          : formatCurrency(totalDestination, destCurrency)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.quotePreHint}>
                    {isFixedSource
                      ? 'The quote will calculate how much each recipient receives after fees and exchange rate.'
                      : 'The quote will calculate the total GBP you need to pay including fees and exchange rate.'}
                  </Text>

                  {quoteError && (
                    <Text style={styles.commitmentErrorText}>{quoteError}</Text>
                  )}

                  <Button
                    onPress={handleCreateQuote}
                    loading={quoteLoading}
                    style={styles.modalAddBtn}
                  >
                    Get Quote
                  </Button>
                </>
              )}

              {/* Quote result display */}
              {quote?.success && (
                <View style={styles.quoteDisplay}>
                  <View style={styles.quoteHeader}>
                    <Text style={styles.quoteTitle}>Your Quote</Text>
                    {quoteCountdown !== null && (
                      <View style={[
                        styles.countdownBadge,
                        quoteCountdown <= 10 && styles.countdownUrgent,
                      ]}>
                        <Clock color="#fff" size={12} strokeWidth={2} />
                        <Text style={styles.countdownText}>{quoteCountdown}s</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.quoteRow}>
                    <Text style={styles.quoteLabel}>You pay</Text>
                    <Text style={styles.quoteValue}>{formatGBP(Number(quote.customer_pays))}</Text>
                  </View>
                  <View style={styles.quoteRow}>
                    <Text style={styles.quoteLabel}>Exchange rate</Text>
                    <Text style={styles.quoteValueSmall}>
                      1 GBP = {quote.customer_fx_rate} {quote.destination_currency}
                    </Text>
                  </View>
                  <View style={styles.quoteRow}>
                    <Text style={styles.quoteLabel}>Fee</Text>
                    <Text style={styles.quoteValueSmall}>{formatGBP(Number(quote.provider_fee))}</Text>
                  </View>

                  <View style={styles.quoteDivider} />

                  <Text style={styles.modalLabel}>Recipient breakdown</Text>
                  {quote.recipients.map((r) => (
                    <View key={r.commitment_id} style={styles.quoteRecipientRow}>
                      <Text style={styles.quoteRecipientName}>{r.recipient_name}</Text>
                      <View style={styles.quoteRecipientAmounts}>
                        <Text style={styles.quoteRecipientGbp}>{formatGBP(r.source_amount)}</Text>
                        <ChevronRight color={Colors.neutral[400]} size={12} strokeWidth={2} />
                        <Text style={styles.quoteRecipientDest}>
                          {formatCurrency(r.destination_amount, quote.destination_currency)}
                        </Text>
                      </View>
                    </View>
                  ))}

                  {quoteCountdown === 0 && (
                    <View style={styles.expiredBox}>
                      <AlertCircle color={Colors.error[600]} size={16} strokeWidth={2} />
                      <Text style={styles.expiredText}>Quote expired. Get a new quote to continue.</Text>
                    </View>
                  )}

                  {quoteError && (
                    <Text style={styles.commitmentErrorText}>{quoteError}</Text>
                  )}

                  {quoteCountdown !== null && quoteCountdown > 0 ? (
                    <Button
                      onPress={handleLockAndPay}
                      loading={locking}
                      style={styles.modalAddBtn}
                    >
                      <Send color="#fff" size={18} strokeWidth={2} />
                      {'  '}Lock & Pay {formatGBP(Number(quote.customer_pays))}
                    </Button>
                  ) : (
                    <Button
                      onPress={handleCreateQuote}
                      loading={quoteLoading}
                      style={styles.modalAddBtn}
                      variant="outline"
                    >
                      <RefreshCw color={Colors.primary[600]} size={18} strokeWidth={2} />
                      {'  '}Get New Quote
                    </Button>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* =====================================================
          ADD COMMITMENT MODAL — respects pricing_mode
          ===================================================== */}
      <Modal
        visible={showAddCommitment}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddCommitment(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Recipient to Plan</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAddCommitment(false);
                  setSelectedRecipientId(null);
                  setCommitmentAmount('');
                  setCommitmentError(null);
                }}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            {eligibleRecipients.length === 0 ? (
              <View style={styles.modalEmptyState}>
                <Text style={styles.modalEmptyText}>
                  {recipients.length === 0
                    ? "You don't have any recipients yet. Add a recipient first."
                    : `No recipients found for ${plan.destination_country}. Add a recipient in this country first.`}
                </Text>
                <Button
                  onPress={() => {
                    const q = new URLSearchParams({
                      plan_id: id,
                      destination_country: plan.destination_country ?? '',
                      destination_currency: plan.destination_currency ?? '',
                    }).toString();
                    router.push(`/recipient/new?${q}`);
                  }}
                  size="sm"
                  style={styles.modalAddRecipBtn}
                >
                  <Plus color="#fff" size={16} strokeWidth={2} /> Add Recipient
                </Button>
              </View>
            ) : (
              <ScrollView style={styles.modalScroll}>
                {/* Budget tracker in modal for fixed_source */}
                {isFixedSource && budget > 0 && (
                  <View style={styles.modalBudgetTracker}>
                    <View style={styles.modalBudgetRow}>
                      <Text style={styles.modalBudgetLabel}>Budget</Text>
                      <Text style={styles.modalBudgetValue}>{formatGBP(budget)}</Text>
                    </View>
                    <View style={styles.modalBudgetRow}>
                      <Text style={styles.modalBudgetLabel}>Already allocated</Text>
                      <Text style={styles.modalBudgetValue}>{formatGBP(totalAllocated)}</Text>
                    </View>
                    <View style={styles.modalBudgetRow}>
                      <Text style={[styles.modalBudgetLabel, { fontFamily: 'Inter-SemiBold' }]}>Available</Text>
                      <Text style={[styles.modalBudgetValue, { fontFamily: 'Inter-Bold', color: Colors.primary[700] }]}>
                        {formatGBP(remaining)}
                      </Text>
                    </View>
                  </View>
                )}

                <Text style={styles.modalLabel}>Select recipient</Text>
                {eligibleRecipients.map((r) => {
                  const country = COUNTRIES.find((c) => c.code === r.country);
                  const isSelected = selectedRecipientId === r.id;
                  const alreadyAdded = plan.commitments.some((c) => c.recipient_id === r.id);
                  const needsAttention = r.verification_status === 'needs_attention';
                  const isDisabled = alreadyAdded || needsAttention;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => {
                        if (needsAttention) {
                          router.push(`/recipient/${r.id}`);
                          return;
                        }
                        if (!alreadyAdded) setSelectedRecipientId(r.id);
                      }}
                      disabled={alreadyAdded}
                      style={[
                        styles.recipientPickerItem,
                        isSelected && styles.recipientPickerSelected,
                        isDisabled && styles.recipientPickerDisabled,
                      ]}
                    >
                      <View style={styles.recipientPickerInfo}>
                        <Text style={styles.recipientPickerName}>
                          {r.name}{alreadyAdded ? ' (already added)' : ''}
                        </Text>
                        <Text style={styles.recipientPickerMeta}>
                          {country ? `${country.flag} ${country.name}` : r.country} · {getReceivingMethodLabel(r.receiving_method)}
                        </Text>
                        {needsAttention && (
                          <Text style={[styles.recipientPickerMeta, { color: Colors.error[600] }]}>
                            Needs attention · Update recipient details before using this recipient.
                          </Text>
                        )}
                      </View>
                      {isSelected && (
                        <CheckCircle2 color={Colors.primary[600]} size={20} strokeWidth={2} />
                      )}
                    </TouchableOpacity>
                  );
                })}

                <Text style={[styles.modalLabel, { marginTop: Spacing.md }]}>
                  {isFixedSource
                    ? 'Amount in GBP'
                    : `Amount in ${destCurrency}`}
                </Text>
                <View style={styles.amountInputWrap}>
                  <Text style={styles.amountPrefix}>
                    {isFixedSource ? '£' : `${destCurrency} `}
                  </Text>
                  <TextInput
                    style={styles.amountInput}
                    value={commitmentAmount}
                    onChangeText={setCommitmentAmount}
                    placeholder="0.00"
                    placeholderTextColor={Colors.neutral[400]}
                    keyboardType="numeric"
                  />
                </View>

                {commitmentError && (
                  <Text style={styles.commitmentErrorText}>{commitmentError}</Text>
                )}

                <Button
                  onPress={handleAddCommitment}
                  loading={adding}
                  style={styles.modalAddBtn}
                >
                  Add to Plan
                </Button>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* RETRY PAYOUT MODAL */}
      <Modal
        visible={showRetryModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRetryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Try Another Payout Method</Text>
              <TouchableOpacity onPress={() => setShowRetryModal(false)}>
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalLabel}>
                Select a different payout method for this recipient. Only methods supported for this corridor are shown.
              </Text>

              {supportedMethods.length === 0 && (
                <Text style={styles.commitmentErrorText}>
                  No alternative payout methods are supported for this corridor. Please contact Senda support for a refund.
                </Text>
              )}

              {supportedMethods.map((method) => {
                const Icon = method === 'bank' ? Building2 : method === 'mobile_money' ? Smartphone : Wallet;
                return (
                  <TouchableOpacity
                    key={method}
                    onPress={() => retryingId && handleRetryPayout(retryingId, method)}
                    style={styles.retryMethodItem}
                    disabled={!!retryingId}
                  >
                    <Icon color={Colors.primary[600]} size={20} strokeWidth={2} />
                    <Text style={styles.retryMethodName}>
                      {method === 'bank' ? 'Bank Account' : method === 'mobile_money' ? 'Mobile Money' : 'Cash Pickup'}
                    </Text>
                    <ChevronRight color={Colors.neutral[400]} size={16} strokeWidth={2} />
                  </TouchableOpacity>
                );
              })}

              <View style={styles.contactSupportBox}>
                <Text style={styles.contactSupportText}>
                  For unresolved cases, contact Senda support for a refund.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.neutral[50],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.neutral[900],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
  },
  titleSection: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  planIconLarge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  planName: {
    ...Typography.h2,
    color: Colors.neutral[900],
    textAlign: 'center',
  },
  planMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    ...Typography.caption,
    color: Colors.neutral[500],
  },
  totalCard: {
    backgroundColor: Colors.primary[600],
    borderRadius: 20,
    padding: Spacing.lg,
    alignItems: 'center',
    marginVertical: Spacing.md,
    shadowColor: Colors.primary[900],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  } as ViewStyle,
  totalLabel: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.8)',
  },
  totalAmount: {
    fontSize: 36,
    fontFamily: 'Inter-Bold',
    color: '#fff',
    marginTop: 4,
  },
  totalSubtext: {
    ...Typography.small,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  budgetTrackerRow: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
    gap: Spacing.md,
    alignItems: 'center',
  },
  budgetTrackerItem: {
    alignItems: 'center',
  },
  budgetTrackerLabel: {
    ...Typography.small,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  budgetTrackerValue: {
    ...Typography.bodyMedium,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  budgetTrackerComplete: {
    color: '#a7f3d0',
  },
  budgetTrackerDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  paymentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  paymentStatusLabel: {
    ...Typography.small,
    color: 'rgba(255,255,255,0.7)',
  },
  paymentStatusValue: {
    ...Typography.small,
    color: '#fff',
    fontFamily: 'Inter-SemiBold',
  },
  modeIndicator: {
    backgroundColor: Colors.neutral[100],
    borderRadius: 10,
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  } as ViewStyle,
  modeIndicatorText: {
    ...Typography.small,
    color: Colors.neutral[600],
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.neutral[900],
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addBtnText: {
    ...Typography.label,
    color: Colors.primary[600],
  },
  emptyCommitCard: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyCommitText: {
    ...Typography.body,
    color: Colors.neutral[500],
    textAlign: 'center',
    lineHeight: 24,
  },
  emptyAddBtn: {
    marginTop: Spacing.md,
  },
  commitmentCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  } as ViewStyle,
  commitmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  commitmentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  commitmentInfo: {
    flex: 1,
  },
  commitmentName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
    fontSize: 17,
  },
  commitmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  commitmentMetaText: {
    ...Typography.small,
    color: Colors.neutral[500],
  },
  commitmentDot: {
    ...Typography.small,
    color: Colors.neutral[400],
  },
  deleteCommitBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commitmentAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.neutral[200],
  },
  commitmentAmountLabel: {
    ...Typography.small,
    color: Colors.neutral[500],
  },
  commitmentAmountGbp: {
    ...Typography.h3,
    color: Colors.neutral[900],
    marginTop: 2,
  },
  commitmentArrow: {
    paddingHorizontal: Spacing.sm,
  },
  commitmentAmountDest: {
    ...Typography.h3,
    color: Colors.neutral[700],
    marginTop: 2,
  },
  commitmentAmountDestPending: {
    ...Typography.body,
    color: Colors.neutral[400],
    fontStyle: 'italic',
    marginTop: 2,
  },
  fxRow: {
    marginTop: Spacing.sm,
  },
  fxText: {
    ...Typography.small,
    color: Colors.neutral[500],
    fontFamily: 'Inter-Medium',
  },
  commitmentStatusRow: {
    marginTop: Spacing.sm,
  },
  failureBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.error[50],
    borderRadius: 10,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  } as ViewStyle,
  failureText: {
    ...Typography.small,
    color: Colors.error[700],
    flex: 1,
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.primary[50],
    borderRadius: 10,
    alignSelf: 'flex-start',
  } as ViewStyle,
  retryBtnText: {
    ...Typography.small,
    color: Colors.primary[700],
    fontFamily: 'Inter-SemiBold',
  },
  confirmBtn: {
    marginTop: Spacing.lg,
    width: '100%',
  },
  sendBtn: {
    marginTop: Spacing.sm,
    width: '100%',
    backgroundColor: Colors.secondary[600],
  } as ViewStyle,
  statusInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.neutral[100],
    borderRadius: 14,
    padding: Spacing.md,
    marginTop: Spacing.md,
  } as ViewStyle,
  statusInfoText: {
    ...Typography.body,
    color: Colors.neutral[700],
    flex: 1,
  },
  partialFailBox: {
    backgroundColor: Colors.warning[50],
    borderWidth: 1,
    borderColor: Colors.warning[100],
    borderRadius: 14,
    padding: Spacing.md,
    marginTop: Spacing.md,
  } as ViewStyle,
  partialFailTitle: {
    ...Typography.bodyMedium,
    color: Colors.warning[700],
    marginBottom: Spacing.xs,
  },
  partialFailText: {
    ...Typography.small,
    color: Colors.warning[600],
    lineHeight: 20,
  },
  sendResultCard: {
    backgroundColor: Colors.neutral[100],
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.md,
  } as ViewStyle,
  sendResultTitle: {
    ...Typography.label,
    color: Colors.neutral[900],
    marginBottom: Spacing.xs,
  },
  sendResultText: {
    ...Typography.body,
    color: Colors.neutral[700],
    marginBottom: Spacing.xs,
  },
  sendResultError: {
    ...Typography.small,
    color: Colors.error[600],
    marginTop: 2,
  },
  kycBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warning[50],
    borderWidth: 1,
    borderColor: Colors.warning[100],
    borderRadius: 14,
    padding: Spacing.md,
    marginTop: Spacing.md,
  } as ViewStyle,
  kycBannerText: {
    flex: 1,
  },
  kycBannerTitle: {
    ...Typography.bodyMedium,
    color: Colors.warning[700],
  },
  kycBannerSubtext: {
    ...Typography.small,
    color: Colors.warning[600],
    marginTop: 2,
  },
  deletePlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.lg,
    paddingVertical: 14,
  },
  deletePlanText: {
    ...Typography.bodyMedium,
    color: Colors.error[600],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  modalCloseText: {
    ...Typography.body,
    color: Colors.primary[600],
  },
  modalEmptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  modalEmptyText: {
    ...Typography.body,
    color: Colors.neutral[500],
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  modalAddRecipBtn: {
    paddingHorizontal: Spacing.xl,
  },
  modalScroll: {
    maxHeight: 500,
  },
  modalLabel: {
    ...Typography.label,
    color: Colors.neutral[700],
    marginBottom: Spacing.sm,
  },
  modalBudgetTracker: {
    backgroundColor: Colors.primary[50],
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  } as ViewStyle,
  modalBudgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalBudgetLabel: {
    ...Typography.body,
    color: Colors.neutral[700],
  },
  modalBudgetValue: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  recipientPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  recipientPickerSelected: {
    borderColor: Colors.primary[600],
    backgroundColor: Colors.primary[50],
  },
  recipientPickerDisabled: {
    opacity: 0.5,
  },
  recipientPickerInfo: {
    flex: 1,
  },
  recipientPickerName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  recipientPickerMeta: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  amountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.neutral[50],
    marginBottom: Spacing.sm,
  },
  amountPrefix: {
    fontSize: 20,
    fontFamily: 'Inter-SemiBold',
    color: Colors.neutral[700],
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xs,
    fontSize: 20,
    fontFamily: 'Inter-SemiBold',
    color: Colors.neutral[900],
  },
  commitmentErrorText: {
    ...Typography.caption,
    color: Colors.error[600],
    marginBottom: Spacing.sm,
  },
  modalAddBtn: {
    marginTop: Spacing.md,
    width: '100%',
  },
  // Quote pre-summary
  quotePreSummary: {
    backgroundColor: Colors.neutral[50],
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  } as ViewStyle,
  quotePreTitle: {
    ...Typography.label,
    color: Colors.neutral[700],
    marginBottom: Spacing.sm,
  },
  quotePreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.neutral[200],
  },
  quotePreName: {
    ...Typography.body,
    color: Colors.neutral[900],
  },
  quotePreAmount: {
    ...Typography.bodyMedium,
    color: Colors.neutral[800],
  },
  quotePreTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginTop: 4,
  },
  quotePreTotalLabel: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  quotePreTotalValue: {
    ...Typography.h3,
    color: Colors.neutral[900],
  },
  quotePreHint: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  // Quote display
  quoteDisplay: {
    marginTop: Spacing.sm,
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  quoteTitle: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary[600],
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  } as ViewStyle,
  countdownUrgent: {
    backgroundColor: Colors.error[600],
  },
  countdownText: {
    ...Typography.small,
    color: '#fff',
    fontFamily: 'Inter-SemiBold',
  },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  quoteLabel: {
    ...Typography.body,
    color: Colors.neutral[600],
  },
  quoteValue: {
    ...Typography.h3,
    color: Colors.neutral[900],
  },
  quoteValueSmall: {
    ...Typography.body,
    color: Colors.neutral[700],
    fontFamily: 'Inter-Medium',
  },
  quoteDivider: {
    height: 1,
    backgroundColor: Colors.neutral[200],
    marginVertical: Spacing.md,
  },
  quoteRecipientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.neutral[100],
  },
  quoteRecipientName: {
    ...Typography.body,
    color: Colors.neutral[900],
  },
  quoteRecipientAmounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quoteRecipientGbp: {
    ...Typography.bodyMedium,
    color: Colors.neutral[700],
  },
  quoteRecipientDest: {
    ...Typography.bodyMedium,
    color: Colors.primary[700],
  },
  expiredBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.error[50],
    borderRadius: 10,
    padding: Spacing.sm,
    marginTop: Spacing.md,
  } as ViewStyle,
  expiredText: {
    ...Typography.small,
    color: Colors.error[700],
    flex: 1,
  },
  retryMethodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 16,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    marginBottom: Spacing.sm,
  } as ViewStyle,
  retryMethodName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
    flex: 1,
  },
  contactSupportBox: {
    backgroundColor: Colors.neutral[100],
    borderRadius: 10,
    padding: Spacing.md,
    marginTop: Spacing.md,
  } as ViewStyle,
  contactSupportText: {
    ...Typography.small,
    color: Colors.neutral[600],
    textAlign: 'center',
  },
});
