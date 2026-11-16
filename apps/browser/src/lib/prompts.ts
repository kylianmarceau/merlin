// How a browser prompt is labelled: plain data in, plain data out.
import { securityBadge } from './security';
/** The parts of a browser prompt these helpers read. */
export type PromptFacts = { kind: string; origin: string; title: string; security?: string };

export type PromptIcon = 'hand.raised' | 'lock' | 'exclamationmark.triangle' | 'exclamationmark.octagon' | 'info.circle' |
  'character.bubble' | 'key' | 'creditcard' | 'mappin.and.ellipse' | 'bookmark.fill' | 'arrow.up.forward.app' | 'bell.badge';

/** The symbol a prompt leads with, from what native code says it is. */
export function promptIcon(prompt: PromptFacts): PromptIcon {
  // Site information leads with the same badge as the address field.
  if (prompt.security) return securityBadge(prompt.security).icon;
  if (prompt.kind === 'permission') return 'hand.raised';
  const title = prompt.title.toLowerCase();
  if (prompt.origin === 'Translate' || title.includes('translat')) return 'character.bubble';
  if (title.includes('password')) return 'key';
  if (title.includes('card')) return 'creditcard';
  if (title.includes('address')) return 'mappin.and.ellipse';
  if (title.includes('bookmark')) return 'bookmark.fill';
  if (title.includes('app')) return 'arrow.up.forward.app';
  return 'bell.badge';
}

/** A short name for a waiting request, shown on its toolbar chip. */
export function promptChipLabel(prompt: PromptFacts) {
  if (prompt.kind === 'permission') return 'Permission';
  if (prompt.origin === 'Translate') return 'Translate';
  const title = prompt.title.toLowerCase();
  if (title.includes('password')) return 'Password';
  if (title.includes('card') || title.includes('address')) return 'Autofill';
  return 'Request';
}
