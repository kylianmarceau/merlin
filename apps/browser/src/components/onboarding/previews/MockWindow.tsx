// Setup's preview window. One window stays on screen through setup: when a
// choice changes, its scene fades away, the window glides to its new shape,
// and the new choice's scene fades in and plays on a loop. Adapted from
// Ardia's onboarding previews (MockWindow.tsx, director.ts; Apache-2.0, see NOTICE).
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import {
  after, setupGeometry as G, setupMotion, setupScene, useFadeBetween, useLayerFade, useMockTo, useSceneLoop, useTheme, type AccentName,
} from '../../ui';
import type { WorkspaceTheme } from '../../../state/workspaceTheme';
import { WindowFrame } from './Kit';
import { GlassStage } from './GlassStage';
import {
  CmdlCentred, CmdlField, Favourites, NewTabOpensBar, NewTabOpensPage, Still, TabSwitch, appearance, links, newTabAt, quit, siteColor, tidy, windows,
  type Scene,
} from './Scenes';
import { WindowState } from './WindowState';
import { fill, geo, lookFor, type Geo, type Look, type SceneOpts } from './mock';

export type Shape = {
  top: boolean; addressInSidebar: boolean; dark: boolean; siteColor: boolean; frame: number; accent: AccentName; theme: WorkspaceTheme | null;
};
export type Demo = { id: string; duration: number; Scene: Scene };

const none: readonly string[] = [];

const shapeKey = (s: Shape) => [s.top, s.addressInSidebar, s.dark, s.siteColor, s.frame, s.accent, s.theme ? JSON.stringify(s.theme) : ''].join('|');

export const demos = {
  tabs: { id: 'tabs', duration: setupScene.tabs, Scene: TabSwitch },
  cmdlField: { id: 'cmdl-field', duration: setupScene.commandBar, Scene: CmdlField },
  cmdlCentred: { id: 'cmdl-centred', duration: setupScene.commandBar, Scene: CmdlCentred },
  newTabPage: { id: 'newtab-page', duration: setupScene.newTab, Scene: NewTabOpensPage },
  newTabBar: { id: 'newtab-bar', duration: setupScene.newTab, Scene: NewTabOpensBar },
  newTabTop: { id: 'newtabpos-top', duration: setupScene.newTabPosition, Scene: newTabAt('top') },
  newTabEnd: { id: 'newtabpos-end', duration: setupScene.newTabPosition, Scene: newTabAt('end') },
  newTabNext: { id: 'newtabpos-next', duration: setupScene.newTabPosition, Scene: newTabAt('adjacent') },
  tidyKeep: { id: 'tidy-keep', duration: setupScene.tidy, Scene: tidy(false) },
  tidyAuto: { id: 'tidy-auto', duration: setupScene.tidy, Scene: tidy(true) },
  quitRestore: { id: 'quit-restore', duration: setupScene.quit, Scene: quit(false) },
  quitFresh: { id: 'quit-fresh', duration: setupScene.quit, Scene: quit(true) },
  windowsSeparate: { id: 'windows-separate', duration: setupScene.windows, Scene: windows(false) },
  windowsShared: { id: 'windows-shared', duration: setupScene.windows, Scene: windows(true) },
  appearanceSystem: { id: 'appearance-system', duration: setupScene.appearance, Scene: appearance('system') },
  appearanceLight: { id: 'appearance-light', duration: setupScene.appearance, Scene: appearance('light') },
  appearanceDark: { id: 'appearance-dark', duration: setupScene.appearance, Scene: appearance('dark') },
  glass: { id: 'style-glass', duration: setupScene.rest, Scene: ({ g, look }) => <GlassStage g={g} look={look} glass /> },
  classic: { id: 'style-classic', duration: setupScene.rest, Scene: ({ g, look }) => <GlassStage g={g} look={look} glass={false} /> },
  siteOn: { id: 'sitecolor-on', duration: setupScene.siteColor, Scene: siteColor(true) },
  siteOff: { id: 'sitecolor-off', duration: setupScene.siteColor, Scene: siteColor(false) },
  linksSmall: { id: 'links-small', duration: setupScene.links, Scene: links(true) },
  linksTab: { id: 'links-tab', duration: setupScene.links, Scene: links(false) },
  favourites: { id: 'favourites', duration: setupScene.rest, Scene: Favourites },
  still: { id: 'still', duration: setupScene.rest, Scene: Still },
} satisfies Record<string, Demo>;

