import { useState, useEffect, useCallback } from 'react';
import {
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AlertCircle, ArrowLeft, CheckCircle2, CreditCard, Loader, Lock } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { createFincraCheckout, formatGBP, verifyFincraCheckout } from '@/lib/data';
import { supabase } from '@/lib/supabase';

type PaymentState = 'idle' | 'processing' | 'succeeded' | 'failed';

export default function CollectScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const [planId, setPlanId] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState(0);
  const [amount, setAmount] = useState(0);
  const [processingFee, setProcessingFee] = useState(0);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [checkoutReference, setCheckoutReference] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');

  useEffect(() => {
    let cancelled = false;
    const loadTransaction = async () => {
      if (!transactionId) {
        setError('Missing transaction ID');
        setLoading(false);
        return;
      }

      try {
        const { data, error: transactionError } = await supabase
          .from('transactions')
          .select('*, plan:plans(*)')
          .eq('id', transactionId)
          .maybeSingle();

        if (cancelled) return;
        if (transactionError || !data) {
          setError('Transaction not found');
          return;
        }

        setPlanId(data.plan_id);
        setSendAmount(Number(data.plan?.total_gbp) || 0);
        setAmount(Number(data.amount_gbp) || 0);
        setProcessingFee(Number(data.plan?.processing_fee) || 0);
        setPaymentReference(data.payment_reference ?? null);

        const reference = data.fincra_checkout_reference ?? data.fincra_collection_reference ?? null;
        if (data.plan?.payment_status === 'successful' || data.status === 'successful') {
          setPaymentState('succeeded');
        } else if (reference) {
          setCheckoutReference(reference);
          setPaymentState('processing');
        } else if (data.status === 'failed' || data.plan?.payment_status === 'failed') {
          setPaymentState('failed');
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load transaction');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadTransaction();
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const checkPaymentStatus = useCallback(async () => {
    if (!checkoutReference) return;
    try {
      const result = await verifyFincraCheckout(checkoutReference);
      if (!result.success || !result.verified) {
        if (result.reason === 'amount_or_currency_mismatch') {
          setError('The provider payment details do not match this transfer. Do not try to pay again; contact support.');
        } else if (result.reason === 'invalid_plan_state') {
          setError('This payment needs support review before it can be confirmed. Do not pay again.');
        }
        return;
      }

      if (result.status === 'successful') {
        setError(null);
        setPaymentState('succeeded');
      } else if (result.status === 'failed' || result.status === 'reversed') {
        setError('The payment provider confirmed that this payment did not complete. You can try again.');
        setCheckoutUrl(null);
        setPaymentState('failed');
      }
    } catch (statusError) {
      console.warn('Fincra payment status check will be retried:', statusError);
    }
  }, [checkoutReference]);

  useEffect(() => {
    if (paymentState !== 'processing' || !checkoutReference) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const checkAndSchedule = async () => {
      await checkPaymentStatus();
      if (!cancelled) timer = setTimeout(checkAndSchedule, 10000);
    };
    void checkAndSchedule();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkPaymentStatus();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [paymentState, checkoutReference, checkPaymentStatus]);

  const openCheckout = useCallback(async (url: string) => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
        if (!newWindow) {
          setError('Your browser blocked the secure checkout window. Allow pop-ups and select “Open secure checkout” again.');
        }
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      void checkPaymentStatus();
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open the secure checkout page');
    }
  }, [checkPaymentStatus]);

  const handlePay = async () => {
    if (!planId) {
      setError('This transaction is missing its transfer plan. Return to the plan and try again.');
      return;
    }

    setError(null);
    setSubmitting(true);
    setPaymentState('processing');
    const fallbackReference = paymentReference ? `senda-${paymentReference}` : null;
    if (fallbackReference) setCheckoutReference(fallbackReference);

    try {
      const result = await createFincraCheckout(planId);
      const reference = result.reference ?? fallbackReference;
      if (reference) setCheckoutReference(reference);

      if (!result.success) {
        const definitiveErrorCodes = [
          'QUOTE_EXPIRED',
          'INVALID_PLAN_PAYMENT_STATE',
          'TRANSACTION_AMOUNT_MISMATCH',
          'CUSTOMER_EMAIL_REQUIRED',
        ];
        if (result.error_code && definitiveErrorCodes.includes(result.error_code)) {
          setError(result.error ?? 'Could not start checkout');
          setPaymentState('failed');
          return;
        }
        setError('We could not confirm whether checkout started. Senda is checking the payment status; do not start another payment.');
        if (!reference) setPaymentState('failed');
        return;
      }

      if (!result.checkoutUrl) {
        setError(result.error ?? 'Secure checkout is being prepared. Please wait while Senda checks its status.');
        return;
      }

      setCheckoutUrl(result.checkoutUrl);
      await openCheckout(result.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error
        ? `${checkoutError.message}. If checkout may have opened, do not pay again while Senda checks its status.`
        : 'Checkout status is uncertain. Do not start another payment while Senda checks its status.');
      if (!fallbackReference) setPaymentState('failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pay for your transfer</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {paymentState === 'succeeded' ? (
          <View style={styles.resultContainer}>
            <CheckCircle2 color={Colors.success[500]} size={64} strokeWidth={1.5} />
            <Text style={styles.resultTitle}>Payment received</Text>
            <Text style={styles.resultDesc}>
              Your payment has been confirmed. We’re preparing the next steps for your transfer.
            </Text>
            <Button onPress={() => router.replace(planId ? `/plan/${planId}` : '/(tabs)')} style={styles.actionBtn}>
              <Text style={styles.btnText}>Done</Text>
            </Button>
          </View>
        ) : paymentState === 'processing' ? (
          <View style={styles.resultContainer}>
            <Loader color={Colors.primary[600]} size={56} strokeWidth={1.5} />
            <Text style={styles.resultTitle}>Confirming your payment</Text>
            <Text style={styles.resultDesc}>
              {error ?? 'We are checking your payment directly with the provider. Please do not pay again.'}
            </Text>
            {checkoutUrl && (
              <Button onPress={() => void openCheckout(checkoutUrl)} style={styles.actionBtn}>
                <Text style={styles.btnText}>Open secure checkout</Text>
              </Button>
            )}
            <Button onPress={() => void checkPaymentStatus()} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Check payment status</Text>
            </Button>
          </View>
        ) : paymentState === 'failed' ? (
          <View style={styles.resultContainer}>
            <AlertCircle color={Colors.error[500]} size={64} strokeWidth={1.5} />
            <Text style={styles.resultTitle}>Payment not completed</Text>
            <Text style={styles.resultDesc}>{error ?? 'Your payment could not be processed. Please try again.'}</Text>
            {error?.includes('Do not pay again') ? (
              <Button onPress={() => router.replace(planId ? `/plan/${planId}` : '/(tabs)')} style={styles.actionBtn}>
                <Text style={styles.btnText}>Return to transfer</Text>
              </Button>
            ) : (
              <Button onPress={() => void handlePay()} style={styles.actionBtn} disabled={submitting}>
                <Text style={styles.btnText}>{submitting ? 'Starting checkout...' : 'Try again'}</Text>
              </Button>
            )}
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.amountCard}>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>You send</Text>
                <Text style={styles.amountRowValue}>{formatGBP(sendAmount)}</Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Processing fee</Text>
                <Text style={styles.amountRowValue}>{formatGBP(processingFee)}</Text>
              </View>
              <View style={[styles.amountRow, styles.amountTotalRow]}>
                <Text style={styles.amountTotalLabel}>Total</Text>
                <Text style={styles.amountValue}>{formatGBP(amount)}</Text>
              </View>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.sectionLabel}>
              <CreditCard color={Colors.neutral[600]} size={18} strokeWidth={2} />
              <Text style={styles.sectionLabelText}>Secure payment</Text>
            </View>
            <View style={styles.securityNote}>
              <Lock color={Colors.neutral[500]} size={16} strokeWidth={2} />
              <Text style={styles.securityText}>
                You’ll complete payment on Fincra’s secure checkout. Senda never receives or stores your card details.
              </Text>
            </View>

            <Button onPress={() => void handlePay()} style={styles.actionBtn} disabled={submitting}>
              <Text style={styles.btnText}>{submitting ? 'Starting checkout...' : `Continue to pay ${formatGBP(amount)}`}</Text>
            </Button>
            <Text style={styles.helpText}>Payments securely processed by Fincra</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.neutral[50] },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 60, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  backBtn: { padding: 4 },
  headerTitle: { ...Typography.h2, color: Colors.neutral[900] },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  form: { gap: Spacing.sm },
  amountCard: { backgroundColor: Colors.primary[600], borderRadius: 16, padding: Spacing.lg, marginBottom: Spacing.lg },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  amountTotalRow: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)', marginTop: Spacing.sm, paddingTop: Spacing.md },
  amountLabel: { ...Typography.body, color: Colors.primary[50] },
  amountRowValue: { ...Typography.bodyMedium, color: '#fff' },
  amountTotalLabel: { ...Typography.bodyMedium, color: '#fff' },
  amountValue: { fontSize: 36, fontFamily: 'Inter-Bold', color: '#fff' },
  errorText: { ...Typography.body, color: Colors.error[600], fontSize: 14, marginBottom: Spacing.md },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md, marginBottom: 4 },
  sectionLabelText: { ...Typography.label, color: Colors.neutral[700] },
  securityNote: { flexDirection: 'row', gap: 8, backgroundColor: Colors.neutral[100], borderRadius: 12, padding: Spacing.md, marginTop: Spacing.md },
  securityText: { ...Typography.small, color: Colors.neutral[600], flex: 1, lineHeight: 18 },
  actionBtn: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter-SemiBold' },
  secondaryBtn: { marginTop: Spacing.md, backgroundColor: Colors.neutral[200] },
  secondaryBtnText: { color: Colors.neutral[800], fontSize: 16, fontFamily: 'Inter-SemiBold' },
  resultContainer: { alignItems: 'center', paddingTop: Spacing.xxl },
  resultTitle: { ...Typography.h2, color: Colors.neutral[900], marginTop: Spacing.md, marginBottom: 8 },
  resultDesc: { ...Typography.body, color: Colors.neutral[500], textAlign: 'center', marginBottom: Spacing.xl, lineHeight: 22 },
  helpText: { ...Typography.small, color: Colors.neutral[500], textAlign: 'center', padding: Spacing.md },
});
