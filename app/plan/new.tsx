import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ViewStyle,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, CheckCircle2, Wallet, Users } from 'lucide-react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography, RECURRING_OPTIONS } from '@/lib/theme';
import { createPlan, fetchCorridorCountries } from '@/lib/data';
import { RecurringType, PayoutCorridorCountry, Plan, PricingMode } from '@/types/database';
import { COUNTRIES } from '@/lib/theme';

export default function NewPlanScreen() {
  const [name, setName] = useState('');
  const [recurring, setRecurring] = useState<RecurringType>('one_off');
  const [nextRunDate, setNextRunDate] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [corridorCountries, setCorridorCountries] = useState<PayoutCorridorCountry[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [pricingMode, setPricingMode] = useState<PricingMode | null>(null);
  const [sourceAmount, setSourceAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCorridorCountries()
      .then((countries) => {
        setCorridorCountries(countries);
        setCountriesLoading(false);
      })
      .catch(() => setCountriesLoading(false));
  }, []);

  const selectedCountryInfo = corridorCountries.find((c) => c.country_code === destinationCountry);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please enter a plan name');
      return;
    }
    if (!destinationCountry) {
      setError('Please select a destination country');
      return;
    }
    if (!pricingMode) {
      setError('Please choose how you want to set up this payment');
      return;
    }
    if (pricingMode === 'fixed_source') {
      const budget = parseFloat(sourceAmount);
      if (!budget || budget <= 0) {
        setError('Please enter your budget amount');
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const plan = await createPlan({
        name: name.trim(),
        recurring,
        next_run_date: nextRunDate || null,
        status: 'draft',
        destination_country: destinationCountry || null,
        destination_currency: selectedCountryInfo?.currency || null,
        pricing_mode: pricingMode,
        source_amount: pricingMode === 'fixed_source' ? parseFloat(sourceAmount) : 0,
      } as Partial<Plan>);
      router.replace(`/plan/${plan.id}`);
    } catch (e: any) {
      setError(e.message || 'Failed to create plan');
      setSaving(false);
    }
  };

  const canProceed = !!destinationCountry && !!pricingMode && !!name.trim() &&
    (pricingMode === 'fixed_destination' || (pricingMode === 'fixed_source' && parseFloat(sourceAmount) > 0));

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Plan</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={styles.title}>Create a Remittance Plan</Text>
          <Text style={styles.subtitle}>
            Name your plan, select a destination, and choose how to set up your payment.
          </Text>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Input
            label="Plan name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Monthly Family Support"
            autoCapitalize="words"
          />

          <Text style={styles.label}>Frequency</Text>
          <View style={styles.recurringRow}>
            {RECURRING_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setRecurring(opt.value)}
                style={[
                  styles.recurringChip,
                  recurring === opt.value && styles.recurringChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.recurringChipText,
                    recurring === opt.value && styles.recurringChipTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Next run date (optional)"
            value={nextRunDate}
            onChangeText={setNextRunDate}
            placeholder="YYYY-MM-DD"
          />

          <Text style={styles.label}>Destination country</Text>
          {countriesLoading ? (
            <Text style={styles.loadingText}>Loading supported countries...</Text>
          ) : (
            <ScrollView style={styles.countryList} horizontal={false}>
              {corridorCountries.map((c) => {
                const countryInfo = COUNTRIES.find((ci) => ci.code === c.country_code);
                const isSelected = destinationCountry === c.country_code;
                return (
                  <TouchableOpacity
                    key={c.country_code}
                    onPress={() => setDestinationCountry(c.country_code)}
                    style={[
                      styles.countryItem,
                      isSelected && styles.countryItemSelected,
                    ]}
                  >
                    <Text style={styles.countryFlag}>{countryInfo?.flag || '🌍'}</Text>
                    <View style={styles.countryInfo}>
                      <Text style={styles.countryName}>{c.country_name}</Text>
                      <Text style={styles.countryCurrency}>{c.currency}</Text>
                    </View>
                    {isSelected && (
                      <CheckCircle2 color={Colors.primary[600]} size={20} strokeWidth={2} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {destinationCountry && (
            <View style={styles.currencyNote}>
              <Text style={styles.currencyNoteText}>
                All recipients in this plan must use this destination country and currency. Recipients from other countries will need a separate plan.
              </Text>
            </View>
          )}

          {/* PRICING MODE SELECTION */}
          {destinationCountry && (
            <>
              <Text style={styles.label}>How would you like to set up this payment?</Text>
              <View style={styles.pricingModeRow}>
                <TouchableOpacity
                  onPress={() => setPricingMode('fixed_source')}
                  style={[
                    styles.pricingModeCard,
                    pricingMode === 'fixed_source' && styles.pricingModeSelected,
                  ]}
                >
                  <Wallet
                    color={pricingMode === 'fixed_source' ? Colors.primary[600] : Colors.neutral[400]}
                    size={22}
                    strokeWidth={2}
                  />
                  <Text style={styles.pricingModeTitle}>I have a budget</Text>
                  <Text style={styles.pricingModeDesc}>
                    I know how much I want to spend in GBP
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPricingMode('fixed_destination')}
                  style={[
                    styles.pricingModeCard,
                    pricingMode === 'fixed_destination' && styles.pricingModeSelected,
                  ]}
                >
                  <Users
                    color={pricingMode === 'fixed_destination' ? Colors.primary[600] : Colors.neutral[400]}
                    size={22}
                    strokeWidth={2}
                  />
                  <Text style={styles.pricingModeTitle}>Set what each person receives</Text>
                  <Text style={styles.pricingModeDesc}>
                    I know how much each recipient needs in {selectedCountryInfo?.currency || 'destination currency'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* BUDGET INPUT (only for fixed_source) */}
          {pricingMode === 'fixed_source' && (
            <View style={styles.budgetSection}>
              <Text style={styles.label}>Your budget</Text>
              <View style={styles.amountInputWrap}>
                <Text style={styles.amountPrefix}>£</Text>
                <TextInput
                  style={styles.amountInput}
                  value={sourceAmount}
                  onChangeText={setSourceAmount}
                  placeholder="0.00"
                  placeholderTextColor={Colors.neutral[400]}
                  keyboardType="numeric"
                />
              </View>
              <Text style={styles.budgetHint}>
                This is the total you want to spend. You will allocate this between recipients next.
              </Text>
            </View>
          )}

          <Button
            onPress={handleCreate}
            loading={saving}
            style={styles.createBtn}
            disabled={!canProceed}
          >
            Create Plan
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.neutral[50],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
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
  headerTitle: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  scrollContent: {
    flexGrow: 1,
  },
  form: {
    backgroundColor: '#fff',
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  title: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  subtitle: {
    ...Typography.body,
    color: Colors.neutral[500],
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  errorBox: {
    backgroundColor: Colors.error[50],
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Typography.caption,
    color: Colors.error[700],
  },
  label: {
    ...Typography.label,
    color: Colors.neutral[700],
    marginBottom: Spacing.sm,
  },
  recurringRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  recurringChip: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 999,
  },
  recurringChipSelected: {
    borderColor: Colors.primary[600],
    backgroundColor: Colors.primary[50],
  },
  recurringChipText: {
    ...Typography.caption,
    color: Colors.neutral[600],
  },
  recurringChipTextSelected: {
    color: Colors.primary[700],
    fontFamily: 'Inter-SemiBold',
  },
  createBtn: {
    marginTop: Spacing.lg,
    width: '100%',
  },
  countryList: {
    maxHeight: 300,
    marginBottom: Spacing.sm,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    marginBottom: Spacing.sm,
  } as ViewStyle,
  countryItemSelected: {
    borderColor: Colors.primary[600],
    backgroundColor: Colors.primary[50],
  },
  countryFlag: {
    fontSize: 24,
  },
  countryInfo: {
    flex: 1,
  },
  countryName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  countryCurrency: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  loadingText: {
    ...Typography.body,
    color: Colors.neutral[500],
    marginBottom: Spacing.md,
  },
  currencyNote: {
    backgroundColor: Colors.primary[50],
    borderRadius: 10,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  } as ViewStyle,
  currencyNoteText: {
    ...Typography.small,
    color: Colors.primary[700],
    lineHeight: 18,
  },
  pricingModeRow: {
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  pricingModeCard: {
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 14,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  } as ViewStyle,
  pricingModeSelected: {
    borderColor: Colors.primary[600],
    backgroundColor: Colors.primary[50],
  },
  pricingModeTitle: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
    marginTop: Spacing.xs,
    marginBottom: 4,
  },
  pricingModeDesc: {
    ...Typography.small,
    color: Colors.neutral[500],
    lineHeight: 18,
  },
  budgetSection: {
    marginBottom: Spacing.md,
  },
  amountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.neutral[50],
    marginBottom: Spacing.xs,
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
  budgetHint: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 4,
  },
});
