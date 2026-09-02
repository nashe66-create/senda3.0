import {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';

import {
  useLocalSearchParams,
  router,
  useFocusEffect,
} from 'expo-router';

import {
  ArrowLeft,
  Smartphone,
  Building2,
  Wallet,
  Receipt,
  Trash2,
  RefreshCw,
} from 'lucide-react-native';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';

import {
  Colors,
  Spacing,
  Typography,
  RECEIVING_METHODS,
  COUNTRY_DIAL_CODES,
} from '@/lib/theme';

import {
  fetchRecipient,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  fetchCorridorCountries,
  fetchCorridorNetworks,
  fetchCorridorBanks,
  createFlutterwaveRecipient,
  updateFlutterwaveRecipient,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';

import {
  ReceivingMethod,
  Recipient,
  PayoutCorridorCountry,
  PayoutCorridorNetwork,
  PayoutCorridorBank,
} from '@/types/database';
import { AlertCircle } from 'lucide-react-native';

/* =========================================================
   ICONS
   ========================================================= */

const methodIcons: Record<
  ReceivingMethod,
  typeof Smartphone
> = {
  mobile_money: Smartphone,
  bank_account: Building2,
  cash_pickup: Wallet,
  bill_payment: Receipt,
};

/* =========================================================
   SAFE HELPERS
   ========================================================= */

function safeArray<T>(
  value: unknown
): T[] {
  return Array.isArray(value)
    ? value as T[]
    : [];
}

function stringValue(
  value: unknown
): string {
  if (
    typeof value === 'string'
  ) {
    return value.trim();
  }

  if (
    typeof value === 'number'
  ) {
    return String(value);
  }

  return '';
}

function uniqueKey(
  prefix: string,
  item: any,
  index: number
): string {
  const id =
    stringValue(item?.id);

  const code =
    stringValue(item?.code);

  const name =
    stringValue(item?.name);

  return [
    prefix,
    id || 'no-id',
    code || 'no-code',
    name || 'no-name',
    index,
  ].join('-');
}

function getItemCode(
  item: any
): string {
  return (
    stringValue(item?.code) ||
    stringValue(item?.id)
  );
}

function getItemName(
  item: any
): string {
  return (
    stringValue(item?.name) ||
    getItemCode(item)
  );
}

/* =========================================================
   SCREEN
   ========================================================= */

export default function RecipientDetailScreen() {
  const {
    id,
    plan_id,
    destination_country,
    destination_currency,
  } =
    useLocalSearchParams<{
      id: string;
      plan_id?: string;
      destination_country?: string;
      destination_currency?: string;
    }>();

  const isNew =
    id === 'new';

  // Plan corridor lock only ever applies when creating a brand-new recipient
  const fromPlan = isNew && !!plan_id;
  const lockedCountry = fromPlan && destination_country ? destination_country : null;
  const lockedCurrency = fromPlan && destination_currency ? destination_currency : null;

  /* =======================================================
     RECIPIENT
     ======================================================= */

  const [
    name,
    setName,
  ] = useState('');

  const [
    country,
    setCountry,
  ] = useState('');

  const [
    currency,
    setCurrency,
  ] = useState('');

  const [
    receivingMethod,
    setReceivingMethod,
  ] =
    useState<ReceivingMethod>(
      'mobile_money'
    );

  const [
    phone,
    setPhone,
  ] = useState('');

  const [
    mobileMoneyProvider,
    setMobileMoneyProvider,
  ] = useState('');

  const [
    bankCode,
    setBankCode,
  ] = useState('');

  const [
    accountNumber,
    setAccountNumber,
  ] = useState('');

  const [
    billType,
    setBillType,
  ] = useState('');

  const [
    relationship,
    setRelationship,
  ] = useState('');

  const [
    notes,
    setNotes,
  ] = useState('');

  /* =======================================================
     FLUTTERWAVE IDS
     ======================================================= */

  const [
    flutterwaveRecipientId,
    setFlutterwaveRecipientId,
  ] =
    useState<string | null>(
      null
    );

  const [
    flutterwaveNetworkCode,
    setFlutterwaveNetworkCode,
  ] =
    useState<string | null>(
      null
    );

  const [
    flutterwaveBankName,
    setFlutterwaveBankName,
  ] =
    useState<string | null>(
      null
    );

  const [
    verificationStatus,
    setVerificationStatus,
  ] =
    useState<Recipient['verification_status']>(
      'pending'
    );

  const [
    validationErrorMessage,
    setValidationErrorMessage,
  ] =
    useState<string | null>(
      null
    );

  /* =======================================================
     OPTIONS
     ======================================================= */

  const [
    corridorCountries,
    setCorridorCountries,
  ] =
    useState<PayoutCorridorCountry[]>(
      []
    );

  const [
    corridorNetworks,
    setCorridorNetworks,
  ] =
    useState<PayoutCorridorNetwork[]>(
      []
    );

  const [
    corridorBanks,
    setCorridorBanks,
  ] =
    useState<PayoutCorridorBank[]>(
      []
    );

  const [
    optionsLoading,
    setOptionsLoading,
  ] =
    useState(false);

  const [
    optionsError,
    setOptionsError,
  ] =
    useState<string | null>(
      null
    );

  /* =======================================================
     GENERAL
     ======================================================= */

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    activePayouts,
    setActivePayouts,
  ] =
    useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(!isNew);

  const loadRequestRef = useRef(0);

  /* =======================================================
     LOAD ALL DESTINATIONS
     ======================================================= */

  const loadAllOptions =
    useCallback(
      async () => {
        setOptionsLoading(
          true
        );

        setOptionsError(
          null
        );

        try {
          const data =
            await fetchCorridorCountries();

          setCorridorCountries(
            data
          );
        } catch (e: any) {
          console.error(
            'Failed to load corridor countries:',
            e
          );

          setOptionsError(
            e?.message ||
              'Unable to load payout destinations. Run corridor sync from Settings.'
          );
        } finally {
          setOptionsLoading(
            false
          );
        }
      },
      []
    );

  /* =======================================================
     LOAD COUNTRY OPTIONS
     ======================================================= */

  const loadCountryOptions =
    useCallback(
      async (
        selectedCountry: string,
        requestId?: number
      ) => {
        if (
          !selectedCountry
        ) {
          return;
        }

        setOptionsLoading(
          true
        );

        setOptionsError(
          null
        );

        try {
          const networks =
            await fetchCorridorNetworks(
              selectedCountry
            );

          if (requestId !== undefined && requestId !== loadRequestRef.current) return;

          setCorridorNetworks(
            networks
          );

          const banks =
            await fetchCorridorBanks(
              selectedCountry
            );

          if (requestId !== undefined && requestId !== loadRequestRef.current) return;

          setCorridorBanks(
            banks
          );

        } catch (e: any) {
          console.error(
            'Failed to load country networks:',
            e
          );

          setOptionsError(
            e?.message ||
              'Unable to load payout options'
          );

          setCorridorNetworks(
            []
          );

          setCorridorBanks(
            []
          );
        } finally {
          setOptionsLoading(
            false
          );
        }
      },
      []
    );

  /* =======================================================
     LOAD EXISTING RECIPIENT
     ======================================================= */

  const loadRecipient =
    useCallback(
      async () => {
        const requestId = ++loadRequestRef.current;

        try {
          if (isNew) {
            await loadAllOptions();
            return;
          }

          if (!id) return;

          const data =
            await fetchRecipient(
              id
            );

          if (data) {
            setName(
              data.name
            );

            setCountry(
              data.country
            );

            setCurrency(
              data.currency ||
                ''
            );

            setReceivingMethod(
              data.receiving_method
            );

            setPhone(
              data.phone ||
                ''
            );

            setMobileMoneyProvider(
              data.mobile_money_provider ||
                ''
            );

            setBankCode(
              data.bank_code ||
                ''
            );

            setAccountNumber(
              data.account_number ||
                ''
            );

            setBillType(
              data.bill_type ||
                ''
            );

            setRelationship(
              data.relationship ||
                ''
            );

            setNotes(
              data.notes ||
                ''
            );

            setFlutterwaveRecipientId(
              data.flutterwave_recipient_id ??
                null
            );

            setFlutterwaveNetworkCode(
              data.flutterwave_network_code ??
                null
            );

            setFlutterwaveBankName(
              data.flutterwave_bank_name ??
                null
            );

            setVerificationStatus(
              data.verification_status ??
                'pending'
            );

            setValidationErrorMessage(
              data.validation_error_message ??
                null
            );

            const countries =
              await fetchCorridorCountries();

            if (requestId !== loadRequestRef.current) return;

            setCorridorCountries(
              countries
            );

            if (!countries.some((item) => item.country_code === data.country)) {
              setOptionsError(
                "This recipient's saved destination is no longer available in the current corridor data. Review the destination before saving."
              );
              return;
            }

            await loadCountryOptions(
              data.country,
              requestId
            );
          }
        } catch (e) {
          console.error(
            'Failed to load recipient:',
            e
          );

          setError(
            'Failed to load recipient'
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        id,
        isNew,
        loadAllOptions,
        loadCountryOptions,
      ]
    );

  useFocusEffect(
    useCallback(
      () => {
        loadRecipient();
      },
      [
        loadRecipient,
      ]
    )
  );

  // Check for active/pending payouts using this recipient
  useEffect(() => {
    if (isNew || !id) return;
    (async () => {
      try {
        const { count } = await supabase
          .from('commitments')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', id)
          .in('status', ['ready', 'submitted', 'processing']);
        setActivePayouts((count ?? 0) > 0);
      } catch {
        setActivePayouts(false);
      }
    })();
  }, [id, isNew]);

  // Plan-launched: lock the country/currency to the plan corridor once corridor data has loaded
  useEffect(() => {
    if (isNew && lockedCountry && !country && corridorCountries.length > 0) {
      handleCountryChange(lockedCountry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, lockedCountry, corridorCountries]);

  /* =======================================================
     DESTINATIONS
     ======================================================= */

  const countries =
    corridorCountries
      .filter(
        (c) =>
          !lockedCountry ||
          c.country_code ===
            lockedCountry
      )
      .map(
      (c) => ({
        code: c.country_code,
        name: c.country_name,
        currency: c.currency,
        flag: undefined,
      })
    );

  const mobileNetworks =
    corridorNetworks.map(
      (n) => ({
        code: n.network_code,
        name: n.network_name,
        currency: undefined,
      })
    );

  const currencies: { code: string; name?: string }[] =
    country
      ? corridorCountries
          .filter(
            (c) =>
              c.country_code ===
              country &&
              !!c.currency
          )
          .map((c) => ({
            code: c.currency,
            name: c.currency,
          }))
      : [];

  const banks: any[] = corridorBanks.map(
    (b) => ({
      code: b.bank_code,
      name: b.bank_name,
      currency: undefined,
    })
  );

  const selectedCorridorCountry =
    corridorCountries.find(
      (c) => c.country_code === country
    );

  const payoutMethods: string[] =
    !country
      ? ['mobile_money', 'bank_account']
      : [
          ...(selectedCorridorCountry?.mobile_money_supported ? ['mobile_money'] : []),
          ...(selectedCorridorCountry?.bank_supported ? ['bank_account'] : []),
        ];

  // Switch away from a receiving method the selected country no longer supports.
  useEffect(() => {
    if (!country || payoutMethods.length === 0) return;
    if (!payoutMethods.includes(receivingMethod)) {
      handleReceivingMethodChange(payoutMethods[0] as ReceivingMethod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, selectedCorridorCountry?.mobile_money_supported, selectedCorridorCountry?.bank_supported]);

  /* =======================================================
     SELECT COUNTRY
     ======================================================= */

  const handleCountryChange =
    async (
      newCountry: string
    ) => {
      if (
        !newCountry ||
        newCountry === country
      ) {
        return;
      }

      setCountry(
        newCountry
      );

      setCurrency(
        ''
      );

      setMobileMoneyProvider(
        ''
      );

      setBankCode(
        ''
      );

      setFlutterwaveNetworkCode(
        null
      );

      setFlutterwaveBankName(
        null
      );

      setFlutterwaveRecipientId(
        null
      );

      await loadCountryOptions(
        newCountry
      );
    };

  /* =======================================================
     SELECT METHOD
     ======================================================= */

  const handleReceivingMethodChange =
    (
      method: ReceivingMethod
    ) => {
      setReceivingMethod(
        method
      );

      if (
        method !==
        'mobile_money'
      ) {
        setMobileMoneyProvider(
          ''
        );

        setFlutterwaveNetworkCode(
          null
        );
      }

      if (
        method !==
        'bank_account'
      ) {
        setBankCode(
          ''
        );

        setFlutterwaveBankName(
          null
        );
      }
    };

  /* =======================================================
     SELECT CURRENCY
     ======================================================= */

  const handleCurrencyChange =
    (
      selectedCurrency: string
    ) => {
      setCurrency(
        selectedCurrency
      );

      setMobileMoneyProvider(
        ''
      );

      setBankCode(
        ''
      );

      setFlutterwaveNetworkCode(
        null
      );

      setFlutterwaveBankName(
        null
      );

      setFlutterwaveRecipientId(
        null
      );
    };

  /* =======================================================
     SELECT MOBILE NETWORK
     ======================================================= */

  const handleMobileNetworkSelect =
    (
      network: { code?: string; name?: string; currency?: string }
    ) => {
      const code =
        stringValue(
          network?.code
        );

      const name =
        stringValue(
          network?.name
        ) || code;

      if (!code) {
        setError(
          'This mobile network is not available'
        );

        return;
      }

      setFlutterwaveNetworkCode(
        code
      );

      setMobileMoneyProvider(
        name
      );

      setFlutterwaveRecipientId(
        null
      );

      setError(
        null
      );
    };

  /* =======================================================
     SELECT BANK
     ======================================================= */

  const handleBankSelect =
    (
      bank: { code?: string; name?: string; currency?: string }
    ) => {
      const code =
        stringValue(
          bank?.code
        );

      const name =
        stringValue(
          bank?.name
        ) || code;

      if (!code) {
        setError(
          'This bank is not available'
        );

        return;
      }

      setBankCode(
        code
      );

      setFlutterwaveBankName(
        name
      );

      setFlutterwaveRecipientId(
        null
      );

      setError(
        null
      );
    };

  /* =======================================================
     SAVE
     ======================================================= */

  const handleSave =
    async () => {
      setError(
        null
      );

      if (
        !name.trim()
      ) {
        setError(
          'Please enter a recipient name'
        );

        return;
      }

      if (
        !country
      ) {
        setError(
          'Please select a destination country'
        );

        return;
      }

      if (
        !selectedCorridorCountry?.currency
      ) {
        setError(
          'Destination currency is unavailable for this destination. Please try again later.'
        );

        return;
      }

      /*
       * Currency is only required when Flutterwave
       * actually provides currency choices.
       *
       * If there is no currency list, we don't
       * ask the user to select one.
       */
      if (
        currencies.length > 0 &&
        !currency
      ) {
        setError(
          'Please select a currency'
        );

        return;
      }

      if (
        receivingMethod ===
        'mobile_money'
      ) {
        if (
          !mobileMoneyProvider ||
          !flutterwaveNetworkCode
        ) {
          setError(
            'Please select a mobile money provider'
          );

          return;
        }

        if (
          !phone.trim()
        ) {
          setError(
            'Please enter the recipient phone number'
          );

          return;
        }
      }

      if (
        receivingMethod ===
        'bank_account'
      ) {
        if (
          !bankCode
        ) {
          setError(
            'Please select a bank'
          );

          return;
        }

        if (
          !accountNumber.trim()
        ) {
          setError(
            'Please enter the account number'
          );

          return;
        }
      }

      setSaving(
        true
      );

      try {
        const data:
          Partial<Recipient> =
          {
            name:
              name.trim(),

            country,

            /*
             * If no currency is returned by Flutterwave,
             * save null/empty rather than inventing one.
             */
            currency:
              currency ||
              null,

            receiving_method:
              receivingMethod,

            phone:
              phone.trim(),

            mobile_money_provider:
              mobileMoneyProvider,

            bank_code:
              bankCode.trim(),

            account_number:
              accountNumber.trim(),

            bill_type:
              billType.trim(),

            relationship:
              relationship.trim(),

            notes:
              notes.trim(),

            flutterwave_recipient_id:
              flutterwaveRecipientId,

            flutterwave_network_code:
              flutterwaveNetworkCode,

            flutterwave_bank_name:
              flutterwaveBankName,

            payout_type:
              receivingMethod === 'mobile_money'
                ? 'mobile_money'
                : null,

            mobile_money_network:
              flutterwaveNetworkCode,

            destination_country:
              country || null,
          };

        let savedRecipient: Recipient;

        if (isNew) {
          savedRecipient = await createRecipient(
            data
          );
        } else {
          savedRecipient = await updateRecipient(
            id,
            data
          );
        }

        // Create or update Flutterwave recipient object
        if (receivingMethod === 'mobile_money' || receivingMethod === 'bank_account') {
          const flwParams = {
            recipientId: savedRecipient.id,
            receivingMethod,
            currency: currency || '',
            mobileMoney: receivingMethod === 'mobile_money'
              ? {
                  network: flutterwaveNetworkCode || mobileMoneyProvider,
                  msisdn: phone.trim(),
                  country,
                }
              : undefined,
            bankAccount: receivingMethod === 'bank_account'
              ? {
                  account_number: accountNumber.trim(),
                  bank_code: bankCode.trim(),
                  country,
                }
              : undefined,
          };

          const flwResult = isNew
            ? await createFlutterwaveRecipient(flwParams)
            : await updateFlutterwaveRecipient(flwParams);

          if (!flwResult.success) {
            const title =
              receivingMethod === 'mobile_money'
                ? 'Mobile money details need updating'
                : 'Bank details need updating';
            const message =
              receivingMethod === 'mobile_money'
                ? "We couldn't verify the mobile money network for this recipient. Please select the correct mobile network and try again."
                : "We couldn't verify the bank details for this recipient. Please check the bank and account number and try again.";
            setVerificationStatus('needs_attention');
            setValidationErrorMessage(message);
            setError(`${title}. ${message}`);
            setSaving(false);
            return;
          }
        }

        if (isNew && fromPlan) {
          router.setParams({ created_recipient_id: savedRecipient.id });
        }

        router.back();
      } catch (e: any) {
        console.error(
          'Failed to save recipient:',
          e
        );

        setError(
          e?.message ||
            'Failed to save recipient'
        );

        setSaving(
          false
        );
      }
    };

  /* =======================================================
     DELETE
     ======================================================= */

  const handleDelete =
    () => {
      Alert.alert(
        'Delete Recipient',
        'Are you sure you want to delete this recipient?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },

          {
            text: 'Delete',
            style: 'destructive',

            onPress:
              async () => {
                try {
                  await deleteRecipient(
                    id
                  );

                  router.back();
                } catch (
                  e: any
                ) {
                  setError(
                    e?.message ||
                      'Failed to delete recipient'
                  );
                }
              },
          },
        ]
      );
    };

  /* =======================================================
     LOADING
     ======================================================= */

  if (loading) {
    return <Loading />;
  }

  /* =======================================================
     FILTER OPTIONS
     ======================================================= */

  const filteredMobileNetworks =
    mobileNetworks.filter(
      (
        network
      ) => {
        if (
          !currency
        ) {
          return true;
        }

        const networkCurrency =
          stringValue(
            network?.currency
          );

        if (
          !networkCurrency
        ) {
          return true;
        }

        return (
          networkCurrency.toUpperCase() ===
          currency.toUpperCase()
        );
      }
    );

  const filteredBanks =
    banks.filter(
      (bank) => {
        if (
          !currency
        ) {
          return true;
        }

        const bankCurrency =
          stringValue(
            bank?.currency
          );

        if (
          !bankCurrency
        ) {
          return true;
        }

        return (
          bankCurrency.toUpperCase() ===
          currency.toUpperCase()
        );
      }
    );

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <KeyboardAvoidingView
      style={
        styles.container
      }
      behavior={
        Platform.OS ===
        'ios'
          ? 'padding'
          : undefined
      }
    >
      {/* HEADER */}

      <View
        style={
          styles.header
        }
      >
        <TouchableOpacity
          onPress={() =>
            router.back()
          }
          style={
            styles.backBtn
          }
        >
          <ArrowLeft
            color={
              Colors
                .neutral[700]
            }
            size={24}
          />
        </TouchableOpacity>

        <Text
          style={
            styles.headerTitle
          }
        >
          {isNew
            ? 'Add Recipient'
            : 'Edit Recipient'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={
          false
        }
      >
        <View
          style={
            styles.form
          }
        >
          {/* ERROR */}

          {error && (
            <View
              style={
                styles.errorBox
              }
            >
              <Text
                style={
                  styles.errorText
                }
              >
                {error}
              </Text>
            </View>
          )}

          {/* NEEDS ATTENTION */}

          {!isNew && verificationStatus === 'needs_attention' && (
            <View
              style={
                styles.activePayoutWarningBox
              }
            >
              <AlertCircle
                color={
                  Colors.error[600]
                }
                size={18}
              />
              <Text
                style={
                  styles.activePayoutWarningText
                }
              >
                Needs attention: {validationErrorMessage ?? 'Update recipient details before using this recipient.'}
              </Text>
            </View>
          )}

          {/* ACTIVE PAYOUT WARNING */}

          {activePayouts && !isNew && (
            <View
              style={
                styles.activePayoutWarningBox
              }
            >
              <AlertCircle
                color={
                  Colors.warning[600]
                }
                size={18}
              />
              <Text
                style={
                  styles.activePayoutWarningText
                }
              >
                This recipient has an active payout in progress. Any changes you make will apply to future transactions only, not the current in-flight payout.
              </Text>
            </View>
          )}

          {/* NAME */}

          <Input
            label="Recipient name"
            value={name}
            onChangeText={
              setName
            }
            placeholder="e.g. John Mukamuri"
            autoCapitalize="words"
          />

          {/* RELATIONSHIP */}

          <Input
            label="Relationship (optional)"
            value={
              relationship
            }
            onChangeText={
              setRelationship
            }
            placeholder="e.g. family, friend"
            autoCapitalize="words"
          />

          {/* DESTINATION COUNTRY */}

          <Text
            style={
              styles.label
            }
          >
            Destination country
          </Text>

          {fromPlan && lockedCountry && (
            <Text style={styles.mutedText}>
              This plan sends to {lockedCountry}
              {lockedCurrency ? ` (${lockedCurrency})` : ''}. The recipient must use the same destination.
            </Text>
          )}

          {!isNew && optionsError && countries.length > 0 && (
            <Text style={styles.mutedText}>
              {optionsError}
            </Text>
          )}

          {optionsLoading &&
            countries.length ===
              0 && (
              <Text
                style={
                  styles.mutedText
                }
              >
                Loading available destinations...
              </Text>
            )}

          {!optionsLoading &&
            countries.length ===
              0 && (
              <View
                style={
                  styles.emptyOptionsBox
                }
              >
                <Text
                  style={
                    styles.emptyOptionsText
                  }
                >
                  {optionsError ?? 'No payout destinations are currently available.'}
                </Text>
              </View>
            )}

          {countries.length >
            0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={
                false
              }
              style={
                styles.countryScroll
              }
              contentContainerStyle={
                styles.countryScrollContent
              }
            >
              {countries.map(
                (
                  item,
                  index
                ) => {
                  const code =
                    getItemCode(
                      item
                    );

                  const name =
                    getItemName(
                      item
                    );

                  if (!code)
                    return null;

                  const selected =
                    country.toUpperCase() ===
                    code.toUpperCase();

                  return (
                    <TouchableOpacity
                      key={uniqueKey(
                        'country',
                        item,
                        index
                      )}
                      onPress={() =>
                        !lockedCountry &&
                        handleCountryChange(
                          code
                        )
                      }
                      disabled={!!lockedCountry}
                      style={[
                        styles.countryChip,

                        selected &&
                          styles.countryChipSelected,
                      ]}
                    >
                      <Text
                        style={
                          styles.countryChipText
                        }
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>
          )}

          {/* COUNTRY ERROR */}

          {optionsError &&
            !optionsLoading && (
              <TouchableOpacity
                onPress={() => {
                  if (
                    country
                  ) {
                    loadCountryOptions(
                      country
                    );
                  } else {
                    loadAllOptions();
                  }
                }}
                style={
                  styles.optionsErrorBox
                }
              >
                <RefreshCw
                  color={
                    Colors
                      .error[600]
                  }
                  size={18}
                />

                <View
                  style={
                    styles.optionsErrorContent
                  }
                >
                  <Text
                    style={
                      styles.optionsErrorTitle
                    }
                  >
                    Unable to load payout options
                  </Text>

                  <Text
                    style={
                      styles.optionsErrorText
                    }
                  >
                    Tap to try again
                  </Text>
                </View>
              </TouchableOpacity>
            )}

          {/* COUNTRY OPTIONS LOADING */}

          {country &&
            optionsLoading && (
            <View
              style={
                styles.optionsLoadingBox
              }
            >
              <Text
                style={
                  styles.optionsLoadingText
                }
              >
                Loading available payout options...
              </Text>
            </View>
          )}

          {/* CURRENCY */}

          {country &&
            currencies.length >
              1 && (
              <>
                <Text
                  style={
                    styles.label
                  }
                >
                  Currency
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={
                    false
                  }
                  style={
                    styles.currencyScroll
                  }
                  contentContainerStyle={
                    styles.currencyScrollContent
                  }
                >
                  {currencies.map(
                    (
                      item,
                      index
                    ) => {
                      const code =
                        stringValue(
                          item?.code
                        );

                      if (!code)
                        return null;

                      const selected =
                        currency.toUpperCase() ===
                        code.toUpperCase();

                      return (
                        <TouchableOpacity
                          key={uniqueKey(
                            'currency',
                            item,
                            index
                          )}
                          onPress={() =>
                            handleCurrencyChange(
                              code
                            )
                          }
                          style={[
                            styles.currencyChip,

                            selected &&
                              styles.currencyChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.currencyChipText,

                              selected &&
                                styles.currencyChipTextSelected,
                            ]}
                          >
                            {code}
                          </Text>

                          {item?.name && (
                            <Text
                              style={
                                styles.currencyName
                              }
                            >
                              {
                                item.name
                              }
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    }
                  )}
                </ScrollView>
              </>
            )}

          {/* RECEIVING METHOD */}

          <Text
            style={
              styles.label
            }
          >
            Receiving method
          </Text>

          {country && payoutMethods.length === 0 && (
            <View style={styles.emptyOptionsBox}>
              <Text style={styles.emptyOptionsText}>
                No payout methods are currently available for this destination.
              </Text>
            </View>
          )}

          <View
            style={
              styles.methodRow
            }
          >
            {RECEIVING_METHODS.filter(
              (method) =>
                payoutMethods.includes(method.value)
            ).map(
              (
                method
              ) => {
                const Icon =
                  methodIcons[
                    method.value
                  ];

                const selected =
                  receivingMethod ===
                  method.value;

                return (
                  <TouchableOpacity
                    key={
                      method.value
                    }
                    onPress={() =>
                      handleReceivingMethodChange(
                        method.value
                      )
                    }
                    style={[
                      styles.methodChip,

                      selected &&
                        styles.methodChipSelected,
                    ]}
                  >
                    <Icon
                      color={
                        selected
                          ? Colors
                              .primary[600]
                          : Colors
                              .neutral[500]
                      }
                      size={18}
                    />

                    <Text
                      style={[
                        styles.methodChipText,

                        selected &&
                          styles.methodChipTextSelected,
                      ]}
                    >
                      {
                        method.label
                      }
                    </Text>
                  </TouchableOpacity>
                );
              }
            )}
          </View>

          {/* =================================================
              MOBILE MONEY
              ================================================= */}

          {receivingMethod ===
            'mobile_money' && (
            <>
              <Text
                style={
                  styles.label
                }
              >
                Mobile money provider
              </Text>

              {filteredMobileNetworks.length ===
                0 ? (
                <View
                  style={
                    styles.emptyOptionsBox
                  }
                >
                  <Text
                    style={
                      styles.emptyOptionsText
                    }
                  >
                    No mobile money providers are currently available for this destination.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={
                    false
                  }
                  style={
                    styles.providerScroll
                  }
                  contentContainerStyle={
                    styles.providerScrollContent
                  }
                >
                  {filteredMobileNetworks.map(
                    (
                      network,
                      index
                    ) => {
                      const code =
                        getItemCode(
                          network
                        );

                      const name =
                        getItemName(
                          network
                        );

                      if (
                        !code
                      ) {
                        return null;
                      }

                      const selected =
                        flutterwaveNetworkCode ===
                        code;

                      return (
                        <TouchableOpacity
                          key={uniqueKey(
                            'mobile-network',
                            network,
                            index
                          )}
                          onPress={() =>
                            handleMobileNetworkSelect(
                              network
                            )
                          }
                          style={[
                            styles.providerChip,

                            selected &&
                              styles.providerChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.providerChipText,

                              selected &&
                                styles.providerChipTextSelected,
                            ]}
                          >
                            {name}
                          </Text>
                        </TouchableOpacity>
                      );
                    }
                  )}
                </ScrollView>
              )}

              <View style={styles.phoneRow}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>
                    {COUNTRY_DIAL_CODES[country] || '+'}
                  </Text>
                </View>
                <View style={styles.phoneInputWrap}>
                  <Input
                    label="Recipient phone number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="77 123 4567"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            </>
          )}

          {/* =================================================
              BANK
              ================================================= */}

          {receivingMethod ===
            'bank_account' && (
            <>
              <Text
                style={
                  styles.label
                }
              >
                Bank
              </Text>

              {filteredBanks.length ===
                0 ? (
                <View
                  style={
                    styles.emptyOptionsBox
                  }
                >
                  <Text
                    style={
                      styles.emptyOptionsText
                    }
                  >
                    No banks are currently available for this destination.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={
                    false
                  }
                  style={
                    styles.providerScroll
                  }
                  contentContainerStyle={
                    styles.providerScrollContent
                  }
                >
                  {filteredBanks.map(
                    (
                      bank,
                      index
                    ) => {
                      const code =
                        getItemCode(
                          bank
                        );

                      const name =
                        getItemName(
                          bank
                        );

                      if (
                        !code
                      ) {
                        return null;
                      }

                      const selected =
                        bankCode ===
                        code;

                      return (
                        <TouchableOpacity
                          key={uniqueKey(
                            'bank',
                            bank,
                            index
                          )}
                          onPress={() =>
                            handleBankSelect(
                              bank
                            )
                          }
                          style={[
                            styles.providerChip,

                            selected &&
                              styles.providerChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.providerChipText,

                              selected &&
                                styles.providerChipTextSelected,
                            ]}
                          >
                            {name}
                          </Text>
                        </TouchableOpacity>
                      );
                    }
                  )}
                </ScrollView>
              )}

              <Input
                label="Account number"
                value={
                  accountNumber
                }
                onChangeText={
                  setAccountNumber
                }
                placeholder="0123456789"
                keyboardType="numeric"
              />
            </>
          )}

          {/* =================================================
              CASH
              ================================================= */}

          {receivingMethod ===
            'cash_pickup' && (
            <Input
              label="Recipient phone"
              value={phone}
              onChangeText={
                setPhone
              }
              placeholder="+263 77 123 4567"
              keyboardType="phone-pad"
            />
          )}

          {/* =================================================
              BILL
              ================================================= */}

          {receivingMethod ===
            'bill_payment' && (
            <Input
              label="Bill type"
              value={
                billType
              }
              onChangeText={
                setBillType
              }
              placeholder="e.g. electricity, water, DSTV"
              autoCapitalize="words"
            />
          )}

          {/* NOTES */}

          <Input
            label="Notes (optional)"
            value={
              notes
            }
            onChangeText={
              setNotes
            }
            placeholder="Any additional details"
            autoCapitalize="sentences"
          />

          {/* SAVE */}

          <Button
            onPress={
              handleSave
            }
            loading={
              saving
            }
            style={
              styles.saveBtn
            }
          >
            {isNew
              ? 'Add Recipient'
              : 'Save Changes'}
          </Button>

          {/* DELETE */}

          {!isNew && (
            <TouchableOpacity
              onPress={
                handleDelete
              }
              style={
                styles.deleteBtn
              }
            >
              <Trash2
                color={
                  Colors
                    .error[500]
                }
                size={16}
              />

              <Text
                style={
                  styles.deleteBtnText
                }
              >
                Delete Recipient
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* =========================================================
   STYLES
   ========================================================= */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        Colors.neutral[50],
    },

    header: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: Spacing.sm,
      paddingTop: 60,
      paddingHorizontal:
        Spacing.md,
      paddingBottom:
        Spacing.sm,
    },

    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor:
        '#fff',
      alignItems:
        'center',
      justifyContent:
        'center',
      elevation: 2,
    },

    headerTitle: {
      ...Typography.h2,
      color:
        Colors.neutral[900],
    },

    scrollContent: {
      flexGrow: 1,
    },

    form: {
      backgroundColor:
        '#fff',
      flex: 1,
      borderTopLeftRadius:
        24,
      borderTopRightRadius:
        24,
      paddingHorizontal:
        Spacing.lg,
      paddingTop:
        Spacing.xl,
      paddingBottom:
        Spacing.xxl,
    },

    errorBox: {
      backgroundColor:
        Colors.error[50],
      borderRadius: 12,
      padding:
        Spacing.md,
      marginBottom:
        Spacing.md,
    },

    errorText: {
      ...Typography.caption,
      color:
        Colors.error[700],
    },

    activePayoutWarningBox: {
      flexDirection:
        'row',
      alignItems:
        'flex-start',
      gap: Spacing.sm,
      backgroundColor:
        Colors.warning[50],
      borderWidth: 1,
      borderColor:
        Colors.warning[100],
      borderRadius: 12,
      padding:
        Spacing.md,
      marginBottom:
        Spacing.md,
    },

    activePayoutWarningText: {
      ...Typography.small,
      color:
        Colors.warning[700],
      flex: 1,
      lineHeight: 20,
    },

    label: {
      ...Typography.label,
      color:
        Colors.neutral[700],
      marginBottom:
        Spacing.sm,
      marginTop:
        Spacing.sm,
    },

    mutedText: {
      ...Typography.small,
      color:
        Colors.neutral[500],
      marginBottom:
        Spacing.md,
    },

    countryScroll: {
      marginBottom:
        Spacing.md,
    },

    countryScrollContent: {
      gap: Spacing.sm,
      paddingRight:
        Spacing.lg,
    },

    countryChip: {
      paddingVertical: 10,
      paddingHorizontal:
        Spacing.md,
      borderWidth: 1.5,
      borderColor:
        Colors.neutral[300],
      borderRadius: 999,
    },

    countryChipSelected: {
      borderColor:
        Colors.primary[600],
      backgroundColor:
        Colors.primary[50],
    },

    countryChipText: {
      ...Typography.caption,
      color:
        Colors.neutral[700],
    },

    currencyScroll: {
      marginBottom:
        Spacing.md,
    },

    currencyScrollContent: {
      gap: Spacing.sm,
      paddingRight:
        Spacing.lg,
    },

    currencyChip: {
      minWidth: 90,
      paddingVertical: 10,
      paddingHorizontal:
        Spacing.md,
      borderWidth: 1.5,
      borderColor:
        Colors.neutral[300],
      borderRadius: 12,
    },

    currencyChipSelected: {
      borderColor:
        Colors.primary[600],
      backgroundColor:
        Colors.primary[50],
    },

    currencyChipText: {
      ...Typography.bodyMedium,
      color:
        Colors.neutral[700],
    },

    currencyChipTextSelected: {
      color:
        Colors.primary[700],
    },

    currencyName: {
      ...Typography.small,
      color:
        Colors.neutral[500],
      marginTop: 2,
    },

    methodRow: {
      flexDirection:
        'row',
      flexWrap:
        'wrap',
      gap: Spacing.sm,
      marginBottom:
        Spacing.md,
    },

    methodChip: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal:
        Spacing.md,
      borderWidth: 1.5,
      borderColor:
        Colors.neutral[300],
      borderRadius: 12,
    },

    methodChipSelected: {
      borderColor:
        Colors.primary[600],
      backgroundColor:
        Colors.primary[50],
    },

    methodChipText: {
      ...Typography.caption,
      color:
        Colors.neutral[600],
    },

    methodChipTextSelected: {
      color:
        Colors.primary[700],
      fontFamily:
        'Inter-SemiBold',
    },

    providerScroll: {
      marginBottom:
        Spacing.md,
    },

    providerScrollContent: {
      gap: Spacing.sm,
      paddingRight:
        Spacing.lg,
    },

    providerChip: {
      paddingVertical: 10,
      paddingHorizontal:
        Spacing.md,
      borderWidth: 1.5,
      borderColor:
        Colors.neutral[300],
      borderRadius: 999,
    },

    providerChipSelected: {
      borderColor:
        Colors.primary[600],
      backgroundColor:
        Colors.primary[50],
    },

    providerChipText: {
      ...Typography.caption,
      color:
        Colors.neutral[600],
    },

    providerChipTextSelected: {
      color:
        Colors.primary[700],
      fontFamily:
        'Inter-SemiBold',
    },

    optionsLoadingBox: {
      backgroundColor:
        Colors.primary[50],
      borderRadius: 12,
      padding:
        Spacing.md,
      marginBottom:
        Spacing.md,
    },

    optionsLoadingText: {
      ...Typography.small,
      color:
        Colors.primary[700],
    },

    optionsErrorBox: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: Spacing.sm,
      backgroundColor:
        Colors.error[50],
      borderRadius: 12,
      padding:
        Spacing.md,
      marginBottom:
        Spacing.md,
    },

    optionsErrorContent: {
      flex: 1,
    },

    optionsErrorTitle: {
      ...Typography.caption,
      color:
        Colors.error[700],
    },

    optionsErrorText: {
      ...Typography.small,
      color:
        Colors.error[600],
      marginTop: 2,
    },

    emptyOptionsBox: {
      backgroundColor:
        Colors.neutral[50],
      borderRadius: 12,
      padding:
        Spacing.md,
      marginBottom:
        Spacing.md,
    },

    emptyOptionsText: {
      ...Typography.small,
      color:
        Colors.neutral[500],
    },

    saveBtn: {
      marginTop:
        Spacing.lg,
      width: '100%',
    },

    deleteBtn: {
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 8,
      marginTop:
        Spacing.lg,
      paddingVertical: 14,
    },

    deleteBtnText: {
      ...Typography.bodyMedium,
      color:
        Colors.error[600],
    },

    phoneRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },

    phonePrefix: {
      backgroundColor: Colors.neutral[100],
      borderRadius: 12,
      paddingHorizontal: Spacing.md,
      paddingVertical: 14,
      justifyContent: 'center',
      alignItems: 'center',
      minWidth: 64,
      marginBottom: 4,
    },

    phonePrefixText: {
      ...Typography.bodyMedium,
      color: Colors.neutral[700],
      fontSize: 16,
    },

    phoneInputWrap: {
      flex: 1,
    },
  });