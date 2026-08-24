import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Plus, TrendingUp, Calendar, Users, ChevronRight } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Loading } from '@/components/ui/Loading';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography } from '@/lib/theme';
import { fetchPlans, formatGBP, formatDate, getRecurringLabel } from '@/lib/data';
import { Plan } from '@/types/database';

export default function PlansScreen() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPlans = useCallback(async () => {
    try {
      const data = await fetchPlans();
      setPlans(data);
    } catch (e) {
      console.error('Failed to load plans:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPlans();
    }, [loadPlans])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadPlans();
  };

  const renderPlan = ({ item }: { item: Plan }) => (
    <TouchableOpacity
      onPress={() => router.push(`/plan/${item.id}`)}
      activeOpacity={0.7}
    >
      <Card style={styles.planCard}>
        <View style={styles.planHeader}>
          <View style={styles.planIconWrap}>
            <TrendingUp color={Colors.primary[600]} size={18} strokeWidth={2} />
          </View>
          <StatusBadge status={item.status} />
        </View>

        <Text style={styles.planName} numberOfLines={1}>
          {item.name}
        </Text>

        <View style={styles.planMetaRow}>
          <View style={styles.metaItem}>
            <Users color={Colors.neutral[400]} size={14} strokeWidth={2} />
            <Text style={styles.metaText}>
              {item.total_recipients} recipient{item.total_recipients !== 1 ? 's' : ''}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Calendar color={Colors.neutral[400]} size={14} strokeWidth={2} />
            <Text style={styles.metaText}>
              {item.next_run_date ? formatDate(item.next_run_date) : getRecurringLabel(item.recurring)}
            </Text>
          </View>
        </View>

        <View style={styles.planFooter}>
          <View>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatGBP(Number(item.total_gbp))}</Text>
          </View>
          <View style={styles.chevron}>
            <ChevronRight color={Colors.neutral[400]} size={20} strokeWidth={2} />
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );

  if (loading) return <Loading />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Remittance Plans</Text>
        <Text style={styles.subtitle}>
          Bundle multiple transfers into one payment
        </Text>
      </View>

      {plans.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No plans yet"
          subtitle="Create your first remittance plan to send to multiple recipients with a single payment"
        >
          <Button
            onPress={() => router.push('/plan/new')}
            style={styles.emptyBtn}
          >
            <Plus color="#fff" size={18} strokeWidth={2} /> Create Plan
          </Button>
        </EmptyState>
      ) : (
        <>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push('/plan/new')}
            activeOpacity={0.8}
          >
            <Plus color={Colors.primary[600]} size={20} strokeWidth={2} />
            <Text style={styles.createBtnText}>New Plan</Text>
          </TouchableOpacity>

          <FlatList
            data={plans}
            keyExtractor={(item) => item.id}
            renderItem={renderPlan}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            showsVerticalScrollIndicator={false}
          />
        </>
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
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary[600],
    borderRadius: 12,
    borderStyle: 'dashed',
  },
  createBtnText: {
    ...Typography.bodyMedium,
    color: Colors.primary[600],
  },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  planCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  } as ViewStyle,
  planHeader: {
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
    marginBottom: Spacing.sm,
  },
  planMetaRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    ...Typography.caption,
    color: Colors.neutral[600],
  },
  planFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.neutral[200],
  },
  totalLabel: {
    ...Typography.small,
    color: Colors.neutral[500],
  },
  totalAmount: {
    ...Typography.h3,
    color: Colors.neutral[900],
  },
  chevron: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBtn: {
    marginTop: Spacing.lg,
  paddingHorizontal: Spacing.xl,
  },
});
