// Merlin's own Clear Browsing Data: Chromium's data and WebKit pages' are
// cleared together (privacy.clearData), with one result. Chromium's own
// page stays one click away for passwords and autofill data.
import React, { useState } from 'react';
import { View } from 'react-native';
import { clearRanges as ranges, clearSince, type ClearRange } from '../../lib/clearData';
import type { ClearDataType } from '../../state/types';
import { useAction } from '../../state/window';
import { Button, Checkbox, FormGroup, FormRow, Icon, ListRow, Notice, PopUp, Text, space } from '../ui';

const kinds: readonly { type: ClearDataType; title: string }[] = [
  { type: 'history', title: 'Browsing history' },
  { type: 'cookies', title: 'Cookies and site data (signs you out of most sites)' },
  { type: 'cache', title: 'Cached images and files' },
];

export function ClearData({ openPage }: { openPage(key: string): void }) {
  const action = useAction();
  const [range, setRange] = useState<ClearRange>('hour');
  const [chosen, setChosen] = useState<ReadonlySet<ClearDataType>>(new Set(['history', 'cookies', 'cache']));
  const [cleared, setCleared] = useState(false);
  const toggle = (type: ClearDataType, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(type); else next.delete(type);
    setChosen(next);
    setCleared(false);
  };
  const clear = async () => {
    setCleared(false);
    const types = kinds.map(k => k.type).filter(t => chosen.has(t));
    const result = await action.run('privacy.clearData', { since: clearSince(range, Date.now()), types }, 5 * 60_000);
    setCleared(result.ok);
  };
  return <>
    <FormGroup title="Clear browsing data"
      detail="Pages in Chromium and pages in WebKit (Netflix and the other sites that open there) are cleared together.">
      <FormRow title="Time range">
        <PopUp label="Time range" value={range} options={ranges} onChange={r => { setRange(r); setCleared(false); }} />
      </FormRow>
      <View style={{ gap: space.sm, paddingVertical: space.md }}>
        {kinds.map(k => <Checkbox key={k.type} label={k.title} value={chosen.has(k.type)} onChange={on => toggle(k.type, on)} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
        <View style={{ flex: 1 }}>
          {action.busy && <Text variant="label" weight="regular" tone="textSecondary">Clearing…</Text>}
        </View>
        <Button label="Clear data" variant="danger" disabled={!chosen.size || action.busy} onPress={() => void clear()} />
      </View>
    </FormGroup>
    {(cleared || action.error) && <View style={{ marginTop: -space.md, marginBottom: space.xl }}>
      {action.error ? <Notice tone="error">{action.error}</Notice> : <Notice>Cleared from Chromium and WebKit.</Notice>}
    </View>}
    <FormGroup>
      <ListRow title="Passwords, autofill and other Chromium data" onPress={() => openPage('clear-data')}
        tall trailing={<Icon name="chevron.right" size="chevron" tone="iconSecondary" />} />
    </FormGroup>
  </>;
}
