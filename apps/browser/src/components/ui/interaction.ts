import { useState } from 'react';

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
