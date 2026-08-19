export const Colors = {
  primary: {
    50: '#e6f4ff',
    100: '#b3d9ff',
    200: '#80bfff',
    300: '#4da6ff',
    400: '#1a8cff',
    500: '#0066cc',
    600: '#0052a3',
    700: '#003d7a',
    800: '#002952',
    900: '#001329',
  },
  secondary: {
    50: '#e8f5e9',
    100: '#c8e6c9',
    200: '#a5d6a7',
    300: '#81c784',
    400: '#66bb6a',
    500: '#43a047',
    600: '#388e3c',
    700: '#2e7d32',
    800: '#1b5e20',
    900: '#0e3b12',
  },
  accent: {
    50: '#fff8e1',
    100: '#ffecb3',
    200: '#ffe082',
    300: '#ffd54f',
    400: '#ffca28',
    500: '#ffc107',
    600: '#ffb300',
    700: '#ffa000',
    800: '#ff8f00',
    900: '#ff6f00',
  },
  success: {
    50: '#e8f5e9',
    100: '#c8e6c9',
    400: '#66bb6a',
    500: '#43a047',
    600: '#388e3c',
    700: '#2e7d32',
  },
  warning: {
    50: '#fff3e0',
    100: '#ffe0b2',
    400: '#ffa726',
    500: '#fb8c00',
    600: '#f57c00',
    700: '#ef6c00',
  },
  error: {
    50: '#ffebee',
    100: '#ffcdd2',
    400: '#ef5350',
    500: '#e53935',
    600: '#d32f2f',
    700: '#c62828',
  },
  neutral: {
    0: '#ffffff',
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#eeeeee',
    300: '#e0e0e0',
    400: '#bdbdbd',
    500: '#9e9e9e',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
    950: '#121212',
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const Typography = {
  fontFamilyRegular: 'Inter-Regular',
  fontFamilyMedium: 'Inter-Medium',
  fontFamilySemiBold: 'Inter-SemiBold',
  fontFamilyBold: 'Inter-Bold',

  hero: { fontSize: 32, fontFamily: 'Inter-Bold' as const, lineHeight: 40 },
  h1: { fontSize: 28, fontFamily: 'Inter-Bold' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontFamily: 'Inter-SemiBold' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontFamily: 'Inter-SemiBold' as const, lineHeight: 26 },
  body: { fontSize: 16, fontFamily: 'Inter-Regular' as const, lineHeight: 24 },
  bodyMedium: { fontSize: 16, fontFamily: 'Inter-Medium' as const, lineHeight: 24 },
  caption: { fontSize: 14, fontFamily: 'Inter-Regular' as const, lineHeight: 20 },
  small: { fontSize: 12, fontFamily: 'Inter-Regular' as const, lineHeight: 16 },
  label: { fontSize: 14, fontFamily: 'Inter-Medium' as const, lineHeight: 18 },
};

export const COUNTRY_DIAL_CODES: Record<string, string> = {
  NG: '+234',
  ZW: '+263',
  KE: '+254',
  GH: '+233',
  UG: '+256',
  TZ: '+255',
  ZA: '+27',
  RW: '+250',
  CM: '+237',
  ZM: '+260',
};

export const COUNTRIES = [
  { code: 'NG', name: 'Nigeria', currency: 'NGN', flag: '🇳🇬' },
  { code: 'ZW', name: 'Zimbabwe', currency: 'ZWL', flag: '🇿🇼' },
  { code: 'KE', name: 'Kenya', currency: 'KES', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', flag: '🇬🇭' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', flag: '🇺🇬' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', flag: '🇹🇿' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', flag: '🇿🇦' },
  { code: 'CM', name: 'Cameroon', currency: 'XAF', flag: '🇨🇲' },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', flag: '🇷🇼' },
  { code: 'ZM', name: 'Zambia', currency: 'ZMW', flag: '🇿🇲' },
];

export const MOBILE_MONEY_PROVIDERS = [
  { code: 'MPESA', name: 'M-PESA' },
  { code: 'MTN', name: 'MTN Mobile Money' },
  { code: 'AIRTEL', name: 'Airtel Money' },
  { code: 'GLO', name: 'Glo Mobile Money' },
  { code: 'ECOCASH', name: 'EcoCash' },
  { code: 'OM', name: 'Orange Money' },
  { code: 'WAVE', name: 'Wave' },
];

export const RECEIVING_METHODS = [
  { value: 'mobile_money', label: 'Mobile Money', icon: 'Smartphone' },
  { value: 'bank_account', label: 'Bank Account', icon: 'Building2' },
  { value: 'cash_pickup', label: 'Cash Pickup', icon: 'Wallet' },
  { value: 'bill_payment', label: 'Bill Payment', icon: 'Receipt' },
] as const;

export const RECURRING_OPTIONS = [
  { value: 'one_off', label: 'One-off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;
