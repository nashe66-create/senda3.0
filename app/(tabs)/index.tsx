import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  Plus,
  ArrowRight,
  TrendingUp,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  Send,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Loading } from '@/components/ui/Loading';
import { EmptyState } from '@/components/ui/EmptyState';
import { Colors, Spacing, Typography } from '@/lib/theme';
import {
  fetchPlans,
  fetchRecipients,
  fetchTransactions,
  formatGBP,
  formatCurrency,
  formatDate,
  timeAgo,
} from '@/lib/data';
import { Plan, Recipient, Transaction } from '@/types/database';

export default function HomeScreen() {
  const { profile, user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [p, r, t] = await Promise.all([
        fetchPlans(),
        fetchRecipients(),
        fetchTransactions(),
      ]);
      setPlans(p);
      setRecipients(r);
      setTransactions(t);
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) return <Loading />;

  const activePlans = plans.filter((p) => p.status === 'draft' || p.status === 'quoted' || p.status === 'awaiting_payment' || p.status === 'funded' || p.status === 'payouts_processing' || p.status === 'payment_processing');
  const completedPlans = plans.filter((p) => p.status === 'completed');
  const totalSent = transactions
    .filter((t) => t.status === 'successful')
    .reduce((sum, t) => sum + Number(t.amount_gbp), 0);
  const recentTx = transactions.slice(0, 3);

  const greeting = profile?.full_name
    ? `Welcome back, ${profile.full_name.split(' ')[0]}`
    : 'Welcome';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.subtitle}>Here's your remittance overview</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.full_name || user?.email || 'U')[0].toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <View style={styles.heroIconWrap}>
            <Send color="#fff" size={20} strokeWidth={2} />
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>All-time sent</Text>
          </View>
        </View>
        <Text style={styles.heroAmount}>{formatGBP(totalSent)}</Text>
        <Text style={styles.heroLabel}>Total sent across {completedPlans.length} completed plans</Text>
      </View>

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: Colors.primary[50] }]}>
            <Clock color={Colors.primary[600]} size={20} strokeWidth={2} />
          </View>
          <Text style={styles.statValue}>{activePlans.length}</Text>
          <Text style={styles.statLabel}>Active plans</Text>
        </Card>
        <Card style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: Colors.secondary[50] }]}>
            <Users color={Colors.secondary[600]} size={20} strokeWidth={2} />
          </View>
          <Text style={styles.statValue}>{recipients.length}</Text>
          <Text style={styles.statLabel}>Recipients</Text>
        </Card>
        <Card style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: Colors.accent[50] }]}>
            <CheckCircle2 color={Colors.accent[700]} size={20} strokeWidth={2} />
          </View>
          <Text style={styles.statValue}>{completedPlans.length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </Card>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Active Plans</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/plans')}>
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      </View>

      {activePlans.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No active plans yet</Text>
          <Text style={styles.emptySubtitle}>
            Create a plan to bundle multiple transfers into one payment
          </Text>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push('/(tabs)/plans')}
          >
            <Plus color={Colors.primary[600]} size={18} strokeWidth={2} />
            <Text style={styles.createBtnText}>Create a plan</Text>
          </TouchableOpacity>
        </Card>
      ) : (
        activePlans.slice(0, 3).map((plan) => (
          <TouchableOpacity
            key={plan.id}
            onPress={() => router.push(`/plan/${plan.id}`)}
            activeOpacity={0.7}
          >
            <Card style={styles.planCard}>
              <View style={styles.planCardHeader}>
                <View style={styles.planIconWrap}>
                  <TrendingUp color={Colors.primary[600]} size={18} strokeWidth={2} />
                </View>
                <StatusBadge status={plan.status} />
              </View>
              <Text style={styles.planName} numberOfLines={1}>
                {plan.name}
              </Text>
              <View style={styles.planMeta}>
                <Text style={styles.planMetaText}>
                  {plan.total_recipients} recipient{plan.total_recipients !== 1 ? 's' : ''}
                </Text>
                <Text style={styles.planDot}>·</Text>
                <Text style={styles.planMetaText}>
                  {plan.pricing_mode === 'fixed_destination' && Number(plan.destination_amount) > 0
                    ? formatCurrency(Number(plan.destination_amount), plan.destination_currency || '')
                    : plan.pricing_mode === 'fixed_source' && Number(plan.source_amount) > 0 && Number(plan.total_gbp) === 0
                    ? `Budget: ${formatGBP(Number(plan.source_amount))}`
                    : formatGBP(Number(plan.total_gbp) || Number(plan.source_amount) || 0)}
                </Text>
                {plan.next_run_date && (
                  <>
                    <Text style={styles.planDot}>·</Text>
                    <Text style={styles.planMetaText}>{formatDate(plan.next_run_date)}</Text>
                  </>
                )}
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
      </View>

      {recentTx.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptySubtitle}>No transactions yet</Text>
        </Card>
      ) : (
        recentTx.map((tx) => (
          <Card key={tx.id} style={styles.txCard}>
            <View style={styles.txLeft}>
              <View
                style={[
                  styles.txIcon,
                  {
                    backgroundColor:
                      tx.status === 'successful'
                        ? Colors.success[50]
                        : tx.status === 'failed'
                        ? Colors.error[50]
                        : Colors.warning[50],
                  },
                ]}
              >
                {tx.status === 'successful' ? (
                  <CheckCircle2 color={Colors.success[600]} size={18} strokeWidth={2} />
                ) : tx.status === 'failed' ? (
                  <AlertCircle color={Colors.error[600]} size={18} strokeWidth={2} />
                ) : (
                  <Clock color={Colors.warning[600]} size={18} strokeWidth={2} />
                )}
              </View>
              <View>
                <Text style={styles.txPlanName} numberOfLines={1}>
                  {tx.plan?.name || 'Plan'}
                </Text>
                <Text style={styles.txTime}>{timeAgo(tx.created_at)}</Text>
              </View>
            </View>
            <View style={styles.txRight}>
              <Text style={styles.txAmount}>{formatGBP(Number(tx.amount_gbp))}</Text>
              <StatusBadge status={tx.status} />
            </View>
          </Card>
        ))
      )}

      <View style={{ height: Spacing.xl }} />
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
  paddingBottom: Spacing.xl,
  paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  greeting: {
    ...Typography.h2,
    color: Colors.neutral[900],
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Inter-Bold',
  },
  heroCard: {
    backgroundColor: Colors.primary[600],
    borderRadius: 20,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    shadowColor: Colors.primary[900],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
  },
  heroBadgeText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontFamily: 'Inter-Medium',
  },
  heroAmount: {
    fontSize: 36,
    fontFamily: 'Inter-Bold',
    color: '#fff',
    lineHeight: 44,
  },
  heroLabel: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.8)',
    marginTop: Spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    padding: Spacing.md,
    alignItems: 'center',
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  statValue: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: Colors.neutral[900],
  },
  statLabel: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.neutral[900],
  },
  seeAll: {
    ...Typography.caption,
    color: Colors.primary[600],
    fontFamily: 'Inter-Medium',
  },
  emptyCard: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.neutral[800],
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    ...Typography.caption,
    color: Colors.neutral[500],
    textAlign: 'center',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.primary[600],
    borderRadius: 12,
  },
  createBtnText: {
    ...Typography.label,
    color: Colors.primary[600],
  },
  planCard: {
    marginBottom: Spacing.sm,
  padding: Spacing.md,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  planIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    ...Typography.h3,
    color: Colors.neutral[900],
    marginBottom: Spacing.xs,
  },
  planMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  planMetaText: {
    ...Typography.caption,
    color: Colors.neutral[600],
  },
  planDot: {
    ...Typography.caption,
    color: Colors.neutral[400],
  },
  txCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  },
  txLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txPlanName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  txTime: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  txAmount: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
});
