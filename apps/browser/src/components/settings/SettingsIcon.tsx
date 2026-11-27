import React from 'react';
import { Image } from 'react-native';
import { Icon, settingsGeometry } from '../ui';
import type { SettingsSection } from './navigation';

const artwork = {
  general: require('./art/general.png'),
  appearance: require('./art/appearance.png'),
  privacy: require('./art/privacy.png'),
  blocking: require('./art/blocking.png'),
  performance: require('./art/performance.png'),
  extensions: require('./art/extensions.png'),
  workspaces: require('./art/workspaces.png'),
  keys: require('./art/keys.png'),
  config: require('./art/config.png'),
} satisfies Record<Exclude<SettingsSection, 'about'>, number>;

export function SettingsIcon({ section, appIcon, size = settingsGeometry.badge }: {
  section: SettingsSection; appIcon?: string; size?: number;
}) {
  if (section === 'about' && !appIcon) return <Icon name="m.square" size="large" />;
  const source = section === 'about' ? { uri: appIcon } : artwork[section];
  return <Image accessible={false} source={source} resizeMode="contain" style={{ width: size, height: size }} />;
}
