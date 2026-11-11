const path = require('node:path');
const macOS = require('react-native-macos/react-native.config');
module.exports = {
  reactNativePath: path.dirname(require.resolve('react-native-macos/package.json')),
  platforms: { macos: macOS.platforms.macos },
  project: { macos: { sourceDir: './macos' } },
};
