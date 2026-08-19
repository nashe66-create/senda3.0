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
import {
  Plus,
  Smartphone,
  Building2,
  Wallet,
  Receipt,
  ChevronRight,
} from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography, COUNTRIES } from '@/lib/theme';
import { fetchRecipients, getReceivingMethodLabel } from '@/lib/data';
import { Recipient, ReceivingMethod } from '@/types/database';

const methodIcons: Record<ReceivingMethod, typeof Smartphone> = {
  mobile_money: Smartphone,
  bank_account: Building2,
  cash_pickup: Wallet,
  bill_payment: Receipt,
};

export default function RecipientsScreen() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecipients = useCallback(async () => {
    try {
      const data = await fetchRecipients();
      setRecipients(data);
    } catch (e) {
      console.error('Failed to load recipients:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecipients();
    }, [loadRecipients])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadRecipients();
  };

  const renderRecipient = ({ item }: { item: Recipient }) => {
    const Icon = methodIcons[item.receiving_method] ?? Smartphone;
    const country = COUNTRIES.find((c) => c.code === item.country);

    return (
      <TouchableOpacity
        onPress={() => router.push(`/recipient/${item.id}`)}
        activeOpacity={0.7}
      >
        <Card style={styles.recipientCard}>
          <View style={styles.recipientRow}>
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: Colors.primary[50] },
              ]}
            >
              <Icon color={Colors.primary[600]} size={20} strokeWidth={2} />
            </View>
            <View style={styles.recipientInfo}>
              <Text style={styles.recipientName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  {country ? `${country.flag} ${country.name}` : item.country}
                </Text>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.metaText}>
                  {getReceivingMethodLabel(item.receiving_method)}
                </Text>
              </View>
              {item.phone ? (
                <Text style={styles.phoneText}>{item.phone}</Text>
              ) : item.account_number ? (
                <Text style={styles.phoneText}>
                  Acct: {item.account_number}
                </Text>
              ) : null}
            </View>
            <ChevronRight color={Colors.neutral[400]} size={20} strokeWidth={2} />
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  if (loading) return <Loading />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recipients</Text>
        <Text style={styles.subtitle}>
          People and bills you send money to
        </Text>
      </View>

      {recipients.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No recipients yet"
          subtitle="Add the people or bills you want to send money to"
        >
          <Button
            onPress={() => router.push('/recipient/new')}
            style={styles.emptyBtn}
          >
            <Plus color="#fff" size={18} strokeWidth={2} /> Add Recipient
          </Button>
        </EmptyState>
      ) : (
        <>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push('/recipient/new')}
            activeOpacity={0.8}
          >
            <Plus color={Colors.primary[600]} size={20} strokeWidth={2} />
            <Text style={styles.createBtnText}>Add Recipient</Text>
          </TouchableOpacity>

          <FlatList
            data={recipients}
            keyExtractor={(item) => item.id}
            renderItem={renderRecipient}
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
  recipientCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  } as ViewStyle,
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    ...Typography.bodyMedium,
    color: Colors.neutral[900],
    fontSize: 17,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaText: {
    ...Typography.small,
    color: Colors.neutral[500],
  },
  dot: {
    ...Typography.small,
    color: Colors.neutral[400],
  },
  phoneText: {
    ...Typography.small,
    color: Colors.neutral[400],
    marginTop: 2,
  },
  emptyBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
});
