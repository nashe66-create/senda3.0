import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ViewStyle,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  User,
  Shield,
  HelpCircle,
  LogOut,
  ChevronRight,
  Mail,
  Phone,
  Globe,
  CheckCircle2,
  Clock,
  AlertCircle,
  Info,
  RefreshCw,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/types/database';
import { syncCorridors } from '@/lib/data';

export default function SettingsScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshProfile().finally(() => setLoading(false));
    }, [refreshProfile])
  );

  if (loading) return <Loading />;

  const hasSenderId = Boolean(profile?.flutterwave_sender_id);
  const rawKycStatus = profile?.kyc_status ?? 'unverified';
  const kycStatus = rawKycStatus === 'verified' && !hasSenderId ? 'unverified' : rawKycStatus;
  const needsVerification = kycStatus !== 'verified' || !hasSenderId;

  const kycConfig: Record<
    string,
    { icon: typeof CheckCircle2; color: string; bg: string; label: string; desc: string }
  > = {
    verified: {
      icon: CheckCircle2,
      color: Colors.success[600],
      bg: Colors.success[50],
      label: 'Verified',
      desc: 'Your identity has been verified via Flutterwave. You can send money.',
    },
    pending: {
      icon: Clock,
      color: Colors.warning[600],
      bg: Colors.warning[50],
      label: 'Pending Review',
      desc: 'Your KYC verification is being reviewed. This usually takes 1-2 business days.',
    },
    submitted: {
      icon: Clock,
      color: Colors.warning[600],
      bg: Colors.warning[50],
      label: 'Submitted',
      desc: 'Your KYC has been submitted and is being reviewed. This usually takes 1-2 business days.',
    },
    rejected: {
      icon: AlertCircle,
      color: Colors.error[600],
      bg: Colors.error[50],
      label: 'Verification Rejected',
      desc: 'Your KYC was rejected. Please re-submit your documents.',
    },
    unverified: {
      icon: Shield,
      color: Colors.neutral[600],
      bg: Colors.neutral[200],
      label: 'Not Verified',
      desc: 'Complete KYC verification to start sending money. Powered by Flutterwave.',
    },
  };

  const kycEntry = kycConfig[kycStatus] ?? kycConfig.unverified;
  const KycIcon = kycEntry.icon;

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const handleStartKyc = () => {
    router.push('/kyc');
  };

  const handleSyncCorridors = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncCorridors();
      if (result.success && result.summary) {
        setSyncResult(`Synced ${result.summary.countries_checked} countries — ${result.summary.countries_with_mobile_money} support mobile money.`);
      } else {
        setSyncResult(result.error ?? 'Sync failed');
      }
    } catch (e: any) {
      setSyncResult(e?.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarLargeText}>
            {(profile?.full_name || user?.email || 'U')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.profileName}>{profile?.full_name || 'User'}</Text>
        <Text style={styles.profileEmail}>{user?.email}</Text>
      </View>

      <Card style={styles.kycCard}>
        <View style={[styles.kycIconWrap, { backgroundColor: kycEntry.bg }]}>
          <KycIcon color={kycEntry.color} size={24} strokeWidth={2} />
        </View>
        <View style={styles.kycInfo}>
          <Text style={styles.kycLabel}>Identity Verification</Text>
          <View style={styles.kycStatusRow}>
            <View
              style={[
                styles.kycBadge,
                { backgroundColor: kycEntry.bg },
              ]}
            >
              <Text style={[styles.kycBadgeText, { color: kycEntry.color }]}>
                {kycEntry.label}
              </Text>
            </View>
          </View>
          <Text style={styles.kycDesc}>{kycEntry.desc}</Text>
        </View>
      </Card>

      {needsVerification && (
        <TouchableOpacity
          style={styles.kycBtn}
          onPress={handleStartKyc}
          activeOpacity={0.8}
        >
          <Shield color="#fff" size={18} strokeWidth={2} />
          <Text style={styles.kycBtnText}>
            {kycStatus === 'rejected' ? 'Re-submit KYC' : 'Start KYC Verification'}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.sectionLabel}>
        <Text style={styles.sectionLabelText}>Account</Text>
      </View>

      <Card style={styles.menuCard}>
        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6}>
          <View style={styles.menuIconWrap}>
            <Mail color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>Email</Text>
          <Text style={styles.menuValue} numberOfLines={1}>
            {user?.email}
          </Text>
        </TouchableOpacity>

        <View style={styles.menuDivider} />

        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6}>
          <View style={styles.menuIconWrap}>
            <Phone color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>Phone</Text>
          <Text style={styles.menuValue}>
            {profile?.phone || 'Not set'}
          </Text>
        </TouchableOpacity>

        <View style={styles.menuDivider} />

        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6}>
          <View style={styles.menuIconWrap}>
            <Globe color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>Country</Text>
          <Text style={styles.menuValue}>
            {profile?.country || 'GB'}
          </Text>
        </TouchableOpacity>
      </Card>

      <View style={styles.sectionLabel}>
        <Text style={styles.sectionLabelText}>Payout Corridors</Text>
      </View>

      <Card style={styles.menuCard}>
        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleSyncCorridors} disabled={syncing}>
          <View style={styles.menuIconWrap}>
            <RefreshCw color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>Refresh payout corridors</Text>
          {syncing ? (
            <Text style={styles.menuValue}>Syncing...</Text>
          ) : (
            <ChevronRight color={Colors.neutral[400]} size={18} strokeWidth={2} />
          )}
        </TouchableOpacity>
      </Card>

      {syncResult && (
        <Text style={styles.syncResultText}>{syncResult}</Text>
      )}

      <View style={styles.sectionLabel}>
        <Text style={styles.sectionLabelText}>About</Text>
      </View>

      <Card style={styles.menuCard}>
        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6}>
          <View style={styles.menuIconWrap}>
            <Info color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>About Senda</Text>
          <ChevronRight color={Colors.neutral[400]} size={18} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.menuDivider} />

        <TouchableOpacity style={styles.menuItem} activeOpacity={0.6}>
          <View style={styles.menuIconWrap}>
            <HelpCircle color={Colors.neutral[600]} size={18} strokeWidth={2} />
          </View>
          <Text style={styles.menuText}>Help & Support</Text>
          <ChevronRight color={Colors.neutral[400]} size={18} strokeWidth={2} />
        </TouchableOpacity>
      </Card>

      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={handleSignOut}
        activeOpacity={0.7}
      >
        <LogOut color={Colors.error[600]} size={18} strokeWidth={2} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.versionText}>Senda v1.0.0</Text>
      <Text style={styles.poweredBy}>Powered by Flutterwave</Text>

      <View style={{ height: Spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.neutral[50],
  },
  content: {
    padding: Spacing.md,
    paddingTop: 60,
    paddingBottom: Spacing.xl,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.h1,
    color: Colors.neutral[900],
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatarLargeText: {
    color: '#fff',
    fontSize: 32,
    fontFamily: 'Inter-Bold',
  },
  profileName: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  profileEmail: {
    ...Typography.body,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  kycCard: {
    flexDirection: 'row',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  } as ViewStyle,
  kycIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  kycInfo: {
    flex: 1,
  },
  kycLabel: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  kycStatusRow: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  kycBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
  },
  kycBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    fontWeight: '600',
  },
  kycDesc: {
    ...Typography.caption,
    color: Colors.neutral[500],
    lineHeight: 20,
  },
  kycBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary[600],
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: Spacing.xl,
  },
  kycBtnText: {
    ...Typography.bodyMedium,
    color: '#fff',
  },
  sectionLabel: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  sectionLabelText: {
    ...Typography.label,
    color: Colors.neutral[500],
    textTransform: 'uppercase',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  menuCard: {
    padding: 0,
    overflow: 'hidden',
  } as ViewStyle,
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    ...Typography.body,
    color: Colors.neutral[800],
    flex: 1,
  },
  menuValue: {
    ...Typography.caption,
    color: Colors.neutral[500],
    maxWidth: 150,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.neutral[200],
    marginLeft: 60,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.xl,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.error[500],
    borderRadius: 12,
  },
  signOutText: {
    ...Typography.bodyMedium,
    color: Colors.error[600],
  },
  versionText: {
    ...Typography.small,
    color: Colors.neutral[400],
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  poweredBy: {
    ...Typography.small,
    color: Colors.neutral[400],
    textAlign: 'center',
    marginTop: 2,
  },
  syncResultText: {
    ...Typography.small,
    color: Colors.neutral[500],
    textAlign: 'center',
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
});
