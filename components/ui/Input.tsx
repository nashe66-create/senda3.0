import { TextInput, Text, View, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  error?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  style?: ViewStyle;
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  error,
  autoCapitalize = 'none',
  style,
}: InputProps) {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.neutral[400]}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  } as ViewStyle,
  label: {
    ...Typography.label,
    color: Colors.neutral[700],
    marginBottom: Spacing.xs,
  } as TextStyle,
  input: {
    borderWidth: 1.5,
    borderColor: Colors.neutral[300],
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: Colors.neutral[900],
    backgroundColor: Colors.neutral[50],
  } as TextStyle,
  inputError: {
    borderColor: Colors.error[500],
  } as TextStyle,
  errorText: {
    ...Typography.small,
    color: Colors.error[600],
    marginTop: Spacing.xs,
  } as TextStyle,
});
