import { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Spacing } from '@/lib/theme';

interface BadgeProps {
  children: ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'neutral' | 'accent';
  style?: ViewStyle;
}

const colorMap = {
  primary: { bg: Colors.primary[50], text: Colors.primary[700] },
  success: { bg: Colors.success[50], text: Colors.success[700] },
  warning: { bg: Colors.warning[50], text: Colors.warning[700] },
  error: { bg: Colors.error[50], text: Colors.error[700] },
  neutral: { bg: Colors.neutral[200], text: Colors.neutral[700] },
  accent: { bg: Colors.accent[50], text: Colors.accent[700] },
};

export function Badge({ children, color = 'neutral', style }: BadgeProps) {
  const c = colorMap[color];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      {typeof children === 'string' ? (
        <Text style={[styles.text, { color: c.text }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

import { Text, TextStyle } from 'react-native';

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 1,
    borderRadius: 999,
    alignSelf: 'flex-start',
  } as ViewStyle,
  text: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    fontWeight: '600',
  } as TextStyle,
});
