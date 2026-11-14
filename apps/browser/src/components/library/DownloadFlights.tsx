import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image } from 'react-native';
import { useFileIcon } from '../../state/fileIcons';
import type { Rect } from '../../state/types';
import { useActions, useBrowser, useSnapshot } from '../../state/window';
import { Icon, duration, flyTo, geometry, useFlightValues, useTheme, useTimeout } from '../ui';

type Point = { x: number; y: number };
type Flight = { id: string; name: string };

/** The most icons in the air at once; more downloads starting together only count in the button. */
const maxFlights = 3;

/**
 * When a download starts, its file's icon lifts off the page and flies into
 * the downloads button, as in Safari, so it is clear where the file went.
 * Only downloads that start while the window is open fly, and only when the
 * button is on screen.
 */
export function DownloadFlights() {
  const snapshot = useSnapshot();
  const actions = useActions();
  const anchor = useBrowser(s => s.anchors.downloads);
  const size = useBrowser(s => s.windowSize);
  const seen = useRef<Set<string> | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  // The button is in the sidebar's footer or the strip across the top, both hidden with the tabs.
  const buttonShown = !snapshot.modal.sidebarHidden && !snapshot.fullscreen && !!anchor;
  useEffect(() => {
    const ids = snapshot.downloads.map(d => d.id);
    if (!seen.current) { seen.current = new Set(ids); return; }
    const known = seen.current;
    const started = snapshot.downloads.filter(d => !known.has(d.id) && d.state === 'progress');
    ids.forEach(id => known.add(id));
    if (started.length && buttonShown)
      setFlights(current => [...current, ...started.map(d => ({ id: d.id, name: d.name }))].slice(-maxFlights));
  }, [snapshot.downloads]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!flights.length || !anchor) return null;
  const from = { x: size.width / 2, y: size.height / 2 };
  const to = centre(anchor);
  return <>{flights.map(f => <FlyingIcon key={f.id} name={f.name} from={from} to={to}
    onDone={() => { setFlights(current => current.filter(other => other.id !== f.id)); actions.downloadLanded(); }} />)}</>;
}

function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** One file's icon in flight; it waits a moment for Finder's icon, then goes with or without it. */
function FlyingIcon({ name, from, to, onDone }: { name: string; from: Point; to: Point; onDone(): void }) {
  const { reduceMotion } = useTheme();
  const uri = useFileIcon(name, geometry.flyingIcon);
  const values = useFlightValues(from);
  const [waited, setWaited] = useState(false);
  useTimeout(() => setWaited(true), duration.fast, []);
  const go = waited || !!uri;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!go) return;
    const run = flyTo(values, from, to, reduceMotion);
    run.start(({ finished }) => { if (finished) done.current(); });
    return () => run.stop();
  }, [go]);  // eslint-disable-line react-hooks/exhaustive-deps
  const side = geometry.flyingIcon;
  return <Animated.View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: 0, top: 0, width: side, height: side,
    marginLeft: -side / 2, marginTop: -side / 2, alignItems: 'center', justifyContent: 'center', opacity: values.opacity,
    transform: [{ translateX: values.x }, { translateY: values.y }, { scale: values.scale }] }}>
    {uri ? <Image source={{ uri }} style={{ width: side, height: side }} /> : <Icon name="doc" tone="iconSecondary" size="large" />}
  </Animated.View>;
}
