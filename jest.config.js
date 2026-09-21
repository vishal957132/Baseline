module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest/setup.js'],
  moduleNameMapper: {
    '\\.svg$': '<rootDir>/jest/svgMock.js',
  },
};
