// react-native-svg-transformer is a Metro transformer; Jest needs its own stub.
const React = require('react');
module.exports = React.forwardRef((props, ref) =>
  React.createElement('Svg', { ...props, ref }),
);
