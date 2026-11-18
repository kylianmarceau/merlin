// The slider's behaviour without its drawing, so it can be tested: where an
// arrow key or VoiceOver's increment and decrement move it, and what it tells
// VoiceOver about itself. A disabled slider offers no actions, ignores any
// that arrive anyway and says it is disabled (M37).

/** How far one arrow key or VoiceOver step moves a 0 to 1 slider. */
export const sliderStep = 0.1;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** The value one step up or down from `value`, on the tenths; null when nothing should change. */
export function steppedValue(value: number, action: string, disabled: boolean): number | null {
  if (disabled) return null;
  const delta = action === 'increment' || action === 'ArrowRight' ? sliderStep
    : action === 'decrement' || action === 'ArrowLeft' ? -sliderStep : 0;
  if (!delta) return null;
  const next = clamp(Math.round((value + delta) * 10) / 10);
  return next === value ? null : next;
}

/** The accessibility props for a slider: actions only while it can move, and its disabled state. */
export function sliderAccessibility(disabled: boolean) {
  return {
    accessibilityState: { disabled },
    accessibilityActions: disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }],
  };
}
