/**
 * react-native-mmkv is native (Nitro modules), so it cannot load under Jest.
 * An in-memory Map has the same observable behaviour for our three keys.
 */
function createMMKV() {
  const data = new Map();
  return {
    getString: key => data.get(key),
    set: (key, value) => data.set(key, value),
    remove: key => data.delete(key),
    clearAll: () => data.clear(),
  };
}

module.exports = { createMMKV };
