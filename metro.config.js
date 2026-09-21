const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

module.exports = mergeConfig(defaultConfig, {
  transformer: { babelTransformerPath: require.resolve('react-native-svg-transformer') },
  resolver: {
    assetExts: assetExts.filter(e => e !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
  },
});