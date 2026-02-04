import { Database } from "bun:sqlite";
import { getDb } from "./schema";
import type { Inbox, InboxMessage } from "../types";

export function createInbox(
  address: string,
  ownerPubkey: string,
  database?: Database
): Inbox | null {
  const db = database ?? getDb();
  try {
    const stmt = db.prepare(`
      INSERT INTO inboxes (address, owner_pubkey)
      VALUES (?, ?)
      RETURNING *
    `);
    return stmt.get(address.toLowerCase(), ownerPubkey) as Inbox | null;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      return null;
    }
    throw error;
  }
}

export function getInbox(
  address: string,
  database?: Database
): Inbox | null {
  const db = database ?? getDb();
  const stmt = db.prepare("SELECT * FROM inboxes WHERE address = ?");
  return stmt.get(address.toLowerCase()) as Inbox | null;
}

export function postMessage(
  inboxAddress: string,
  senderPubkey: string,
  database?: Database
): InboxMessage | null {
  const db = database ?? getDb();
  const stmt = db.prepare(`
    INSERT INTO inbox_messages (inbox_address, sender_pubkey)
    VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(inboxAddress.toLowerCase(), senderPubkey) as InboxMessage | null;
}

export function getMessages(
  inboxAddress: string,
  database?: Database
): InboxMessage[] {
  const db = database ?? getDb();
  const stmt = db.prepare(`
    SELECT * FROM inbox_messages
    WHERE inbox_address = ?
    ORDER BY id DESC
  `);
  return stmt.all(inboxAddress.toLowerCase()) as InboxMessage[];
}

export function deleteMessages(
  inboxAddress: string,
  database?: Database
): void {
  const db = database ?? getDb();
  const stmt = db.prepare("DELETE FROM inbox_messages WHERE inbox_address = ?");
  stmt.run(inboxAddress.toLowerCase());
}
