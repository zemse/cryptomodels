import { describe, test, expect, beforeEach, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const keccak256 = (data: Uint8Array) => keccak_256(data);
import { bytesToHex } from "@noble/hashes/utils";
import { createTestDb, initSchema } from "../src/db/schema";
import {
  createInbox,
  getInbox,
  postMessage,
  getMessages,
  deleteMessages,
} from "../src/db/queries";

// Enable sync API for noble-secp256k1
beforeAll(async () => {
  // @ts-ignore
  if (typeof secp256k1.etc?.hmacSha256Sync === "undefined") {
    const { hmac } = await import("@noble/hashes/hmac");
    const { sha256 } = await import("@noble/hashes/sha256");
    // @ts-ignore
    secp256k1.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]) =>
      hmac(sha256, k, secp256k1.etc.concatBytes(...m));
  }
});

describe("Database Queries", () => {
  let db: Database;

  // Generate test keypairs
  const privateKeyA = secp256k1.utils.randomPrivateKey();
  const publicKeyA = secp256k1.getPublicKey(privateKeyA, false);
  const pubkeyHexA = "0x" + bytesToHex(publicKeyA);
  const addressA =
    "0x" + bytesToHex(keccak256(publicKeyA.slice(1)).slice(-20));

  const privateKeyB = secp256k1.utils.randomPrivateKey();
  const publicKeyB = secp256k1.getPublicKey(privateKeyB, false);
  const pubkeyHexB = "0x" + bytesToHex(publicKeyB);

  beforeEach(() => {
    db = createTestDb();
  });

  describe("createInbox", () => {
    test("creates inbox successfully", () => {
      const inbox = createInbox(addressA, pubkeyHexA, db);
      expect(inbox).not.toBeNull();
      expect(inbox?.address).toBe(addressA.toLowerCase());
      expect(inbox?.owner_pubkey).toBe(pubkeyHexA);
    });

    test("returns null for duplicate address", () => {
      createInbox(addressA, pubkeyHexA, db);
      const duplicate = createInbox(addressA, pubkeyHexA, db);
      expect(duplicate).toBeNull();
    });

    test("normalizes address to lowercase", () => {
      const upperAddr = addressA.toUpperCase();
      const inbox = createInbox(upperAddr, pubkeyHexA, db);
      expect(inbox?.address).toBe(addressA.toLowerCase());
    });
  });

  describe("getInbox", () => {
    test("retrieves existing inbox", () => {
      createInbox(addressA, pubkeyHexA, db);
      const inbox = getInbox(addressA, db);
      expect(inbox).not.toBeNull();
      expect(inbox?.owner_pubkey).toBe(pubkeyHexA);
    });

    test("returns null for non-existent inbox", () => {
      const inbox = getInbox("0x0000000000000000000000000000000000000000", db);
      expect(inbox).toBeNull();
    });

    test("is case-insensitive", () => {
      createInbox(addressA, pubkeyHexA, db);
      const inbox = getInbox(addressA.toUpperCase(), db);
      expect(inbox).not.toBeNull();
    });
  });

  describe("postMessage", () => {
    test("posts message to inbox", () => {
      createInbox(addressA, pubkeyHexA, db);
      const msg = postMessage(addressA, pubkeyHexB, db);
      expect(msg).not.toBeNull();
      expect(msg?.sender_pubkey).toBe(pubkeyHexB);
      expect(msg?.inbox_address).toBe(addressA.toLowerCase());
    });
  });

  describe("getMessages", () => {
    test("retrieves all messages for inbox", () => {
      createInbox(addressA, pubkeyHexA, db);
      postMessage(addressA, pubkeyHexB, db);
      postMessage(addressA, pubkeyHexB, db);

      const messages = getMessages(addressA, db);
      expect(messages.length).toBe(2);
    });

    test("returns empty array for inbox with no messages", () => {
      createInbox(addressA, pubkeyHexA, db);
      const messages = getMessages(addressA, db);
      expect(messages.length).toBe(0);
    });

    test("returns messages ordered by id descending (most recent first)", () => {
      createInbox(addressA, pubkeyHexA, db);
      postMessage(addressA, "first", db);
      postMessage(addressA, "second", db);

      const messages = getMessages(addressA, db);
      // Most recent (higher ID) first due to DESC order
      expect(messages[0].id).toBeGreaterThan(messages[1].id);
    });
  });

  describe("deleteMessages", () => {
    test("deletes all messages for inbox", () => {
      createInbox(addressA, pubkeyHexA, db);
      postMessage(addressA, pubkeyHexB, db);
      postMessage(addressA, pubkeyHexB, db);

      deleteMessages(addressA, db);
      const messages = getMessages(addressA, db);
      expect(messages.length).toBe(0);
    });
  });
});
