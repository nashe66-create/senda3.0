import { useState, useEffect, useCallback } from 'react';
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CheckCircle2, Wallet, Users } from 'lucide-react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography, RECURRING_OPTIONS } from '@/lib/theme';
import { addCommitment, createPlan, deletePlan, fetchCorridorCountries, fetchRecipients, recalcPlanTotals } from '@/lib/data';
import { Recipient, RecurringType, PayoutCorridorCountry, Plan, PricingMode } from '@/types/database';
import { COUNTRIES } from '@/lib/theme';

export default function NewPlanScreen() {
  const { destination_country, destination_currency, created_recipient_id, transfer_name, recurring: recurringParam, next_run_date, pricing_mode, source_amount: sourceAmountParam } = useLocalSearchParams<{
    destination_country?: string;
    destination_currency?: string;
    created_recipient_id?: string;
    transfer_name?: string;
    recurring?: RecurringType;
    next_run_date?: string;
    pricing_mode?: PricingMode;
    source_amount?: string;
  }>();
  const name = transfer_name || 'Family support';
  const [recurring, setRecurring] = useState<RecurringType>(recurringParam || 'one_off');
  const [nextRunDate, setNextRunDate] = useState(next_run_date || '');
  const [showRecurringOptions, setShowRecurringOptions] = useState(false);
  const [destinationCountry, setDestinationCountry] = useState('');
  const [corridorCountries, setCorridorCountries] = useState<PayoutCorridorCountry[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [pricingMode, setPricingMode] = useState<PricingMode | null>(pricing_mode || null);
  const [sourceAmount, setSourceAmount] = useState(sourceAmountParam || '');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [recipientAmounts, setRecipientAmounts] = useState<Record<string, string>>({});
  const [recipientsLoading, setRecipientsLoading] = useState(true);
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

  const loadRecipients = useCallback(async () => {
    fetchRecipients()
      .then(setRecipients)
      .catch(() => setRecipients([]))
      .finally(() => setRecipientsLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecipients();
    }, [loadRecipients])
  );

  useEffect(() => {
    if (destination_country) setDestinationCountry(destination_country);
  }, [destination_country]);

  const selectedCountryInfo = corridorCountries.find((c) => c.country_code === destinationCountry);

  useEffect(() => {
    if (!created_recipient_id || recipients.length === 0) return;
    const createdRecipient = recipients.find((recipient) => recipient.id === created_recipient_id);
    if (!createdRecipient || createdRecipient.country !== destinationCountry || createdRecipient.currency !== selectedCountryInfo?.currency) return;
    setSelectedRecipientIds((current) => current.includes(createdRecipient.id) ? current : [...current, createdRecipient.id]);
  }, [created_recipient_id, recipients, destinationCountry, selectedCountryInfo?.currency]);

  const handleCreate = async () => {
    let createdPlanId: string | null = null;
    if (!destinationCountry) {
      setError('Please select a destination country');
      return;
    }
    if (!pricingMode) {
      setError('Please choose how you want to set up this transfer');
      return;
    }
    if (selectedRecipientIds.length === 0) {
      setError('Choose at least one person to receive this transfer');
      return;
    }
    if (selectedRecipientIds.length > 5) {
      setError('A transfer can include a maximum of 5 people');
      return;
    }
    if (pricingMode === 'fixed_source') {
      const budget = parseFloat(sourceAmount);
      if (!budget || budget <= 0) {
        setError('Please enter your budget amount');
        return;
      }
    }

    const amounts = selectedRecipientIds.map((recipientId) => ({
      recipientId,
      amount: Number.parseFloat(recipientAmounts[recipientId] || ''),
    }));
    if (amounts.some(({ amount }) => !Number.isFinite(amount) || amount <= 0)) {
      setError('Enter an amount for each person');
      return;
    }
    if (pricingMode === 'fixed_source') {
      const totalAllocated = amounts.reduce((sum, item) => sum + item.amount, 0);
      if (totalAllocated > Number.parseFloat(sourceAmount) + 0.01) {
        setError('The amounts cannot be higher than your total amount to spend');
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
      createdPlanId = plan.id;
      await Promise.all(amounts.map(({ recipientId, amount }) => {
        const recipient = recipients.find((item) => item.id === recipientId);
        if (!recipient) throw new Error('A selected person could not be found');
        return addCommitment({
          plan_id: plan.id,
          recipient_id: recipient.id,
          amount_gbp: pricingMode === 'fixed_source' ? amount : 0,
          destination_currency: recipient.currency || selectedCountryInfo?.currency || '',
          receiving_method: recipient.receiving_method,
          amount_destination: pricingMode === 'fixed_destination' ? amount : 0,
          fx_rate: 0,
        });
      }));
      await recalcPlanTotals(plan.id);
      router.replace(`/plan/${plan.id}`);
    } catch (e: any) {
      if (createdPlanId) {
        try {
          await deletePlan(createdPlanId);
        } catch {
          // The creation error remains visible if cleanup cannot complete.
        }
      }
      setError(e.message || 'We could not create this transfer. Nothing was sent.');
      setSaving(false);
    }
  };

  const canProceed = !!destinationCountry && !!pricingMode &&
    selectedRecipientIds.length > 0 &&
    (pricingMode === 'fixed_destination' || (pricingMode === 'fixed_source' && parseFloat(sourceAmount) > 0));

  const eligibleRecipients = recipients.filter((recipient) =>
    recipient.country === destinationCountry &&
    recipient.currency === selectedCountryInfo?.currency &&
    recipient.verification_status === 'verified' &&
    Boolean(recipient.flutterwave_recipient_id)
  );

  const toggleRecipient = (recipientId: string) => {
    setSelectedRecipientIds((current) => {
      if (current.includes(recipientId)) {
        setRecipientAmounts((amounts) => {
          const next = { ...amounts };
          delete next[recipientId];
          return next;
        });
        return current.filter((id) => id !== recipientId);
      }
      if (current.length >= 5) return current;
      return [...current, recipientId];
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color={Colors.neutral[700]} size={24} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Start a transfer</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={styles.title}>Send money to multiple people</Text>
          <Text style={styles.subtitle}>
            Add the people you send money to, choose the amounts, and pay once.
          </Text>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => setShowRecurringOptions((visible) => !visible)}
            style={styles.secondaryOptionsToggle}
          >
            <Text style={styles.secondaryOptionsText}>
              {showRecurringOptions ? 'Hide regular sending options' : 'Set up regular sending later'}
            </Text>
          </TouchableOpacity>

          {showRecurringOptions && (
            <View style={styles.secondaryOptions}>
              <Text style={styles.label}>How often?</Text>
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
                label="Next sending date (optional)"
                value={nextRunDate}
                onChangeText={setNextRunDate}
                placeholder="YYYY-MM-DD"
              />
            </View>
          )}

          <Text style={styles.label}>Where are they receiving the money?</Text>
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
                    onPress={() => {
                      setDestinationCountry(c.country_code);
                      setSelectedRecipientIds([]);
                      setRecipientAmounts({});
                      setError(null);
                    }}
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
                Everyone in this transfer must use the same destination country and currency. People in other countries need a separate transfer.
              </Text>
            </View>
          )}

          {destinationCountry && (
            <View style={styles.peopleSection}>
              <View style={styles.peopleHeader}>
                <Text style={styles.label}>Who are you sending to?</Text>
                <Text style={styles.peopleCount}>{selectedRecipientIds.length}/5</Text>
              </View>
              {recipientsLoading ? (
                <Text style={styles.loadingText}>Loading your people...</Text>
              ) : eligibleRecipients.length === 0 ? (
                <View>
                  <Text style={styles.peopleEmptyText}>
                    You don't have anyone set up for this destination yet.
                  </Text>
                  <Button
                    onPress={() => {
                      const params = new URLSearchParams({
                        destination_country: destinationCountry,
                        destination_currency: selectedCountryInfo?.currency || '',
                        return_to_new_plan: 'true',
                        transfer_name: name,
                        recurring,
                        next_run_date: nextRunDate,
                        pricing_mode: pricingMode || '',
                        source_amount: sourceAmount,
                      });
                      router.push(`/recipient/new?${params.toString()}`);
                    }}
                    size="sm"
                    style={styles.addPersonBtn}
                  >
                    Add a person
                  </Button>
                </View>
              ) : (
                eligibleRecipients.map((recipient) => {
                  const selected = selectedRecipientIds.includes(recipient.id);
                  return (
                    <TouchableOpacity
                      key={recipient.id}
                      onPress={() => toggleRecipient(recipient.id)}
                      style={[styles.personItem, selected && styles.personItemSelected]}
                    >
                      <View style={styles.personInfo}>
                        <Text style={styles.personName}>{recipient.name}</Text>
                        <Text style={styles.personMeta}>{recipient.currency} · {recipient.receiving_method.replace('_', ' ')}</Text>
                        {selected && (
                          <View style={styles.personAmountWrap}>
                            <Text style={styles.personAmountPrefix}>
                              {pricingMode === 'fixed_source' ? '£' : `${recipient.currency} `}
                            </Text>
                            <TextInput
                              style={styles.personAmountInput}
                              value={recipientAmounts[recipient.id] || ''}
                              onChangeText={(value) => setRecipientAmounts((amounts) => ({ ...amounts, [recipient.id]: value }))}
                              placeholder="0.00"
                              placeholderTextColor={Colors.neutral[400]}
                              keyboardType="decimal-pad"
                            />
                          </View>
                        )}
                      </View>
                      {selected && <CheckCircle2 color={Colors.primary[600]} size={20} strokeWidth={2} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {/* PRICING MODE SELECTION */}
          {destinationCountry && (
            <>
              <Text style={styles.label}>How would you like to set the amounts?</Text>
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
                    <Text style={styles.pricingModeTitle}>I want to spend a total amount</Text>
                  <Text style={styles.pricingModeDesc}>
                    Choose the total amount you want to spend and allocate it between people.
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
                    <Text style={styles.pricingModeTitle}>I want each person to receive a specific amount</Text>
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
              <Text style={styles.label}>Total amount to spend</Text>
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
                You will allocate this amount between people next.
              </Text>
            </View>
          )}

          <Button
            onPress={handleCreate}
            loading={saving}
            style={styles.createBtn}
            disabled={!canProceed}
          >
            Continue
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
  secondaryOptionsToggle: {
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  secondaryOptionsText: {
    ...Typography.bodyMedium,
    color: Colors.primary[700],
  },
  secondaryOptions: {
    backgroundColor: Colors.neutral[50],
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  } as ViewStyle,
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
  peopleSection: {
    marginBottom: Spacing.md,
  },
  peopleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  peopleCount: {
    ...Typography.small,
    color: Colors.neutral[500],
  },
  peopleEmptyText: {
    ...Typography.small,
    color: Colors.neutral[500],
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  addPersonBtn: {
    alignSelf: 'flex-start',
  },
  personItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  } as ViewStyle,
  personItemSelected: {
    borderColor: Colors.primary[600],
    backgroundColor: Colors.primary[50],
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  personMeta: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
    textTransform: 'capitalize',
  },
  personAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.neutral[300],
    borderRadius: 8,
    backgroundColor: '#fff',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  } as ViewStyle,
  personAmountPrefix: {
    ...Typography.bodyMedium,
    color: Colors.neutral[700],
  },
  personAmountInput: {
    minWidth: 90,
    paddingVertical: 8,
    paddingHorizontal: Spacing.xs,
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
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
