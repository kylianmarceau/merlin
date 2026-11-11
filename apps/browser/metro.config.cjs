const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const root = path.resolve(__dirname, '../..');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(root, 'node_modules')],
    extraNodeModules: { 'react-native': path.join(root, 'node_modules/react-native-macos') },
    platforms: ['macos'],
    resolveRequest(context, name, platform) {
      const target = name === 'react-native' || name.startsWith('react-native/')
        ? name.replace(/^react-native/, 'react-native-macos') : name;
      return context.resolveRequest(context, target, platform);
    },
  },
});
