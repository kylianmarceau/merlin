export const textures = ['grain', 'sand', 'denim', 'tweed'] as const;
export type WorkspaceTheme = {
  stops: string[];
  intensity: number;
  translucency: number;
  angle: number;
  noise: number;
  texture: typeof textures[number];
};

export function newWorkspaceTheme(color: string): WorkspaceTheme {
  return { stops: [color], intensity: .55, translucency: .7, angle: 135, noise: 0, texture: 'grain' };
}

export function parseWorkspaceTheme(value: unknown): WorkspaceTheme | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Partial<WorkspaceTheme>;
  const amount = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;
  if (!Array.isArray(t.stops) || t.stops.length < 1 || t.stops.length > 3 ||
      !t.stops.every(s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)) ||
      !amount(t.intensity) || !amount(t.translucency) || !amount(t.noise) ||
      typeof t.angle !== 'number' || t.angle < 0 || t.angle > 360 ||
      !Number.isFinite(t.angle) || !t.texture || !textures.includes(t.texture)) return null;
  return { stops: t.stops, intensity: t.intensity, translucency: t.translucency,
    noise: t.noise, texture: t.texture, angle: t.angle };
}
