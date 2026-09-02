import { useState, useEffect } from 'react';
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
import { router } from 'expo-router';
import { ArrowLeft, User, MapPin, CheckCircle2, Edit2, ChevronDown, Calendar } from 'lucide-react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { submitKyc } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';

function formatDateForDisplay(date: Date): string {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateForSubmission(date: Date): string {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Safe error formatter for backend responses
function formatKycError(result: any): string {
  // If error is already a string, use it directly
  if (typeof result?.error === "string") {
    return result.error;
  }

  // Check for Flutterwave diagnostic response
  const provider = result?._flutterwave_response;
  if (provider) {
    // If provider response itself is a string
    if (typeof provider === "string") {
      return provider;
    }

    // Check for nested error with validation details
    if (typeof provider?.error?.message === "string") {
      const validationErrors = provider?.error?.validation_errors;
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        const details = validationErrors
          .map((item: any) => {
            if (typeof item === "string") return item;
            if (item?.field_name && item?.message) {
              return `${item.field_name}: ${item.message}`;
            }
            return item?.message ?? JSON.stringify(item);
          })
          .join(", ");
        return `${provider.error.message}: ${details}`;
      }
      return provider.error.message;
    }

    // Check for message field directly
    if (typeof provider?.message === "string") {
      return provider.message;
    }

    // Check for error field directly
    if (typeof provider?.error === "string") {
      return provider.error;
    }
  }

  // Fallback to generic message
  return "Unable to complete account setup. Please check your details and try again.";
}

// Custom date picker component for cross-platform support
function DatePickerComponent({
  date,
  onDateChange,
}: {
  date: Date;
  onDateChange: (date: Date) => void;
}) {
  const [selectedYear, setSelectedYear] = useState(date.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(date.getMonth());
  const [selectedDay, setSelectedDay] = useState(date.getDate());

  const today = new Date();
  const maxYear = today.getFullYear();
  const minYear = 1920;

  // Generate arrays for years, months, and days
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i).reverse();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const days = Array.from(
    { length: getDaysInMonth(selectedMonth, selectedYear) },
    (_, i) => i + 1
  );

  const handleDateChange = () => {
    const newDate = new Date(selectedYear, selectedMonth, selectedDay);
    // Ensure we don't exceed today's date
    if (newDate <= today) {
      onDateChange(newDate);
    }
  };

  // Watch for changes and update the date
  useEffect(() => {
    handleDateChange();
  }, [selectedYear, selectedMonth, selectedDay]);

  return (
    <View style={styles.datePickerContainer}>
      <View style={styles.datePickerRow}>
        <View style={styles.datePickerColumn}>
          <Text style={styles.datePickerLabel}>Day</Text>
          <ScrollView
            style={styles.datePickerScroll}
            snapToInterval={40}
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
          >
            {days.map((day) => (
              <TouchableOpacity
                key={day}
                style={[
                  styles.datePickerItem,
                  selectedDay === day && styles.datePickerItemSelected,
                ]}
                onPress={() => setSelectedDay(day)}
              >
                <Text
                  style={[
                    styles.datePickerItemText,
                    selectedDay === day && styles.datePickerItemTextSelected,
                  ]}
                >
                  {String(day).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.datePickerColumn}>
          <Text style={styles.datePickerLabel}>Month</Text>
          <ScrollView
            style={styles.datePickerScroll}
            snapToInterval={40}
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
          >
            {months.map((month, idx) => (
              <TouchableOpacity
                key={month}
                style={[
                  styles.datePickerItem,
                  selectedMonth === idx && styles.datePickerItemSelected,
                ]}
                onPress={() => setSelectedMonth(idx)}
              >
                <Text
                  style={[
                    styles.datePickerItemText,
                    selectedMonth === idx && styles.datePickerItemTextSelected,
                  ]}
                >
                  {month}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.datePickerColumn}>
          <Text style={styles.datePickerLabel}>Year</Text>
          <ScrollView
            style={styles.datePickerScroll}
            snapToInterval={40}
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
          >
            {years.map((year) => (
              <TouchableOpacity
                key={year}
                style={[
                  styles.datePickerItem,
                  selectedYear === year && styles.datePickerItemSelected,
                ]}
                onPress={() => setSelectedYear(year)}
              >
                <Text
                  style={[
                    styles.datePickerItemText,
                    selectedYear === year && styles.datePickerItemTextSelected,
                  ]}
                >
                  {year}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

export default function KycScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMode, setSuccessMode] = useState(false);

  // Step 1: About you
  const [firstName, setFirstName] = useState(profile?.full_name?.split(' ')[0] ?? '');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState(profile?.full_name?.split(' ').slice(1).join(' ') ?? '');
  const [dobDate, setDobDate] = useState<Date>(new Date(2000, 0, 1));
  const [dobModalVisible, setDobModalVisible] = useState(false);
  const [phone, setPhone] = useState(profile?.phone ?? '');

  // Step 2: Where you live
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const validateStep1 = (): boolean => {
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError('Please fill in all required fields');
      return false;
    }
    // Check if DOB has been set (is it the default date or a real date?)
    const dobString = formatDateForSubmission(dobDate);
    if (!dobString || dobString === '2000-01-01') {
      setError('Please select your date of birth');
      return false;
    }
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!addressLine1.trim() || !city.trim() || !postalCode.trim()) {
      setError('Please fill in address line 1, city, and postcode');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);

    try {
      const result = await submitKyc({
        name: {
          first: firstName.trim(),
          middle: middleName.trim() || undefined,
          last: lastName.trim(),
        },
        phone: { country_code: '44', number: phone.replace(/^\+?44/, '') },
        address: {
          line1: addressLine1.trim(),
          line2: addressLine2.trim() || undefined,
          city: city.trim(),
          state: state.trim() || undefined,
          postal_code: postalCode.trim(),
          country: 'GB',
        },
        date_of_birth: formatDateForSubmission(dobDate),
        country_of_residence: 'GB',
      });

      if (!result.success) {
        // Log diagnostic information from backend if available (for development)
        if (result._flutterwave_response) {
          console.log(
            "Flutterwave account setup response:",
            JSON.stringify(result._flutterwave_response, null, 2)
          );
        }
        // Use safe error formatter to ensure we always have a string for UI
        const formattedError = formatKycError(result);
        setError(formattedError);
        return;
      }

      await refreshProfile();
      setSuccessMode(true);
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 2000);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to set up account');
    } finally {
      setSaving(false);
    }
  };

  if (saving) return <Loading />;

  if (successMode) {
    return (
      <View style={styles.successContainer}>
        <CheckCircle2 color={Colors.success[600]} size={56} strokeWidth={2} />
        <Text style={styles.successTitle}>Account setup complete!</Text>
        <Text style={styles.successDesc}>
          We've set up your Senda account and you can now start making transfers.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (step > 1 ? setStep(step - 1) : router.back())} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account Setup</Text>
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

        {/* Step 1: About You */}
        {step === 1 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <User color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>About you</Text>
            <Text style={styles.stepDesc}>Tell us a little about yourself. We use these details to set up your Senda account and process your transfers securely.</Text>

            <Input
              label="First name *"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="e.g. John"
              autoCapitalize="words"
            />
            <Input
              label="Middle name (optional)"
              value={middleName}
              onChangeText={setMiddleName}
              placeholder="e.g. James"
              autoCapitalize="words"
            />
            <Input
              label="Last name *"
              value={lastName}
              onChangeText={setLastName}
              placeholder="e.g. Mukamuri"
              autoCapitalize="words"
            />

            {/* Date of Birth Picker */}
            <TouchableOpacity
              style={styles.dobField}
              onPress={() => setDobModalVisible(true)}
              accessible
              accessibilityLabel="Date of birth picker"
              accessibilityRole="button"
              accessibilityHint="Tap to open date picker"
            >
              <View style={styles.dobContent}>
                <View>
                  <Text style={styles.dobLabel}>Date of birth *</Text>
                  <Text style={[styles.dobValue, !dobDate && styles.dobPlaceholder]}>
                    {dobDate ? formatDateForDisplay(dobDate) : 'Select date'}
                  </Text>
                </View>
                <Calendar color={Colors.primary[600]} size={20} />
              </View>
            </TouchableOpacity>

            <Modal
              visible={dobModalVisible}
              transparent
              animationType="slide"
              onRequestClose={() => setDobModalVisible(false)}
              accessible
            >
              <View style={styles.modalOverlay}>
                <View style={styles.dobModalContent}>
                  <View style={styles.dobModalHeader}>
                    <TouchableOpacity onPress={() => setDobModalVisible(false)}>
                      <Text style={styles.dobModalClose}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.dobModalTitle}>Date of birth</Text>
                    <TouchableOpacity onPress={() => setDobModalVisible(false)}>
                      <Text style={styles.dobModalDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DatePickerComponent date={dobDate} onDateChange={setDobDate} />
                </View>
              </View>
            </Modal>

            <Input
              label="Phone number *"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 7700900123"
              keyboardType="phone-pad"
            />

            <Button
              onPress={() => {
                setError(null);
                if (validateStep1()) {
                  setStep(2);
                }
              }}
              style={styles.actionBtn}
            >
              <Text style={styles.btnText}>Continue</Text>
            </Button>
          </View>
        )}

        {/* Step 2: Where You Live */}
        {step === 2 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <MapPin color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>Where you live</Text>
            <Text style={styles.stepDesc}>Help us verify your location for safe transfers.</Text>

            {/* Country Display (UK-only MVP) */}
            <View style={styles.countryDisplay}>
              <Text style={styles.countryLabel}>Country *</Text>
              <View style={styles.countryDisplayValue}>
                <Text style={styles.countryDisplayText}>
                  🇬🇧 United Kingdom
                </Text>
              </View>
            </View>

            <Input
              label="Address line 1 *"
              value={addressLine1}
              onChangeText={setAddressLine1}
              placeholder="e.g. 123 High Street"
            />
            <Input
              label="Address line 2 (optional)"
              value={addressLine2}
              onChangeText={setAddressLine2}
              placeholder="e.g. Flat 4"
            />
            <Input
              label="City/Town *"
              value={city}
              onChangeText={setCity}
              placeholder="e.g. London"
              autoCapitalize="words"
            />
            <Input
              label="County/State (optional)"
              value={state}
              onChangeText={setState}
              placeholder="e.g. Greater London"
              autoCapitalize="words"
            />
            <Input
              label="Postcode *"
              value={postalCode}
              onChangeText={setPostalCode}
              placeholder="e.g. SW1A 1AA"
              autoCapitalize="characters"
            />

            <Button
              onPress={() => {
                setError(null);
                if (validateStep2()) {
                  setStep(3);
                }
              }}
              style={styles.actionBtn}
            >
              <Text style={styles.btnText}>Continue</Text>
            </Button>
          </View>
        )}

        {/* Step 3: Review Details */}
        {step === 3 && (
          <View style={styles.stepContainer}>
            <View style={styles.stepIconWrap}>
              <CheckCircle2 color={Colors.primary[600]} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.stepTitle}>Check your details</Text>
            <Text style={styles.stepDesc}>Please review your information before we set up your account.</Text>

            <View style={styles.reviewSection}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewTitle}>About you</Text>
                <TouchableOpacity onPress={() => setStep(1)}>
                  <Edit2 color={Colors.primary[600]} size={16} />
                </TouchableOpacity>
              </View>

              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Full name</Text>
                <Text style={styles.reviewValue}>
                  {firstName} {middleName} {lastName}
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Date of birth</Text>
                <Text style={styles.reviewValue}>{formatDateForDisplay(dobDate)}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Phone number</Text>
                <Text style={styles.reviewValue}>{phone}</Text>
              </View>
            </View>

            <View style={styles.reviewSection}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewTitle}>Where you live</Text>
                <TouchableOpacity onPress={() => setStep(2)}>
                  <Edit2 color={Colors.primary[600]} size={16} />
                </TouchableOpacity>
              </View>

              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Country</Text>
                <Text style={styles.reviewValue}>
                  🇬🇧 United Kingdom
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Address</Text>
                <Text style={styles.reviewValue}>
                  {addressLine1}
                  {addressLine2 ? `\n${addressLine2}` : ''}
                  {`\n${city}`}
                  {state ? `\n${state}` : ''}
                  {`\n${postalCode}`}
                </Text>
              </View>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                By continuing, you confirm that the information you've provided is accurate and complete.
              </Text>
            </View>

            <Button onPress={handleSubmit} style={styles.actionBtn} disabled={saving}>
              <Text style={styles.btnText}>{saving ? 'Setting up...' : 'Create Account'}</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.neutral[50] },
  successContainer: {
    flex: 1,
    backgroundColor: Colors.neutral[50],
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  successTitle: { ...Typography.h2, color: Colors.neutral[900], marginTop: Spacing.md, textAlign: 'center' },
  successDesc: { ...Typography.body, color: Colors.neutral[500], textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },
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
  infoBox: { backgroundColor: Colors.primary[50], borderRadius: 12, padding: Spacing.md, marginTop: Spacing.md, marginBottom: Spacing.md },
  infoText: { ...Typography.small, color: Colors.primary[700], lineHeight: 18, textAlign: 'center' },
  actionBtn: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl, minWidth: 200 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter-SemiBold' },

  // Modal overlay styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' },

  // Date of Birth picker styles
  dobField: {
    width: '100%',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: Spacing.md,
  },
  dobContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dobLabel: { ...Typography.label, color: Colors.neutral[700], marginBottom: 8 },
  dobValue: { ...Typography.body, color: Colors.neutral[900], marginTop: 4 },
  dobPlaceholder: { color: Colors.neutral[400] },

  // DOB Modal styles
  dobModalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  dobModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.neutral[200],
  },
  dobModalTitle: { ...Typography.h3, color: Colors.neutral[900], flex: 1, textAlign: 'center' },
  dobModalClose: { ...Typography.label, color: Colors.error[600], fontWeight: '600', marginHorizontal: Spacing.sm },
  dobModalDone: { ...Typography.label, color: Colors.primary[600], fontWeight: '600', marginHorizontal: Spacing.sm },

  // Date picker component styles
  datePickerContainer: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  datePickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  datePickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  datePickerLabel: {
    ...Typography.label,
    color: Colors.neutral[700],
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  datePickerScroll: {
    height: 160,
    maxHeight: 160,
  },
  datePickerItem: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  datePickerItemSelected: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary[600],
  },
  datePickerItemText: {
    ...Typography.body,
    color: Colors.neutral[400],
  },
  datePickerItemTextSelected: {
    color: Colors.primary[600],
    fontWeight: '600',
  },

  // UK-only country display styles
  countryDisplay: { width: '100%', marginBottom: Spacing.md },
  countryLabel: { ...Typography.label, color: Colors.neutral[700], marginBottom: 8 },
  countryDisplayValue: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    backgroundColor: Colors.neutral[50],
  },
  countryDisplayText: { ...Typography.body, color: Colors.neutral[900] },

  // Review styles
  reviewSection: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: Spacing.md, marginBottom: Spacing.md },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.neutral[200] },
  reviewTitle: { ...Typography.label, color: Colors.neutral[700], fontWeight: '600' },
  reviewRow: { marginBottom: Spacing.sm },
  reviewLabel: { ...Typography.small, color: Colors.neutral[500] },
  reviewValue: { ...Typography.body, color: Colors.neutral[900], marginTop: 4 },
});
