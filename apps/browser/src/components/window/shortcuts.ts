import { useSnapshot } from '../../state/window';

/**
 * A control's tooltip as Dia writes it, its name and its shortcut as keys,
 * with Merlin's Normal-mode keys on a second line while modal browsing is on.
 */
export function useShortcut(tip: string, keys: string[], normal?: string) {
  const modal = useSnapshot().modal.modalBrowsing !== false;
  return { tip, keys, detail: normal && modal ? `Normal mode: ${normal}` : undefined };
}
