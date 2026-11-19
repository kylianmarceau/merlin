import React from 'react';
import { Pressable as NativePressable, type PressableProps, type View } from 'react-native';
import { accessibilityPress } from './interaction';

/**
 * React Native's Pressable, answering VoiceOver's press too (VO-Space): React
 * Native macOS performs an accessibility press only on views that handle
 * onAccessibilityTap, so a plain Pressable can't be pressed with VoiceOver.
 * A control that acts as it is pressed down (a tab) answers with that.
 */
export const Pressable = React.forwardRef<View, PressableProps>(function Pressable(props, ref) {
  return <NativePressable ref={ref} onAccessibilityTap={accessibilityPress(props.onPress ?? props.onPressIn, props.disabled)} {...props} />;
});
