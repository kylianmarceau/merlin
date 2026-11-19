import { useState } from 'react';
import type { GestureResponderEvent } from 'react-native';

/** Hover and keyboard focus for Pressables, which report them as events. */
export function useInteraction() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return {
    hovered, focused,
    handlers: {
      onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false),
      onFocus: () => setFocused(true), onBlur: () => setFocused(false),
    },
  };
}

/**
 * VoiceOver's press (VO-Space) for a pressable: React Native macOS answers
 * an accessibility press only for views with onAccessibilityTap, so without
 * this a button works with the pointer and the keyboard but not VoiceOver.
 * The press arrives as an event with no modifier keys.
 */
export function accessibilityPress(onPress: ((event: GestureResponderEvent) => void) | null | undefined, disabled?: boolean | null) {
  return onPress && !disabled ? () => onPress({ nativeEvent: {} } as GestureResponderEvent) : undefined;
}
