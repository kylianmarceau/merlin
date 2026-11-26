// The preview window's canvas, content and look. Adapted from Ardia's
// onboarding previews (geometry.ts, content.ts, look.ts; Apache-2.0, see
// NOTICE), drawn with Merlin's measurements and colour roles.
import { StyleSheet, type ViewStyle } from 'react-native';
import { palette, setupMock as M, setupMockInk as ink, type AccentName, type Palette, type SymbolName } from '../../ui';
import type { WorkspaceTheme } from '../../../state/workspaceTheme';

export type Geo = { s: number; W: number; H: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** The canvas scaled to fit `width` × `height`: `s` points per canvas point, `W` × `H` the canvas it shows. */
export function geo(width: number, height: number): Geo {
  const s = Math.min(width / M.canvas.width, height / M.canvas.height);
  return { s, W: width / s, H: height / s };
}

export const fill = StyleSheet.absoluteFillObject;
export const hairline = StyleSheet.hairlineWidth;
export const at = (g: Geo, x: number, y: number, w: number, h: number): ViewStyle =>
  ({ position: 'absolute', left: x * g.s, top: y * g.s, width: w * g.s, height: h * g.s });
export const atRect = (g: Geo, r: Rect) => at(g, r.x, r.y, r.w, r.h);

export const rowY = (i: number, top: number = M.row.top) => top + i * M.row.pitch;
export const chipStep = M.chip.w + M.chip.gap;
export const chipX = (i: number) => M.chip.x + i * chipStep;
export const restRowCount = (g: Geo) => Math.max(1, Math.min(6, Math.floor((g.H - M.row.topWithField - M.row.pitch - M.crumbTrailing) / M.row.pitch)));
export const restChipCount = (g: Geo) => Math.max(1, Math.min(4, Math.floor((g.W - M.chip.x - 2 * M.crumbTrailing) / chipStep)));

/** Where the page sits: beside the sidebar, or under the tabs. `frame` is Merlin's page frame (0 is edge to edge). */
export function restCard(g: Geo, top: boolean, frame: number): Rect {
  if (top) return { x: frame, y: M.strip, w: g.W - 2 * frame, h: g.H - M.strip - frame };
  const x = M.sidebar + Math.max(0, frame - M.row.x);
  return { x, y: frame, w: g.W - x - frame, h: g.H - 2 * frame };
}
export const cardRadius = (frame: number) => frame >= M.defaultFrame ? M.cardRadius : frame > 0 ? M.thinRadius : 0;

// Sites in the preview's tabs. `mark` is one of setup's bundled site icons;
// the others draw a tinted tile with a symbol, as a page without an icon does.
export type Tab = { title: string; host: string; mark?: string; color: string; icon: SymbolName };
export const TABS: readonly Tab[] = [
  { title: 'Field notes', host: 'fieldnotes.blog', color: ink.tabs.notes, icon: 'leaf.fill' },
  { title: 'Inbox', host: 'mail.google.com', mark: 'gmail', color: ink.tabs.mail, icon: 'envelope.fill' },
  { title: 'Trail map', host: 'maps.trails.no', color: ink.tabs.maps, icon: 'map.fill' },
  { title: 'Weekend plans', host: 'calendar.google.com', mark: 'calendar', color: ink.tabs.docs, icon: 'doc.text.fill' },
  { title: 'Focus mix', host: 'open.spotify.com', mark: 'spotify', color: ink.tabs.music, icon: 'music.note' },
  { title: 'Sourdough, day 2', host: 'notion.so', mark: 'notion', color: ink.tabs.cooking, icon: 'fork.knife' },
  { title: 'Pull requests', host: 'github.com', mark: 'github', color: ink.tabs.code, icon: 'arrow.triangle.pull' },
];
export const NEW_TAB: Tab = { title: 'New Tab', host: '', color: ink.tabs.newTab, icon: 'plus' };
export const BLANK: Tab = { title: 'New Tab', host: '', color: ink.tabs.blank, icon: 'globe' };
export const tab = (i: number) => TABS[i % TABS.length];

export type Article = { site: string; band: readonly [string, string]; title: string; byline: string; body: string; picture: 'fjord' | 'dawn' };
export const NOTES: Article = {
  site: 'Field notes', band: ink.band.notes, picture: 'fjord',
  title: 'First light on the fjord', byline: 'Western Norway · 5 min read',
  body: 'From the shore, the peaks catch the sun long before the village wakes. We walked out along the water until the boathouses ran out.',
};
export const TRIP: Article = {
  site: 'Trail map', band: ink.band.trip, picture: 'dawn',
  title: 'The coastal route', byline: 'Itinerary · 12 stops · shared with 2',
  body: 'Day one starts at the harbour before the ferries, then climbs the ridge path to the old lighthouse while the light is still low.',
};

export type Suggestion = { icon?: SymbolName; fav?: Tab; title: string; detail?: string; hint?: string };
export const CURRENT: Suggestion[] = [
  { fav: tab(0), title: 'First light on the fjord', detail: 'fieldnotes.blog' },
  { fav: tab(2), title: 'Trail map', hint: 'Switch to Tab' },
  { icon: 'magnifyingglass', title: 'fjord walks' },
];
export const FRESH: Suggestion[] = [
  { fav: tab(1), title: 'Inbox', hint: 'Switch to Tab' },
  { fav: tab(3), title: 'Weekend plans', detail: 'calendar.google.com' },
  { icon: 'clock', title: 'fjord walks' },
];

/** Merlin's palette for the preview's appearance and workspace colour. */
export type Look = { dark: boolean; c: Palette; accent: AccentName; theme: WorkspaceTheme | null; site: string };
const looks = new Map<string, Look>();
export function lookFor(dark: boolean, accent: AccentName, theme: WorkspaceTheme | null): Look {
  const key = `${dark}|${accent}|${theme ? JSON.stringify(theme) : ''}`;
  const known = looks.get(key);
  if (known) return known;
  const look = { dark, c: palette(dark ? 'dark' : 'light', accent), accent, theme, site: ink.band.notes[dark ? 1 : 0] };
  if (looks.size > 64) looks.clear();
  looks.set(key, look);
  return look;
}
export const pick = <T,>(look: Look, pair: readonly [T, T]) => pair[look.dark ? 1 : 0];

export type SceneOpts = {
  top: boolean; addressInSidebar: boolean; siteColor: boolean; frame: number; accent: AccentName; theme: WorkspaceTheme | null;
  /** The sites chosen as favourites, by their mark. */
  favorites: readonly string[];
};
