/**
 * Packages that must be transformed: the RN preset only covers react-native
 * itself, but the app shell pulls in Redux Toolkit, React Navigation and
 * FlashList, several of which ship ESM-only builds.
 */
const esmPackages = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'react-redux',
  '@reduxjs',
  'immer',
  'redux',
  'reselect',
  'redux-thunk',
  '@react-navigation',
  '@shopify',
  'use-latest-callback',
  'nanoid',
  'react-freeze',
  'warn-once',
];

module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest/setup.js'],
  moduleNameMapper: {
    // Metro's SVG transformer does not run under Jest.
    '\\.svg$': '<rootDir>/jest/svgMock.js',
    // op-sqlite is a native module; the stub answers with no rows.
    '^@op-engineering/op-sqlite$': '<rootDir>/jest/opSqliteMock.js',
    // MMKV is native too; an in-memory Map behaves identically.
    '^react-native-mmkv$': '<rootDir>/jest/mmkvMock.js',
  },
  transformIgnorePatterns: [`node_modules/(?!(${esmPackages.join('|')})/)`],
};
