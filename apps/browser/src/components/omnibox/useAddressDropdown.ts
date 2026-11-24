import { useBrowser } from '../../state/window';
import { geometry, palette, placePopover, space, useTheme } from '../ui';

export function useAddressDropdown() {
  const omnibox = useBrowser(s => s.omnibox);
  const anchor = useBrowser(s => s.anchors.address);
  const bounds = useBrowser(s => s.windowSize);
  const popup = useBrowser(s => s.panel === 'newTab' || s.panel === 'location');
  const { dark, accent } = useTheme();
  const items = !popup && omnibox?.owner === 'address' ? omnibox.items : null;
  const width = Math.min(bounds.width - space.sm * 2, Math.max(anchor?.width ?? 0, geometry.dialogWide));
  const dropdownDark = omnibox?.addressDark ?? dark;
  const colors = palette(dropdownDark ? 'dark' : 'light', accent);
  const layout = { omnibox, items, anchor, bounds, width, colors };
  if (!anchor || !items?.length || width <= 0) return { ...layout, joined: undefined };
  const { left } = placePopover(anchor, { width }, bounds, 'below-start', 0);
  const joined = {
    left: Math.abs(left - anchor.x) < geometry.hairline,
    right: Math.abs(left + width - anchor.x - anchor.width) < geometry.hairline,
  };
  return { ...layout, joined };
}
