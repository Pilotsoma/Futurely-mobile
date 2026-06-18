import React from 'react'
import { Text as RNText, type StyleProp, type TextStyle, type TextProps as RNTextProps } from 'react-native'

type Variant = 'display' | 'heading' | 'h2' | 'h3' | 'body' | 'caption' | 'label'

interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: Variant
  color?: string
  className?: string
  style?: StyleProp<TextStyle>
  children: React.ReactNode
}

const variantClasses: Record<Variant, string> = {
  display: 'text-[32px] font-bold tracking-[-0.5px] text-[#EDEEFF] leading-[36px]',
  heading: 'text-[24px] font-bold tracking-[-0.3px] text-[#EDEEFF] leading-[30px]',
  h2: 'text-[20px] font-semibold text-[#EDEEFF] leading-[28px]',
  h3: 'text-[16px] font-semibold text-[#EDEEFF] leading-[22px]',
  body: 'text-[15px] font-normal text-[#EDEEFF] leading-6',
  caption: 'text-[12px] font-normal text-[#8B8FB5] leading-5',
  label: 'text-[12px] font-semibold uppercase tracking-[0.8px] text-[#8B8FB5] leading-5',
}

export default function Text({
  variant = 'body',
  color,
  className,
  style,
  children,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <RNText
      className={`${variantClasses[variant]} ${className ?? ''}`}
      style={[color !== undefined ? { color } : undefined, style]}
      {...rest}
    >
      {children}
    </RNText>
  )
}
