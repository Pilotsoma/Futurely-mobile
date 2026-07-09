import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native'
import { colors, radii, spacing, typography } from '../../theme/tokens'

interface InputProps extends TextInputProps {
  label?: string
  error?: string
}

export function Input({ label, error, style, onFocus, onBlur, ...rest }: InputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)

  const borderColor = error ? colors.error : focused ? colors.primary : colors.border

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, { borderColor }, style]}
        placeholderTextColor={colors.textSecondary}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: typography.body.fontSize,
  },
  error: { ...typography.caption, color: colors.error },
})
