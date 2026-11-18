// A list row's secondary actions (edit, delete, move), offered three ways so
// none needs a pointer: as buttons that show while the row is hovered,
// selected or has keyboard focus; as VoiceOver custom actions, in the
// Actions menu (VO-Command-Space); and as keys pressed while the row has
// focus (M13).

/** A key with its modifiers; a modifier left out must be up. */
export type RowKey = { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean };

export type RowAction = {
  /** A stable name, passed back by VoiceOver. */
  name: string;
  /** What VoiceOver reads in its Actions menu. */
  label: string;
  key?: RowKey;
  run(): void;
};

type KeyEventLike = { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean };
const modifiers = ['metaKey', 'altKey', 'shiftKey', 'ctrlKey'] as const;

/** Every modifier stated, so the native view claims only these exact keys. */
function exact(key: RowKey) {
  return { key: key.key, ...Object.fromEntries(modifiers.map(m => [m, !!key[m]])) } as Required<RowKey>;
}

/**
 * The keys a focused row claims from the system: Return and Space still
 * press it (a Pressable's own keys, which a `keyDownEvents` prop replaces),
 * then each action's key.
 */
export function rowKeyDownEvents(actions: readonly RowAction[]): RowKey[] {
  return [{ key: 'Enter' }, { key: ' ' }, ...actions.flatMap(a => (a.key ? [exact(a.key)] : []))];
}

/** The action a key press asks for, if any: the key and every modifier must match. */
export function rowActionForKey(actions: readonly RowAction[], event: KeyEventLike): RowAction | undefined {
  return actions.find(a => a.key && a.key.key === event.key && modifiers.every(m => !!a.key![m] === !!event[m]));
}

/** The VoiceOver custom actions: on macOS only actions with a label are listed. */
export function rowAccessibilityActions(actions: readonly RowAction[]) {
  return actions.map(({ name, label }) => ({ name, label }));
}

/** The action VoiceOver asked for by name. */
export function rowActionNamed(actions: readonly RowAction[], name: string): RowAction | undefined {
  return actions.find(a => a.name === name);
}

const glyphs: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Enter: '↩' };

/** A key as the menus write it, such as ⌘⌫ or ⌥↑. */
export function keyGlyphs(key: RowKey): string {
  return `${key.ctrlKey ? '⌃' : ''}${key.altKey ? '⌥' : ''}${key.shiftKey ? '⇧' : ''}${key.metaKey ? '⌘' : ''}${glyphs[key.key] ?? key.key.toUpperCase()}`;
}
