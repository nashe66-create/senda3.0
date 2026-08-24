/* =========================================================
   CORE APP TYPES
   ========================================================= */

export type KycStatus = 'unverified' | 'submitted' | 'pending' | 'verified' | 'rejected';

export type PricingMode = 'fixed_source' | 'fixed_destination';

export type OrderStatus =
  | 'draft'
  | 'quoted'
  | 'awaiting_payment'
  | 'payment_processing'
  | 'funded'
  | 'payouts_processing'
  | 'completed'
  | 'payment_failed'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'processing' | 'successful' | 'failed';

export type PayoutStatus = 'pending' | 'ready' | 'submitted' | 'processing' | 'completed' | 'failed';

export type PayoutMethod = 'bank' | 'mobile_money' | 'cash_pickup';

export type CommitmentStatus = PayoutStatus;

export type TransactionStatus = 'pending' | 'successful' | 'failed' | 'refunded';

export type ReceivingMethod = 'mobile_money' | 'bank_account' | 'cash_pickup' | 'bill_payment';

export type PayoutType = 'mobile_money' | 'cash_pickup';

export type RecurringType = 'one_off' | 'weekly' | 'biweekly' | 'monthly';

export type TransferAction = 'deferred' | 'instant';

export type NextActionType = 'requires_pin' | 'requires_otp' | 'requires_additional_fields' | 'redirect_url' | null;

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  kyc_status: KycStatus;
  flutterwave_customer_id: string | null;
  flutterwave_sender_id: string | null;
  country: string;
  kyc_national_id_type: string | null;
  kyc_national_id_number: string | null;
  kyc_national_id_expiry: string | null;
  kyc_date_of_birth: string | null;
  kyc_address: Record<string, string> | null;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  created_at: string;
}

export interface Recipient {
  id: string;
  user_id: string;
  name: string;
  country: string;
  receiving_method: ReceivingMethod;
  phone: string;
  mobile_money_provider: string;
  bank_code: string;
  account_number: string;
  bill_type: string;
  relationship: string;
  notes: string;
  flutterwave_recipient_id: string | null;
  flutterwave_recipient_type: string | null;
  flutterwave_account_name: string | null;
  payout_type: PayoutType | null;
  mobile_money_network: string | null;
  destination_country: string | null;
  cash_pickup_provider: string | null;
  currency: string | null;
  flutterwave_network_code: string | null;
  flutterwave_bank_name: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  user_id: string;
  name: string;
  status: OrderStatus;
  total_gbp: number;
  total_recipients: number;
  destination_currencies: string[];
  next_run_date: string | null;
  recurring: RecurringType;
  created_at: string;
  updated_at: string;
  pricing_mode: PricingMode;
  destination_country: string | null;
  destination_currency: string | null;
  source_amount: number;
  destination_amount: number;
  customer_pays: number;
  customer_fx_rate: number;
  provider_fx_rate: number;
  provider_fee: number;
  senda_fx_margin: number;
  quote_created_at: string | null;
  quote_expires_at: string | null;
  quote_locked_at: string | null;
  payment_status: PaymentStatus;
}

export interface Commitment {
  id: string;
  plan_id: string;
  recipient_id: string | null;
  user_id: string;
  amount_gbp: number;
  destination_currency: string;
  amount_destination: number;
  fx_rate: number;
  receiving_method: ReceivingMethod;
  status: CommitmentStatus;
  flutterwave_transfer_id: string | null;
  failure_reason: string | null;
  idempotency_key: string | null;
  transfer_action: TransferAction;
  created_at: string;
  recipient_snapshot: RecipientSnapshot | null;
  provider_status: string | null;
  payout_method: PayoutMethod | null;
  failure_reason_display: string | null;
}

export interface Transaction {
  id: string;
  plan_id: string;
  user_id: string;
  amount_gbp: number;
  status: TransactionStatus;
  payment_reference: string;
  flutterwave_payment_id: string | null;
  flutterwave_charge_id: string | null;
  idempotency_key: string | null;
  next_action_type: NextActionType;
  card_last4: string | null;
  card_network: string | null;
  created_at: string;
  completed_at: string | null;

  plan?: Plan | null;
}

export interface PlanWithCommitments extends Plan {
  commitments: CommitmentWithRecipient[];
}

export interface CommitmentWithRecipient extends Commitment {
  recipient: Recipient | null;
}

/* =========================================================
   ORCHESTRATION TYPES
   ========================================================= */

export interface RecipientSnapshot {
  name: string;
  phone: string;
  country: string;
  receiving_method: ReceivingMethod;
  mobile_money_network: string | null;
  mobile_money_provider: string | null;
  bank_code: string | null;
  account_number: string | null;
  destination_country: string | null;
  currency: string | null;
  flutterwave_recipient_id: string | null;
}

export interface QuoteRecipientBreakdown {
  commitment_id: string;
  recipient_name: string;
  source_amount: number;
  destination_amount: number;
  fx_rate: number;
  payout_method: PayoutMethod;
}

export interface QuoteResult {
  success: boolean;
  plan_id: string;
  pricing_mode: PricingMode;
  source_currency: string;
  destination_country: string;
  destination_currency: string;
  source_amount: number;
  destination_amount: number;
  customer_pays: number;
  customer_fx_rate: number;
  provider_fx_rate: number;
  provider_fee: number;
  senda_fx_margin: number;
  quote_created_at: string;
  quote_expires_at: string;
  recipients: QuoteRecipientBreakdown[];
  error?: string;
  error_code?: string;
}

export interface PayoutSummary {
  success: boolean;
  plan_id: string;
  total: number;
  submitted: number;
  failed: number;
  skipped: number;
  errors: string[];
  payouts?: Array<{
    commitment_id: string;
    recipient_name: string;
    status: string;
    transfer_id: string | null;
    error?: string;
  }>;
  error?: string;
}

/* =========================================================
   FLUTTERWAVE
   ========================================================= */

export interface FlutterwaveCurrency {
  code: string;
  name?: string | null;
  symbol?: string | null;
  currency?: string | null;

  [key: string]: any;
}

export interface FlutterwaveMobileNetwork {
  id?: string | number | null;
  code?: string | null;
  name?: string | null;
  currency?: string | null;
  country?: string | null;

  [key: string]: any;
}

export interface FlutterwaveBank {
  id?: string | number | null;
  code?: string | null;
  name?: string | null;
  currency?: string | null;
  country?: string | null;

  [key: string]: any;
}

export interface FlutterwaveCountry {
  id?: string | number | null;
  code?: string | null;
  name?: string | null;
  currency?: string | null;
  flag?: string | null;

  payout_methods?: string[];

  [key: string]: any;
}

export interface FlutterwaveOptions {
  source_country: string;
  source_currency: string;

  country?: string;

  countries: FlutterwaveCountry[];

  currencies: FlutterwaveCurrency[];

  mobile_networks: FlutterwaveMobileNetwork[];

  banks: FlutterwaveBank[];

  payout_methods: string[];

  [key: string]: any;
}

/* =========================================================
   PAYOUT CORRIDOR (cached reference data)
   ========================================================= */

export interface PayoutCorridorCountry {
  country_code: string;
  country_name: string;
  currency: string;
  mobile_money_supported: boolean;
  cash_pickup_supported: boolean;
  bank_supported: boolean;
}

export interface PayoutCorridorNetwork {
  network_code: string;
  network_name: string;
}

export interface PayoutCorridorBank {
  bank_code: string;
  bank_name: string;
}
