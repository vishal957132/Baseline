/**
 * op-sqlite is a native module and cannot load under Jest.
 *
 * This stub answers every query with no rows, which is exactly the state the
 * screens' loading and empty branches are meant to handle — so mounting them
 * in a test exercises those paths rather than skipping them.
 */
const emptyResult = { rows: [], rowsAffected: 0 };

const db = {
  execute: async () => emptyResult,
  executeSync: () => emptyResult,
  executeBatch: async () => ({ rowsAffected: 0 }),
  transaction: async fn => fn({ execute: async () => emptyResult }),
  close: () => {},
  closeAsync: async () => {},
};

module.exports = {
  open: () => db,
  openAsync: async () => db,
  IOS_DOCUMENT_PATH: '',
  ANDROID_DATABASE_PATH: '',
};
