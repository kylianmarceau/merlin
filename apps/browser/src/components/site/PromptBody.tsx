import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, type TextInput } from 'react-native';
import { promptIcon } from '../../lib/prompts';
import type { Prompt } from '../../state/types';
import { useActions } from '../../state/window';
import { Box, Button, Checkbox, Field, Icon, Shake, Text, duration, geometry, radius, space } from '../ui';

/**
 * A browser question. Mounted with the native prompt ID as its key, so typed
 * input and pending state never carry into the next question. Answers are
 * ignored for the first half second, as in Chromium, so a stray click cannot
 * grant a permission. A sign-in asks for a name and a password; when the
 * site refused the last one it arrives shaking, as a refused field does.
 */
export function PromptBody({ prompt, compact }: { prompt: Prompt; compact: boolean }) {
  const actions = useActions();
  const [text, setText] = useState(prompt.input?.defaultValue ?? '');
  const [secret, setSecret] = useState('');
  const [suppress, setSuppress] = useState(false);
  // Shaken once it has appeared, when the site has just refused a sign-in.
  const [refused, setRefused] = useState(0);
  useEffect(() => { if (prompt.failed) setRefused(1); }, [prompt.failed]);
  const password = useRef<TextInput>(null);
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
      await actions.answerPrompt(prompt.id, actionId, { ...(prompt.input ? { text } : {}), ...(prompt.secret ? { secret } : {}),
        ...(prompt.canSuppress ? { suppress } : {}) });
      // The browser's next snapshot removes this prompt.
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setPending(false); submitting.current = false; }
    }
  };
  const icon = promptIcon(prompt);
  const tone = prompt.security === 'dangerous' ? 'danger' : prompt.security === 'insecure' ? 'warning' : 'iconSecondary';
  // Site questions lead with what is asked; a page's own dialogs say who is asking first.
  const asked = prompt.kind === 'permission' || prompt.kind === 'signIn' || prompt.anchor === 'site';
  const submit = () => { const primary = prompt.actions.find(a => a.emphasis === 'primary'); if (primary) void answer(primary.id); };
  return <Box gap="md">
    {asked ? <Box row gap="md" align="flex-start">
      <Box padTop="hair"><Icon name={icon} tone={tone} /></Box>
      <Box flex={1} gap="hair">
        <Text variant="calloutStrong">{prompt.title}</Text>
        <Text variant="label" weight="regular" tone="textSecondary" lines={1}>{prompt.origin}</Text>
      </Box>
    </Box> : <Box gap="xs">
      {/* Chromium's page dialogs name themselves ("example.com says"); others give only the origin. */}
      {!!prompt.origin && <Text variant="label" weight="regular" tone="textSecondary" lines={1}>{
        / says$/.test(prompt.origin) ? prompt.origin : `${prompt.origin} says`}</Text>}
      <Text variant="title">{prompt.title}</Text>
    </Box>}
    {!!prompt.message && <ScrollView style={{ maxHeight: compact ? geometry.popover / 2 : geometry.sheetHeight / 2 }}>
      <Text tone="textSecondary" selectable>{prompt.message}</Text>
    </ScrollView>}
    {(prompt.input || prompt.secret) && <Shake count={refused} radius={radius.field} style={{ gap: space.md }}>
      {prompt.input && <Box gap="xs">
        <Text variant="label" tone="textSecondary">{prompt.input.label}</Text>
        <Field autoFocus accessibilityLabel={prompt.input.label} value={text} editable={!pending} maxLength={8192}
          // With a password to come, Return moves on to it.
          onSubmitEditing={() => { if (prompt.secret) password.current?.focus(); else submit(); }}
          onChangeText={value => {
            setText(value);
            actions.updatePromptText(prompt.id, value).catch(e => { if (alive.current) setError(e instanceof Error ? e.message : String(e)); });
          }} />
      </Box>}
      {prompt.secret && <Box gap="xs">
        <Text variant="label" tone="textSecondary">{prompt.secret.label}</Text>
        <Field ref={password} secureTextEntry accessibilityLabel={prompt.secret.label} value={secret} editable={!pending} maxLength={4096}
          onSubmitEditing={submit} onChangeText={setSecret} />
      </Box>}
    </Shake>}
    {prompt.failed && <Text tone="textDanger">That user name and password weren't accepted.</Text>}
    {prompt.canSuppress && <Checkbox label={prompt.origin === 'Merlin' ? "Don't ask again" : "Don't let this page show more dialogs"} value={suppress} disabled={pending} onChange={setSuppress} />}
    {error && <Text tone="textDanger">{error}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.sm, paddingTop: space.hair }}>
      {prompt.actions.map(action => <Button key={action.id} label={action.label} disabled={!armed || pending}
        variant={action.emphasis === 'primary' ? 'primary' : action.emphasis === 'danger' ? 'danger' : 'secondary'}
        onPress={() => void answer(action.id)} />)}
    </View>
  </Box>;
}
