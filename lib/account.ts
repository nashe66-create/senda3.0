import { Profile } from '@/types/database';

export function isAccountSetupComplete(
  profile: Pick<Profile, 'kyc_status' | 'flutterwave_sender_id'> | null | undefined,
): boolean {
  return profile?.kyc_status === 'verified' && Boolean(profile.flutterwave_sender_id);
}

export function canStartAccountSetup(
  profile: Pick<Profile, 'kyc_status' | 'flutterwave_sender_id'> | null | undefined,
): boolean {
  return !profile?.flutterwave_sender_id &&
    (profile?.kyc_status === 'unverified' || profile?.kyc_status === 'rejected');
}