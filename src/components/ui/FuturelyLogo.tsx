import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface Props {
  size?: number
}

export default function FuturelyLogo({ size = 40 }: Props): React.JSX.Element {
  const radius = Math.round(size * 0.22)
  const fontSize = Math.round(size * 0.52)

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
      <View style={[styles.accent, { width: Math.round(size * 0.55), borderRadius: Math.round(size * 0.06) }]} />
      <Text style={[styles.letter, { fontSize, lineHeight: size }]}>F</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#2979FF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    top: 0,
    height: 3,
    backgroundColor: '#00E5FF',
    opacity: 0.85,
  },
  letter: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
})
