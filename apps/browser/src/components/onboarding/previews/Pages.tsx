// Pages in the preview window. Laid out as Ardia's onboarding mock pages
// (MockPages.tsx; Apache-2.0, see NOTICE), with Merlin's own paintings and
// new tab page.
import React, { type ReactNode } from 'react';
import { Image, View } from 'react-native';
import { font, radius, setupMock as M, space } from '../../ui';
import { Favicon, Label, MockGlyph } from './Kit';
import { fill, hairline, NOTES, pick, TABS, type Article, type Geo, type Look } from './mock';

const pictures = {
  fjord: require('../../../../../../packages/shell/macos/Onboarding/MerlinAlpenglow.jpg'),
  dawn: require('../../../../../../packages/shell/macos/Onboarding/MerlinDawn.jpg'),
};
const appIcon = require('../../../../../../packages/shell/macos/AppIcons/MerlinAppIcon-default.png');

export function Page({ g, look, a = NOTES, top = 0, children }: { g: Geo; look: Look; a?: Article; top?: number; children?: ReactNode }) {
  const c = look.c;
  const P = M.page;
  return <View pointerEvents="none" style={[fill, { top: top * g.s, backgroundColor: c.contentBackground }]}>
    <View style={{ height: P.band * g.s, backgroundColor: pick(look, a.band), flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: space.xxl * g.s, justifyContent: 'space-between' }}>
      <Label g={g} size={P.siteSize} color={c.textPrimary} weight="bold" serif>{a.site}</Label>
      <View style={{ flexDirection: 'row', flexShrink: 1, columnGap: space.lg * g.s, marginLeft: space.lg * g.s, overflow: 'hidden' }}>
        {['Journal', 'Maps', 'About'].map(n => <Label key={n} g={g} size={P.captionSize} color={c.textSecondary}>{n}</Label>)}
      </View>
    </View>
    <View style={{ alignSelf: 'center', width: `${P.columnShare * 100}%`, maxWidth: P.column * g.s, paddingTop: space.xl * g.s, gap: space.md * g.s }}>
      <Image accessible={false} source={pictures[a.picture]} resizeMode="cover"
        style={{ width: '100%', height: P.hero * g.s, borderRadius: radius.card * g.s }} />
      <View style={{ gap: space.xs * g.s }}>
        <Label g={g} size={P.titleSize} color={c.textPrimary} weight="bold" serif lines={2}>{a.title}</Label>
        <Label g={g} size={P.captionSize} color={c.textTertiary}>{a.byline}</Label>
      </View>
      <Label g={g} size={P.bodySize} color={c.textSecondary} lines={4} style={{ lineHeight: P.bodyLine * g.s }}>{a.body}</Label>
      {children}
    </View>
  </View>;
}

/** Merlin's new tab page: its mark, the search field and favourite sites. */
export function NewTabPage({ g, look, top = 0, width }: { g: Geo; look: Look; top?: number; width: number }) {
  const c = look.c;
  const N = M.ntp;
  const barW = Math.min(N.barMax, width - space.huge * 1.25);
  return <View pointerEvents="none" style={[fill, { top: top * g.s, alignItems: 'center', backgroundColor: c.startBackground }]}>
    <Image accessible={false} source={appIcon} resizeMode="contain"
      style={{ marginTop: (N.barTop - N.tile * 1.6) * g.s, width: N.tile * 1.3 * g.s, height: N.tile * 1.3 * g.s }} />
    <View style={{ marginTop: space.lg * g.s, width: barW * g.s, height: N.bar * g.s, borderRadius: N.barRadius * g.s,
      backgroundColor: c.omniboxActive, borderWidth: hairline, borderColor: c.borderDefault, flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: space.lg * g.s, gap: space.sm * g.s }}>
      <MockGlyph g={g} name="magnifyingglass" size={M.glyph.nav} color={c.textSecondary} box={M.suggestion.iconBox} />
      <Label g={g} size={font.size.title} color={c.textTertiary}>Search or enter an address</Label>
    </View>
    <View style={{ flexDirection: 'row', gap: space.lg * g.s, marginTop: space.xl * g.s }}>
      {TABS.slice(1, 7).map(t => <View key={t.title} style={{ width: N.tile * g.s, height: N.tile * g.s, borderRadius: N.tileRadius * g.s,
        backgroundColor: c.fillControl, borderWidth: hairline, borderColor: c.borderSubtle, alignItems: 'center', justifyContent: 'center' }}>
        <Favicon g={g} t={t} look={look} size={N.favicon} />
      </View>)}
    </View>
  </View>;
}
