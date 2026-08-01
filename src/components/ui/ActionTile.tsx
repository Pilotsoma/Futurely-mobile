import React, { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Feather } from '@expo/vector-icons'

import { colors, fonts, touchTarget } from '../../theme/tokens'

type FeatherName = React.ComponentProps<typeof Feather>['name']

interface ActionTileProps {
  title: string
  subtitle?: string
  meta?: string
  badge?: string
  icon: FeatherName
  color: string
  iconBackground: string
  onPress: () => void
  disabled?: boolean
  accessibilityHint?: string
  testID?: string
  style?: StyleProp<ViewStyle>
}

export function ActionTile({
  title,
  subtitle,
  meta,
  badge,
  icon,
  color,
  iconBackground,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
  style,
}: ActionTileProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)

  return (
    <View
      style={[
        styles.shell,
        { borderLeftColor: color },
        hovered && !disabled && styles.hovered,
        focused && !disabled && styles.focused,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint ?? subtitle}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPress={onPress}
        style={({ pressed }) => [
          styles.pressable,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.icon,
            {
              backgroundColor: iconBackground,
              borderColor: `${color}66`,
            },
          ]}
        >
          <Feather name={icon} size={19} color={color} />
        </View>

        <View pointerEvents="none" style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {title}
            </Text>
            {badge ? (
              <View style={[styles.badge, { borderColor: `${color}66` }]}>
                <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
                  {badge}
                </Text>
              </View>
            ) : null}
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
              {meta}
            </Text>
          ) : null}
        </View>

        <View pointerEvents="none" style={styles.chevron}>
          <Feather name="chevron-right" size={16} color="#8EA4C1" />
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 94,
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#16243A',
    borderWidth: 1,
    borderColor: '#2B4262',
    borderLeftWidth: 3,
  },
  pressable: {
    position: 'relative',
    flex: 1,
    minHeight: 94,
    width: '100%',
    minWidth: 0,
    justifyContent: 'center',
    paddingLeft: 64,
    paddingRight: 42,
    paddingVertical: 12,
  },
  hovered: {
    borderColor: colors.borderHover,
    backgroundColor: '#192A43',
  },
  focused: {
    borderColor: '#A990FF',
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.88,
    backgroundColor: '#1D304B',
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    position: 'absolute',
    left: 10,
    top: 25,
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
  },
  copy: {
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
    color: '#F5F7FF',
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8494AB',
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
  },
  meta: {
    color: '#A9B7CC',
    fontFamily: fonts.medium,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '500',
  },
  badge: {
    maxWidth: 64,
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(7, 8, 15, 0.42)',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  chevron: {
    position: 'absolute',
    right: 8,
    top: 29,
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#0D1726',
    borderWidth: 1,
    borderColor: 'rgba(123,151,188,0.25)',
  },
})
