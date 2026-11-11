import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { EngineClient, Prompt } from '@merlin/engine/protocol';
import { Button, Dialog, Field, Label } from './components';
import { useTheme } from './Theme';
import { space } from './tokens';

// Mounted with the native request ID as its key. Input and pending state cannot
// leak into a subsequent request, even when a callback closes the current tab.
export function BrowserPrompt({ prompt, engine }: { prompt: Prompt; engine: EngineClient }) {
  const t = useTheme();
  const [text, setText] = useState(prompt.input?.defaultValue ?? '');
  const [suppress, setSuppress] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => setArmed(true), 550);
    return () => { alive.current = false; clearTimeout(timer); };
  }, []);
  const answer = async (actionId: string) => {
    if (!armed || submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    try {
      await engine.call('permissions.answer', { promptId: prompt.id, actionId,
        ...(prompt.input ? { text } : {}), ...(prompt.canSuppress ? { suppress } : {}) });
      // Success removes this prompt through the authoritative browser snapshot.
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setPending(false); submitting.current = false; }
    }
  };
  return <Dialog title={prompt.title} subtitle={prompt.origin} actions={prompt.actions.map(action =>
    <Button key={action.id} title={action.label} emphasis={action.emphasis} disabled={!armed || pending}
      onPress={() => void answer(action.id)} />)}>
    <ScrollView style={{ maxHeight: 260 }}><Label>{prompt.message}</Label></ScrollView>
    {prompt.input && <View style={{ gap: space.sm }}>
      <Label muted>{prompt.input.label}</Label>
      <Field autoFocus accessibilityLabel={prompt.input.label} value={text} editable={!pending} maxLength={8192}
        onChangeText={value => {
          setText(value);
          void engine.call('prompts.update', { promptId: prompt.id, text: value }).catch(e => {
            if (alive.current) setError(e instanceof Error ? e.message : String(e));
          });
        }} />
    </View>}
    {prompt.canSuppress && <Button title={suppress ? 'Further dialogs from this page: blocked' : 'Block further dialogs from this page'}
      disabled={pending} onPress={() => setSuppress(value => !value)} />}
    {error && <Label style={{ color: t.danger }}>{error}</Label>}
  </Dialog>;
}
