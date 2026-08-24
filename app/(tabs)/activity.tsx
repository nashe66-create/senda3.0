import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ViewStyle,
} from 'react-native';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
} from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Loading } from '@/components/ui/Loading';
import { EmptyState } from '@/components/ui/EmptyState';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { fetchTransactions, formatGBP, formatDateTime } from '@/lib/data';
import { Transaction } from '@/types/database';
import { useFocusEffect } from 'expo-router';

export default function ActivityScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTransactions = useCallback(async () => {
    try {
      const data = await fetchTransactions();
      setTransactions(data);
    } catch (e) {
      console.error('Failed to load transactions:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [loadTransactions])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadTransactions();
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const status = item.status;
    const Icon =
      status === 'successful'
        ? CheckCircle2
        : status === 'failed'
        ? AlertCircle
        : Clock;
    const iconColor =
      status === 'successful'
        ? Colors.success[600]
        : status === 'failed'
        ? Colors.error[600]
        : Colors.warning[600];
    const iconBg =
      status === 'successful'
        ? Colors.success[50]
        : status === 'failed'
        ? Colors.error[50]
        : Colors.warning[50];

    return (
      <Card style={styles.txCard}>
        <View style={styles.txLeft}>
          <View style={[styles.txIcon, { backgroundColor: iconBg }]}>
            <Icon color={iconColor} size={20} strokeWidth={2} />
          </View>
          <View style={styles.txInfo}>
            <Text style={styles.txPlanName} numberOfLines={1}>
              {item.plan?.name || 'Plan'}
            </Text>
            <Text style={styles.txDate}>
              {formatDateTime(item.created_at)}
            </Text>
            {item.completed_at && (
              <Text style={styles.txCompleted}>
                Completed {formatDateTime(item.completed_at)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.txRight}>
          <Text style={styles.txAmount}>{formatGBP(Number(item.amount_gbp))}</Text>
          <StatusBadge status={item.status} />
        </View>
      </Card>
    );
  };

  if (loading) return <Loading />;

  const totalSent = transactions
    .filter((t) => t.status === 'successful')
    .reduce((sum, t) => sum + Number(t.amount_gbp), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>Your transaction history</Text>
      </View>

      {transactions.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}>
            <TrendingUp color="#fff" size={20} strokeWidth={2} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Total successfully sent</Text>
            <Text style={styles.summaryAmount}>{formatGBP(totalSent)}</Text>
          </View>
        </View>
      )}

      {transactions.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No transactions yet"
          subtitle="Your payment history will appear here once you confirm a plan"
        />
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.neutral[50],
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  title: {
    ...Typography.h1,
    color: Colors.neutral[900],
  },
  subtitle: {
    ...Typography.body,
    color: Colors.neutral[500],
    marginTop: 4,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primary[600],
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    borderRadius: 16,
    shadowColor: Colors.primary[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  } as ViewStyle,
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: {
    ...Typography.small,
    color: 'rgba(255,255,255,0.8)',
  },
  summaryAmount: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#fff',
    marginTop: 2,
  },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  txCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  } as ViewStyle,
  txLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txPlanName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
  },
  txDate: {
    ...Typography.small,
    color: Colors.neutral[500],
    marginTop: 2,
  },
  txCompleted: {
    ...Typography.small,
    color: Colors.success[600],
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  txAmount: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
    fontSize: 17,
  },
});
