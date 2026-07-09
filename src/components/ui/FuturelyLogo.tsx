import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme/tokens'

interface FuturelyLogoProps {
  size?: number
}

// Rounded square, brand blue bg, cyan accent stripe, white "F" glyph — per DESIGN_SYSTEM.md.
// Pure View/Text, no external asset or SVG package required.
export function FuturelyLogo({ size = 40 }: FuturelyLogoProps): React.JSX.Element {
  return (
    <View
      style={[styles.container, { width: size, height: size, borderRadius: size * 0.22 }]}
      accessibilityLabel="Futurely logo"
    >
      <View
        style={[
          styles.stripe,
          { height: size * 0.18, borderTopLeftRadius: size * 0.22, borderTopRightRadius: size * 0.22 },
        ]}
      />
      <Text style={[styles.glyph, { fontSize: size * 0.5 }]}>F</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.info,
  },
  glyph: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
})