/**
 * Plays `demo` in a window of `shape`. A new demo or shape first fades the
 * old scene, then glides the window, then fades the new scene in.
 */
export const MockWindow = memo(function MockWindow({ width, height, shape, demo, favorites = none }: {
  width: number; height: number; shape: Shape; demo: Demo; favorites?: readonly string[];
}) {
  const { reduceMotion } = useTheme();
  const inner = { w: width - G.mockInsetX * 2, h: height - G.mockInsetTop - G.mockInsetBottom };
  const g = useMemo(() => geo(inner.w, inner.h), [inner.w, inner.h]);
  const wantKey = demo.id + '#' + shapeKey(shape);
  const [shown, setShown] = useState<{ shape: Shape; scene: string | null }>({ shape, scene: wantKey });
  const now = useRef(shown);
  now.current = shown;
  const demoOf = useRef(new Map<string, Demo>());
  demoOf.current.set(wantKey, demo);
  useEffect(() => {
    const at = now.current;
    if (at.scene === wantKey) return;
    const cancels: Array<() => void> = [];
    const later = (ms: number, run: () => void) => (ms > 0 && !reduceMotion ? cancels.push(after(ms, run)) : run());
    const leaving = at.scene !== null;
    if (leaving) setShown(s => ({ ...s, scene: null }));
    later(leaving ? setupMotion.focus : 0, () => {
      const morph = shapeKey(now.current.shape) !== shapeKey(shape);
      setShown(s => ({ ...s, shape }));
      later(morph ? setupMotion.move : 0, () => setShown({ shape, scene: wantKey }));
    });
    return () => cancels.forEach(cancel => cancel());
  }, [wantKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = shown.shape;
  const lay = useMockTo(s.top ? 1 : 0, false, setupMotion.move, reduceMotion);
  const addr = useMockTo(s.addressInSidebar ? 1 : 0, false, setupMotion.move, reduceMotion);
  const site = useMockTo(s.siteColor ? 1 : 0, true, setupMotion.fade, reduceMotion);
  const modes = useFadeBetween(s.dark, reduceMotion);
  const look = lookFor(s.dark, s.accent, s.theme);
  const opts: SceneOpts = { top: s.top, addressInSidebar: s.addressInSidebar, siteColor: s.siteColor, frame: s.frame, accent: s.accent, theme: s.theme, favorites };
  const base = (dark: boolean) => <WindowState g={g} look={lookFor(dark, s.accent, s.theme)} lay={lay} addr={addr} site={site} frame={s.frame} />;
  const layers = useSceneLayers(shown.scene);
  return <View style={{ width, height }}>
    <WindowFrame g={g} look={look} style={{ position: 'absolute', left: G.mockInsetX, top: G.mockInsetTop, width: inner.w, height: inner.h }}>
      {modes.layers.below !== null && <View style={fill}>{base(modes.layers.below)}</View>}
      <Animated.View style={[fill, { opacity: modes.layers.below !== null ? modes.fade : 1 }]}>{base(modes.layers.above)}</Animated.View>
      {layers.list.map(l => {
        const d = demoOf.current.get(l.key);
        return d && <SceneFade key={l.key} live={l.live} onGone={() => layers.gone(l.key)}>
          <Playing demo={d} g={g} look={look} opts={opts} />
        </SceneFade>;
      })}
    </WindowFrame>
  </View>;
});

function useSceneLayers(scene: string | null) {
  const [list, setList] = useState<Array<{ key: string; live: boolean }>>(() => (scene ? [{ key: scene, live: true }] : []));
  useEffect(() => {
    setList(prev => {
      const kept = prev.filter(l => l.key !== scene).map(l => ({ ...l, live: false })).slice(-1);
      return scene ? [...kept, { key: scene, live: true }] : kept;
    });
  }, [scene]);
  return { list, gone: (key: string) => setList(prev => prev.filter(l => l.key !== key || l.live)) };
}

function SceneFade({ live, onGone, children }: { live: boolean; onGone: () => void; children: React.ReactNode }) {
  const shown = useLayerFade(live, onGone);
  return <Animated.View style={[fill, { opacity: shown }]}>{children}</Animated.View>;
}

const Playing = memo(function Playing({ demo, g, look, opts }: { demo: Demo; g: Geo; look: Look; opts: SceneOpts }) {
  const { reduceMotion } = useTheme();
  const p = useSceneLoop(demo.duration, reduceMotion);
  const { Scene } = demo;
  return <>{Scene({ g, look, p, opts })}</>;
});
