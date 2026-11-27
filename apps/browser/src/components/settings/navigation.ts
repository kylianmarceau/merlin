export const sections = [
  { id: 'about', label: 'About' },
  { id: 'general', label: 'General' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'workspaces', label: 'Spaces' },
  { id: 'blocking', label: 'Blocking' },
  { id: 'performance', label: 'Performance' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'keys', label: 'Keys' },
  { id: 'config', label: 'Config File' },
] as const;
export type SettingsSection = typeof sections[number]['id'];

type Page = { section: SettingsSection; query: string; highlight?: string };
type History = { pages: Page[]; index: number };
type Navigation =
  | { type: 'open'; section: SettingsSection; highlight?: string }
  | { type: 'search'; query: string }
  | { type: 'step'; by: -1 | 1 };

export const initialHistory: History = { pages: [{ section: 'appearance', query: '' }], index: 0 };

export function navigate(history: History, action: Navigation): History {
  const { pages, index } = history;
  const current = pages[index];
  if (action.type === 'step') {
    return { pages, index: Math.max(0, Math.min(index + action.by, pages.length - 1)) };
  }
  if (action.type === 'search') {
    if (!action.query && current.query) return { pages: pages.slice(0, index), index: index - 1 };
    if (current.query) return { pages: [...pages.slice(0, index), { ...current, query: action.query }], index };
    if (!action.query) return history;
    return { pages: [...pages.slice(0, index + 1), { section: current.section, query: action.query }], index: index + 1 };
  }
  if (!current.query && current.section === action.section && current.highlight === action.highlight) return history;
  return { pages: [...pages.slice(0, index + 1), { section: action.section, highlight: action.highlight, query: '' }], index: index + 1 };
}
