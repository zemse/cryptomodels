import { Database } from "bun:sqlite";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database("relay.db");
    initSchema(db);
  }
  return db;
}

export function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS inboxes (
      address TEXT PRIMARY KEY,
      owner_pubkey TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS inbox_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inbox_address TEXT NOT NULL,
      sender_pubkey TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
    );

    CREATE INDEX IF NOT EXISTS idx_inbox_messages_address
    ON inbox_messages(inbox_address);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// For testing - creates an in-memory database
export function createTestDb(): Database {
  const testDb = new Database(":memory:");
  initSchema(testDb);
  return testDb;
}
