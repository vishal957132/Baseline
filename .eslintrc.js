module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['__tests__/**/*', 'jest/**/*'],
      env: { jest: true },
    },
  ],
};
