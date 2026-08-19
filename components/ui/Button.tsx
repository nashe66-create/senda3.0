import { ReactNode } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: ReactNode;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const variantStyle = styles[variant];
  const sizeStyle = styles[`size_${size}`];
  const textVariantStyle = styles[`text_${variant}`];
  const textSizeStyle = styles[`text_${size}`];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        variantStyle,
        sizeStyle,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' || variant === 'ghost' ? Colors.primary[600] : '#fff'} />
      ) : (
        <Text style={[styles.text, textVariantStyle, textSizeStyle]}>{children}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  } as ViewStyle,
  primary: {
    backgroundColor: Colors.primary[600],
  shadowColor: Colors.primary[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  } as ViewStyle,
  secondary: {
    backgroundColor: Colors.secondary[500],
  } as ViewStyle,
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.primary[600],
  } as ViewStyle,
  ghost: {
    backgroundColor: 'transparent',
  } as ViewStyle,
  danger: {
    backgroundColor: Colors.error[500],
  } as ViewStyle,
  size_sm: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  } as ViewStyle,
  size_md: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
  } as ViewStyle,
  size_lg: {
    paddingVertical: 18,
    paddingHorizontal: Spacing.xl,
  } as ViewStyle,
  disabled: {
    opacity: 0.5,
  } as ViewStyle,
  text: {
    ...Typography.bodyMedium,
  } as TextStyle,
  text_primary: {
    color: '#fff',
  } as TextStyle,
  text_secondary: {
    color: '#fff',
  } as TextStyle,
  text_outline: {
    color: Colors.primary[600],
  } as TextStyle,
  text_ghost: {
    color: Colors.primary[600],
  } as TextStyle,
  text_danger: {
    color: '#fff',
  } as TextStyle,
  text_sm: {
    fontSize: 14,
  } as TextStyle,
  text_md: {
    fontSize: 16,
  } as TextStyle,
  text_lg: {
    fontSize: 18,
  } as TextStyle,
});
