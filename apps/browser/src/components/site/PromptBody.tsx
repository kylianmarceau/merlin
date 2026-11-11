import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { promptIcon } from '../../lib/prompts';
import type { Prompt } from '../../state/types';
import { useActions } from '../../state/window';
import { Box, Button, Checkbox, Field, IconTile, Text, duration, geometry } from '../ui';

/**
 * A browser question. Mounted with the native prompt ID as its key, so typed
 * input and pending state never carry into the next question. Answers are
 * ignored for the first half second, as in Chromium, so a stray click cannot
 * grant a permission.
 */
export function PromptBody({ prompt, compact }: { prompt: Prompt; compact: boolean }) {
  const actions = useActions();
  const [text, setText] = useState(prompt.input?.defaultValue ?? '');
  const [suppress, setSuppress] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => setArmed(true), duration.promptArm);
    return () => { alive.current = false; clearTimeout(timer); };
  }, []);
  const answer = async (actionId: string) => {
    if (!armed || submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    try {
      await actions.answerPrompt(prompt.id, actionId, { ...(prompt.input ? { text } : {}), ...(prompt.canSuppress ? { suppress } : {}) });
      // The browser's next snapshot removes this prompt.
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setPending(false); submitting.current = false; }
    }
  };
  const icon = promptIcon(prompt);
  const tone = prompt.security === 'dangerous' ? 'danger' : prompt.security === 'insecure' ? 'warning' : 'accent';
  return <Box gap="md">
    <Box row gap="md" align="flex-start">
      <IconTile icon={icon} tone={tone} fill={tone === 'danger' ? 'dangerSoft' : tone === 'warning' ? 'warningSoft' : 'accentSoft'} />
      <Box flex={1} gap="hair">
        <Text variant="bodyStrong">{prompt.title}</Text>
        <Text variant="caption" lines={1}>{prompt.origin}</Text>
      </Box>
    </Box>
    {!!prompt.message && <ScrollView style={{ maxHeight: compact ? geometry.popover / 2 : geometry.sheetHeight / 2 }}>
      <Text tone="textSecondary" selectable>{prompt.message}</Text>
    </ScrollView>}
    {prompt.input && <Box gap="xs">
      <Text variant="label" tone="textSecondary">{prompt.input.label}</Text>
      <Field autoFocus accessibilityLabel={prompt.input.label} value={text} editable={!pending} maxLength={8192}
        onSubmitEditing={() => { const primary = prompt.actions.find(a => a.emphasis === 'primary'); if (primary) void answer(primary.id); }}
        onChangeText={value => {
          setText(value);
          actions.updatePromptText(prompt.id, value).catch(e => { if (alive.current) setError(e instanceof Error ? e.message : String(e)); });
        }} />
    </Box>}
    {prompt.canSuppress && <Checkbox label="Don't let this page show more dialogs" value={suppress} disabled={pending} onChange={setSuppress} />}
    {error && <Text tone="textDanger">{error}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: geometry.splitGap }}>
      {prompt.actions.map(action => <Button key={action.id} label={action.label} disabled={!armed || pending}
        variant={action.emphasis === 'primary' ? 'primary' : action.emphasis === 'danger' ? 'danger' : 'secondary'}
        onPress={() => void answer(action.id)} />)}
    </View>
  </Box>;
}
