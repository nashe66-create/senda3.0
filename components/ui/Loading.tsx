import { ActivityIndicator, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/lib/theme';

interface LoadingProps {
  style?: ViewStyle;
  size?: 'small' | 'large';
}

export function Loading({ style, size = 'large' }: LoadingProps) {
  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size={size} color={Colors.primary[600]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  } as ViewStyle,
});
