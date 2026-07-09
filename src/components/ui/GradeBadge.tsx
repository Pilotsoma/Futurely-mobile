import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, gradeColors } from '../../theme/tokens'

type Letter = keyof typeof gradeColors

interface GradeBadgeProps {
  letter: string | null
  size?: 'sm' | 'lg'
}

function isLetter(l: string): l is Letter {
  return l === 'A' || l === 'B' || l === 'C' || l === 'D' || l === 'F'
}

export function GradeBadge({ letter, size = 'sm' }: GradeBadgeProps): React.JSX.Element {
  const color = letter && isLetter(letter) ? gradeColors[letter] : colors.textMuted
  const dimension = size === 'lg' ? 40 : 28

  return (
    <View
      style={[
        styles.badge,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          borderColor: color,
          backgroundColor: `${color}22`,
        },
      ]}
      accessibilityLabel={letter ? `Grade ${letter}` : 'No grade available'}
    >
      <Text style={[styles.text, { color, fontSize: size === 'lg' ? 18 : 13 }]}>{letter ?? '—'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.bold, fontWeight: '700' },
})
