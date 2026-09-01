import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Shield, User, MapPin, CreditCard } from 'lucide-react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { submitKyc } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';

export default function KycScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState(profile?.full_name?.split(' ')[0] ?? '');
  const [lastName, setLastName] = useState(profile?.full_name?.split(' ').slice(1).join(' ') ?? '');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');

  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [idType, setIdType] = useState('PASSPORT');
  const [idNumber, setIdNumber] = useState('');
  const [idExpiry, setIdExpiry] = useState('');

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);

    try {
      const result = await submitKyc({
        name: { first: firstName.trim(), last: lastName.trim() },
        email: user?.email ?? '',
        phone: { country_code: '44', number: phone.replace(/^\+?44/, '') },
        address: {
          line1: addressLine1.trim(),
          line2: addressLine2.trim() || undefined,
          city: city.trim(),
          state: state.trim(),
          postal_code: postalCode.trim(),
          country: 'GB',
        },
        date_of_birth: dob,
        national_identification: {
          type: idType,
          identifier: idNumber.trim(),
          expiration_date: idExpiry || undefined,
        },
      });

      if (!result.success) {
        setError(result.error ?? 'KYC submission failed');
        return;
      }

      await refreshProfile();
      router.replace('/(tabs)/');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit KYC');
    } finally {
      setSaving(false);
    }
  };

  if (saving && step === 3) return <Loading />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (step > 1 ? setStep(step - 1) : router.back())} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Identity Verification</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.progressRow}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[
                styles.progressDot,
                s <= step ? { backgroundColor: Colors.primary[600] } : { backgroundColor: Colors.neutral[200] },
              ]}
            />
          ))}
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {step === 1 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <User color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>Personal Details</Text>
            <Text style={styles.stepDesc}>Tell us about yourself. This information is sent securely to Flutterwave for identity verification.</Text>

            <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="e.g. John" autoCapitalize="words" />
            <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="e.g. Mukamuri" autoCapitalize="words" />
            <Input label="Date of birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} placeholder="1990-04-09" />
            <Input label="Phone number" value={phone} onChangeText={setPhone} placeholder="e.g. 7700900123" keyboardType="phone-pad" />

            <Button onPress={() => setStep(2)} style={styles.actionBtn}>
              <Text style={styles.btnText}>Continue</Text>
            </Button>
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <MapPin color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>Address</Text>
            <Text style={styles.stepDesc}>We need your UK residential address for compliance.</Text>

            <Input label="Address line 1" value={addressLine1} onChangeText={setAddressLine1} placeholder="e.g. 123 High Street" />
            <Input label="Address line 2 (optional)" value={addressLine2} onChangeText={setAddressLine2} placeholder="e.g. Flat 4" />
            <Input label="City" value={city} onChangeText={setCity} placeholder="e.g. London" />
            <Input label="County / State" value={state} onChangeText={setState} placeholder="e.g. Greater London" />
            <Input label="Postcode" value={postalCode} onChangeText={setPostalCode} placeholder="e.g. SW1A 1AA" autoCapitalize="characters" />

            <Button
              onPress={() => {
                if (!addressLine1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
                  setError('Please fill in address line 1, city, county/state and postcode.');
                  return;
                }
                setError(null);
                setStep(3);
              }}
              style={styles.actionBtn}
            >
              <Text style={styles.btnText}>Continue</Text>
            </Button>
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <CreditCard color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>Identity Document</Text>
            <Text style={styles.stepDesc}>Provide a government-issued ID. This is required by Flutterwave to verify your identity before you can send money.</Text>

            <Text style={styles.label}>ID Type</Text>
            <View style={styles.pickerRow}>
              {['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.pickerOption,
                    idType === t ? { backgroundColor: Colors.primary[600], borderColor: Colors.primary[600] } : {},
                  ]}
                  onPress={() => setIdType(t)}
                >
                  <Text style={[styles.pickerText, idType === t ? { color: '#fff' } : {}]}>
                    {t === 'DRIVERS_LICENSE' ? "Driver's License" : t === 'NATIONAL_ID' ? 'National ID' : 'Passport'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input label="ID number" value={idNumber} onChangeText={setIdNumber} placeholder="e.g. 123456789" />
            <Input label="Expiry date (YYYY-MM-DD, optional)" value={idExpiry} onChangeText={setIdExpiry} placeholder="2029-06-01" />

            <View style={styles.noticeBox}>
              <Shield color={Colors.neutral[500]} size={16} strokeWidth={2} />
              <Text style={styles.noticeText}>
                Your data is encrypted in transit and stored securely. We never share your documents with third parties.
              </Text>
            </View>

            <Button onPress={handleSubmit} style={styles.actionBtn} disabled={saving}>
              <Text style={styles.btnText}>{saving ? 'Submitting...' : 'Submit Verification'}</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.neutral[50] },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 60, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  backBtn: { padding: 4 },
  headerTitle: { ...Typography.h2, color: Colors.neutral[900] },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: Spacing.lg },
  progressDot: { width: 50, height: 6, borderRadius: 3 },
  stepContainer: { alignItems: 'center', paddingBottom: Spacing.xl },
  stepIconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.primary[50], alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  stepTitle: { ...Typography.h2, color: Colors.neutral[900], marginBottom: 4 },
  stepDesc: { ...Typography.body, color: Colors.neutral[500], textAlign: 'center', marginBottom: Spacing.lg, lineHeight: 22 },
  errorBox: { backgroundColor: Colors.error[50], borderRadius: 12, padding: Spacing.md, marginBottom: Spacing.md },
  errorText: { ...Typography.body, color: Colors.error[600], fontSize: 13, lineHeight: 18 },
  label: { ...Typography.label, color: Colors.neutral[700], marginBottom: 8, alignSelf: 'flex-start', marginLeft: 4 },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md, flexWrap: 'wrap' },
  pickerOption: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.neutral[300], backgroundColor: '#fff' },
  pickerText: { ...Typography.caption, color: Colors.neutral[700], fontWeight: '600' },
  noticeBox: { flexDirection: 'row', gap: 8, backgroundColor: Colors.neutral[100], borderRadius: 12, padding: Spacing.md, marginTop: Spacing.md, marginBottom: Spacing.md },
  noticeText: { ...Typography.small, color: Colors.neutral[600], flex: 1, lineHeight: 18 },
  actionBtn: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl, minWidth: 200 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter-SemiBold' },
});
