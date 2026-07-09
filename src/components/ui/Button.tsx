import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { animation, colors, elevation, radii, touchTarget, typography } from '../../theme/tokens'

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
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    // `style` is applied to both layers: the outer Pressable needs it for
    // layout props (flex:1 for equal-width button rows — the Pressable is the
    // actual flex item), and the inner Animated.View needs it too since several
    // callers override the default height/padding (e.g. compact 36px action
    // buttons) and that override must win over `styles.base`, applied after it.
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!isDisabled) scale.value = withSpring(0.96, animation.spring)
      }}
      onPressOut={() => {
        scale.value = withSpring(1, animation.spring)
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={style}
    >
      <Animated.View
        style={[styles.base, variantStyles[variant], isDisabled && styles.disabled, animatedStyle, style]}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'secondary' ? colors.primary : '#FFFFFF'} size="small" />
        ) : (
          <Text style={[styles.label, textColor[variant]]}>{label}</Text>
        )}
      </Animated.View>
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
  label: { ...typography.h3 },
})

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primary, ...elevation.sm },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.buttonSecondaryBorder },
  destructive: { backgroundColor: colors.error, ...elevation.sm },
}

const textColor: Record<ButtonVariant, { color: string }> = {
  primary: { color: '#FFFFFF' },
  secondary: { color: colors.text },
  destructive: { color: '#FFFFFF' },
}
