import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, CreditCard, Lock, CheckCircle2, AlertCircle, Loader } from 'lucide-react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { collectCard, authorizeCharge, verifyCharge, startPayoutOrchestration, formatGBP } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';

export default function CollectScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const { profile } = useAuth();

  const [planId, setPlanId] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState(0);
  const [amount, setAmount] = useState(0);
  const [processingFee, setProcessingFee] = useState(0);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState('');
  const [cvv, setCvv] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');

  const [billingLine1, setBillingLine1] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingCounty, setBillingCounty] = useState('');
  const [billingPostalCode, setBillingPostalCode] = useState('');

  const [chargeStatus, setChargeStatus] = useState<'idle' | 'processing' | 'requires_otp' | 'requires_pin' | 'requires_additional_fields' | 'redirect' | 'succeeded' | 'failed'>('idle');
  const [nextAction, setNextAction] = useState<any>(null);
  const [otpInput, setOtpInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    (async () => {
      if (!transactionId) {
        setError('Missing transaction ID');
        setLoading(false);
        return;
      }
      try {
        const { supabase } = require('@/lib/supabase');
        const { data, error: txError } = await supabase
          .from('transactions')
          .select('*, plan:plans(*)')
          .eq('id', transactionId)
          .maybeSingle();

        if (txError || !data) {
          setError('Transaction not found');
          setLoading(false);
          return;
        }

        setPlanId(data.plan_id);
        setSendAmount(Number(data.plan?.total_gbp) || 0);
        setAmount(Number(data.amount_gbp));
        setProcessingFee(Number(data.plan?.processing_fee) || 0);
        setPaymentReference(data.payment_reference);

        if (data.next_action_type === 'requires_otp') {
          setChargeStatus('requires_otp');
          setShowOtpModal(true);
        } else if (data.next_action_type === 'requires_pin') {
          setChargeStatus('requires_pin');
          setShowPinModal(true);
        } else if (data.next_action_type === 'requires_additional_fields') {
          setChargeStatus('requires_additional_fields');
        } else if (data.status === 'successful') {
          setChargeStatus('succeeded');
        } else if (data.status === 'failed') {
          setChargeStatus('failed');
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load transaction');
      } finally {
        setLoading(false);
      }
    })();
  }, [transactionId]);

  const verifyAndStartPayouts = async () => {
    const verifyResult = await verifyCharge(transactionId);
    if (verifyResult.verified && planId) {
      const payoutResult = await startPayoutOrchestration(planId);
      if (!payoutResult.success) {
        console.error('Automatic payout orchestration did not start:', payoutResult.error);
      }
    }
    return verifyResult;
  };

  const handlePay = async () => {
    if (!paymentReference) {
      setError('This transaction has no payment reference. Please return to the plan and start payment again.');
      return;
    }
    setError(null);
    setSubmitting(true);
    setChargeStatus('processing');

    try {
      const result = await collectCard({
        transaction_id: transactionId,
        amount,
        reference: paymentReference,
        card: {
          number: cardNumber.replace(/\s/g, ''),
          cvv,
          expiry_month: expiryMonth,
          expiry_year: expiryYear,
        },
        billing_address: {
          line1: billingLine1.trim(),
          city: billingCity.trim(),
          state: billingCounty.trim(),
          postal_code: billingPostalCode.trim(),
          country: 'GB',
        },
      });

      if (!result.success) {
        setError(result.error ?? 'Payment failed');
        setChargeStatus('failed');
        return;
      }

      if (result.status === 'succeeded') {
        const verifyResult = await verifyAndStartPayouts();
        if (verifyResult.verified) {
          setChargeStatus('succeeded');
        } else {
          setChargeStatus('failed');
          setError('Payment could not be verified');
        }
        return;
      }

      if (result.next_action?.type === 'requires_otp' || result.next_action?.type === 'otp') {
        setChargeStatus('requires_otp');
        setNextAction(result.next_action);
        setShowOtpModal(true);
      } else if (result.next_action?.type === 'requires_pin' || result.next_action?.type === 'pin') {
        setChargeStatus('requires_pin');
        setNextAction(result.next_action);
        setShowPinModal(true);
      } else if (result.next_action?.type === 'requires_additional_fields') {
        setChargeStatus('requires_additional_fields');
      } else if (result.next_action?.type === 'redirect_url') {
        setChargeStatus('redirect');
        setError('Redirect-based 3DS authentication is not yet supported in this build.');
      } else {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Payment failed');
      setChargeStatus('failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdditionalFieldsSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await authorizeCharge({
        transaction_id: transactionId,
        type: 'address',
        address: {
          line1: billingLine1.trim(),
          city: billingCity.trim(),
          state: billingCounty.trim(),
          postal_code: billingPostalCode.trim(),
          country: 'GB',
        },
      });

      if (!result.success) {
        setError(result.error ?? 'We could not verify the billing details');
        setChargeStatus('failed');
        return;
      }

      if (result.status === 'succeeded') {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
        if (!verifyResult.verified) setError('Payment could not be verified');
      } else if (result.next_action?.type === 'requires_otp') {
        setChargeStatus('requires_otp');
        setShowOtpModal(true);
      } else if (result.next_action?.type === 'requires_pin') {
        setChargeStatus('requires_pin');
        setShowPinModal(true);
      } else {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
        if (!verifyResult.verified) setError('Payment could not be verified');
      }
    } catch (e: any) {
      setError(e?.message ?? 'We could not verify the billing details');
      setChargeStatus('failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async () => {
    setShowOtpModal(false);
    setSubmitting(true);
    setError(null);

    try {
      const result = await authorizeCharge({
        transaction_id: transactionId,
        type: 'otp',
        otp: { code: otpInput },
      });

      if (!result.success) {
        setError(result.error ?? 'OTP verification failed');
        setChargeStatus('failed');
        return;
      }

      if (result.status === 'succeeded') {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
      } else if (result.next_action?.type === 'requires_pin') {
        setChargeStatus('requires_pin');
        setShowPinModal(true);
      } else {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
      }
    } catch (e: any) {
      setError(e?.message ?? 'OTP verification failed');
      setChargeStatus('failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinSubmit = async () => {
    setShowPinModal(false);
    setSubmitting(true);
    setError(null);

    try {
      const nonce = crypto.randomUUID?.() ?? Date.now().toString();
      const result = await authorizeCharge({
        transaction_id: transactionId,
        type: 'pin',
        pin: { nonce, encrypted_pin: pinInput },
      });

      if (!result.success) {
        setError(result.error ?? 'PIN verification failed');
        setChargeStatus('failed');
        return;
      }

      if (result.status === 'succeeded') {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
      } else if (result.next_action?.type === 'requires_otp') {
        setChargeStatus('requires_otp');
        setShowOtpModal(true);
      } else {
        const verifyResult = await verifyAndStartPayouts();
        setChargeStatus(verifyResult.verified ? 'succeeded' : 'failed');
      }
    } catch (e: any) {
      setError(e?.message ?? 'PIN verification failed');
      setChargeStatus('failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pay for your transfer</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {chargeStatus === 'succeeded' ? (
          <View style={styles.resultContainer}>
            <CheckCircle2 color={Colors.success[500]} size={64} strokeWidth={1.5} />
            <Text style={styles.resultTitle}>Payment received</Text>
            <Text style={styles.resultDesc}>Your payment was received. Senda is now sending the money to each recipient.</Text>
            <Button onPress={() => router.replace(planId ? `/plan/${planId}` : '/(tabs)')} style={styles.actionBtn}>
              <Text style={styles.btnText}>Done</Text>
            </Button>
          </View>
        ) : chargeStatus === 'failed' ? (
          <View style={styles.resultContainer}>
            <AlertCircle color={Colors.error[500]} size={64} strokeWidth={1.5} />
            <Text style={styles.resultTitle}>Payment Failed</Text>
            <Text style={styles.resultDesc}>{error ?? 'Your payment could not be processed. Please try again.'}</Text>
            <Button onPress={() => { setChargeStatus('idle'); setError(null); }} style={styles.actionBtn}>
              <Text style={styles.btnText}>Try Again</Text>
            </Button>
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.amountCard}>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>You send</Text>
                <Text style={styles.amountRowValue}>{formatGBP(sendAmount)}</Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Processing Fee</Text>
                <Text style={styles.amountRowValue}>{formatGBP(processingFee)}</Text>
              </View>
              <View style={[styles.amountRow, styles.amountTotalRow]}>
                <Text style={styles.amountTotalLabel}>Total</Text>
                <Text style={styles.amountValue}>{formatGBP(amount)}</Text>
              </View>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.sectionLabel}>
              <CreditCard color={Colors.neutral[600]} size={18} strokeWidth={2} />
              <Text style={styles.sectionLabelText}>Payment method</Text>
            </View>

            <Input label="Card number" value={cardNumber} onChangeText={(v) => setCardNumber(v.replace(/[^0-9]/g, ''))} placeholder="4242 4242 4242 4242" keyboardType="numeric" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Input label="Expiry month" value={expiryMonth} onChangeText={(v) => setExpiryMonth(v.replace(/[^0-9]/g, ''))} placeholder="09" keyboardType="numeric" />
              </View>
              <View style={styles.flex1}>
                <Input label="Expiry year" value={expiryYear} onChangeText={(v) => setExpiryYear(v.replace(/[^0-9]/g, ''))} placeholder="32" keyboardType="numeric" />
              </View>
              <View style={styles.flex1}>
                <Input label="CVV" value={cvv} onChangeText={(v) => setCvv(v.replace(/[^0-9]/g, ''))} placeholder="123" keyboardType="numeric" secureTextEntry />
              </View>
            </View>

            <View style={styles.sectionLabel}>
              <Lock color={Colors.neutral[600]} size={18} strokeWidth={2} />
              <Text style={styles.sectionLabelText}>Billing Address</Text>
            </View>

            <Input label="Address line 1" value={billingLine1} onChangeText={setBillingLine1} placeholder="e.g. 123 High Street" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Input label="City" value={billingCity} onChangeText={setBillingCity} placeholder="e.g. London" />
              </View>
              <View style={styles.flex1}>
                <Input label="County" value={billingCounty} onChangeText={setBillingCounty} placeholder="e.g. Greater London" />
              </View>
            </View>
            <Input label="Postcode" value={billingPostalCode} onChangeText={setBillingPostalCode} placeholder="e.g. SW1A 1AA" autoCapitalize="characters" />

            <View style={styles.securityNote}>
              <Lock color={Colors.neutral[400]} size={14} strokeWidth={2} />
              <Text style={styles.securityText}>Your card details are encrypted and never stored by Senda.</Text>
            </View>

            <Button
              onPress={chargeStatus === 'requires_additional_fields' ? handleAdditionalFieldsSubmit : handlePay}
              style={styles.actionBtn}
              disabled={submitting || chargeStatus === 'processing'}
            >
              <Text style={styles.btnText}>
                {submitting || chargeStatus === 'processing'
                  ? 'Processing...'
                  : chargeStatus === 'requires_additional_fields'
                  ? 'Continue payment'
                  : `Pay £${amount.toFixed(2)}`}
              </Text>
            </Button>
          </View>
        )}
      </ScrollView>

      {/* OTP Modal */}
      <Modal visible={showOtpModal} transparent animationType="slide" onRequestClose={() => setShowOtpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter OTP</Text>
            <Text style={styles.modalDesc}>A one-time password was sent to your phone or email. Enter it below to authorize this payment.</Text>
            <Input label="OTP code" value={otpInput} onChangeText={(v) => setOtpInput(v.replace(/[^0-9]/g, ''))} placeholder="123456" keyboardType="numeric" />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowOtpModal(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button onPress={handleOtpSubmit} style={styles.modalConfirmBtn}>
                <Text style={styles.btnText}>Verify</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* PIN Modal */}
      <Modal visible={showPinModal} transparent animationType="slide" onRequestClose={() => setShowPinModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Card PIN</Text>
            <Text style={styles.modalDesc}>Enter your 4-digit card PIN to authorize this payment.</Text>
            <Input label="PIN" value={pinInput} onChangeText={(v) => setPinInput(v.replace(/[^0-9]/g, ''))} placeholder="1234" keyboardType="numeric" secureTextEntry />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowPinModal(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button onPress={handlePinSubmit} style={styles.modalConfirmBtn}>
                <Text style={styles.btnText}>Verify</Text>
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
  errorBox: { backgroundColor: Colors.error[50], borderRadius: 12, padding: Spacing.md, marginBottom: Spacing.md },
  errorText: { ...Typography.body, color: Colors.error[600], fontSize: 14 },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md, marginBottom: 4 },
  sectionLabelText: { ...Typography.label, color: Colors.neutral[700] },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex1: { flex: 1 },
  securityNote: { flexDirection: 'row', gap: 8, backgroundColor: Colors.neutral[100], borderRadius: 12, padding: Spacing.md, marginTop: Spacing.md },
  securityText: { ...Typography.small, color: Colors.neutral[500], flex: 1, lineHeight: 18 },
  actionBtn: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter-SemiBold' },
  resultContainer: { alignItems: 'center', paddingTop: Spacing.xxl },
  resultTitle: { ...Typography.h2, color: Colors.neutral[900], marginTop: Spacing.md, marginBottom: 8 },
  resultDesc: { ...Typography.body, color: Colors.neutral[500], textAlign: 'center', marginBottom: Spacing.xl, lineHeight: 22 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: Spacing.lg },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: Spacing.lg, width: '100%', maxWidth: 400 },
  modalTitle: { ...Typography.h2, color: Colors.neutral[900], marginBottom: 8 },
  modalDesc: { ...Typography.body, color: Colors.neutral[500], fontSize: 14, marginBottom: Spacing.md, lineHeight: 20 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: Spacing.md },
  modalCancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  modalCancelText: { ...Typography.bodyMedium, color: Colors.neutral[500] },
  modalConfirmBtn: { paddingHorizontal: 24 },
});
