import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native'
import { colors, radii, touchTarget, typography } from '../../theme/tokens'

type ButtonVariant = 'primary' | 'secondary' | 'destructive'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled === true || loading === true

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.primary : '#FFFFFF'} size="small" />
      ) : (
        <Text style={[styles.label, textColor[variant]]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    minWidth: touchTarget,
    minHeight: touchTarget,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  label: { ...typography.h3 },
})

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.buttonSecondaryBorder },
  destructive: { backgroundColor: colors.error },
}

const textColor: Record<ButtonVariant, { color: string }> = {
  primary: { color: '#FFFFFF' },
  secondary: { color: colors.text },
  destructive: { color: '#FFFFFF' },
}
