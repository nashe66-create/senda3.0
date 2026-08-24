import { Text, View, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Colors, Spacing, Typography } from '@/lib/theme';

interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon, title, subtitle, children }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  } as ViewStyle,
  icon: {
    fontSize: 48,
    marginBottom: Spacing.md,
  } as TextStyle,
  title: {
    ...Typography.h3,
    color: Colors.neutral[800],
    textAlign: 'center',
    marginBottom: Spacing.xs,
  } as TextStyle,
  subtitle: {
    ...Typography.body,
    color: Colors.neutral[500],
    textAlign: 'center',
  } as TextStyle,
});
