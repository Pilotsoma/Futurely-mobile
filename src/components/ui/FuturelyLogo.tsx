// FuturelyLogo — matches the student app shell's brand mark.
//
// The web student app (app/(app)/layout.tsx) uses:
//   <Image src="/logo.png" alt="Futurely" width={44} height={44} />
//   with "Futurely" wordmark next to it (18px / weight 700 / letterSpacing -0.4).
//
// Mobile mirrors that: a PNG at {size}×{size} + optional wordmark.
// The logo.png asset already lives at nextstep-mobile/assets/logo.png.
// No SVG or gradient library is needed (none installed per ARCHITECTURE.md).

import React from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'

// The asset path is resolved by Metro's require() — must be a static literal.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_ASSET = require('../../../assets/logo.png') as number

interface FuturelyLogoProps {
  /** Square side length in logical pixels. Default: 44 (matches web sidebar). */
  size?: number
  /** Show the "Futurely" wordmark to the right of the logo. Default: true. */
  showWordmark?: boolean
}

export default function FuturelyLogo({
  size = 44,
  showWordmark = true,
}: FuturelyLogoProps): React.JSX.Element {
  const { theme } = useTheme()

  return (
    <View style={styles.row}>
      <Image
        source={LOGO_ASSET}
        style={{ width: size, height: size, borderRadius: size * 0.18 }}
        accessibilityLabel="Futurely logo"
        resizeMode="contain"
      />
      {showWordmark && (
        <Text
          style={[
            styles.wordmark,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizeXl,
            },
          ]}
          accessibilityRole="text"
          numberOfLines={1}
        >
          Futurely
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wordmark: {
    fontWeight: '700',
    letterSpacing: -0.4,
  },
})
