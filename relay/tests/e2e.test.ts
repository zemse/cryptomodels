import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const keccak256 = (data: Uint8Array) => keccak_256(data);
import { bytesToHex } from "@noble/hashes/utils";

const BASE_URL = "http://localhost:3002";
let serverProcess: any;

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

  // Start test server
  serverProcess = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: import.meta.dir.replace("/tests", ""),
    env: { ...process.env, PORT: "3002" },
    stdout: "ignore",
    stderr: "ignore",
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill();
  }
  // Clean up test database
  try {
    const fs = require("fs");
    fs.unlinkSync("relay.db");
  } catch {
    // Ignore if file doesn't exist
  }
});

// Helper to sign message
function signMessage(message: string, privKey: Uint8Array): string {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const prefixedMessage = new TextEncoder().encode(prefix + message);
  const hash = keccak256(prefixedMessage);

  const sig = secp256k1.sign(hash, privKey);
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");

  return "0x" + r + s + v;
}

describe("E2E Flow", () => {
  // Party A's keys
  const privateKeyA = secp256k1.utils.randomPrivateKey();
  const publicKeyA = secp256k1.getPublicKey(privateKeyA, false);
  const pubkeyHexA = "0x" + bytesToHex(publicKeyA);
  const addressA =
    "0x" + bytesToHex(keccak256(publicKeyA.slice(1)).slice(-20));

  // Party B's keys
  const privateKeyB = secp256k1.utils.randomPrivateKey();
  const publicKeyB = secp256k1.getPublicKey(privateKeyB, false);
  const pubkeyHexB = "0x" + bytesToHex(publicKeyB);

  test("1. Get OTP", async () => {
    const res = await fetch(`${BASE_URL}/otp`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toMatch(/^relay-auth-\d+$/);
    expect(data.validUntil).toBeDefined();
  });

  test("2. A creates inbox", async () => {
    // Get OTP
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();

    // Sign OTP
    const signature = signMessage(message, privateKeyA);

    // Create inbox
    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({ pubkey: pubkeyHexA }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.address.toLowerCase()).toBe(addressA.toLowerCase());
  });

  test("3. B gets A's public key", async () => {
    const res = await fetch(`${BASE_URL}/inbox/${addressA}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.pubkey).toBe(pubkeyHexA);
  });

  test("4. B posts pubkey to A's inbox", async () => {
    const res = await fetch(`${BASE_URL}/inbox/${addressA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: pubkeyHexB }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("5. A reads inbox messages", async () => {
    // Get OTP
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();

    // Sign OTP
    const signature = signMessage(message, privateKeyA);

    // Get messages
    const res = await fetch(`${BASE_URL}/inbox/${addressA}/messages`, {
      headers: {
        "X-Signature": signature,
        "X-Message": message,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages.length).toBe(1);
    expect(data.messages[0].pubkey).toBe(pubkeyHexB);
  });

  test("6. Both compute same ECDH shared secret", () => {
    // A computes shared secret using B's pubkey
    const sharedA = secp256k1.getSharedSecret(privateKeyA, publicKeyB);
    const dhHashA = bytesToHex(keccak256(sharedA));

    // B computes shared secret using A's pubkey
    const sharedB = secp256k1.getSharedSecret(privateKeyB, publicKeyA);
    const dhHashB = bytesToHex(keccak256(sharedB));

    // Both should get the same hash
    expect(dhHashA).toBe(dhHashB);
  });

  test("7. WebSocket connection and message exchange", async () => {
    // Compute shared secret
    const shared = secp256k1.getSharedSecret(privateKeyA, publicKeyB);
    const dhHash = bytesToHex(keccak256(shared));

    const wsUrl = `ws://localhost:3002/socket/${dhHash}`;

    // Connect both parties
    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl);

    const ws1Messages: string[] = [];
    const ws2Messages: string[] = [];

    await new Promise<void>((resolve, reject) => {
      let connected = 0;
      const checkBothConnected = () => {
        connected++;
        if (connected === 2) resolve();
      };

      ws1.onopen = checkBothConnected;
      ws2.onopen = checkBothConnected;
      ws1.onerror = reject;
      ws2.onerror = reject;

      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });

    // Set up message handlers
    ws1.onmessage = (e) => ws1Messages.push(e.data);
    ws2.onmessage = (e) => ws2Messages.push(e.data);

    // Wait for initial connected messages to be processed
    await new Promise((r) => setTimeout(r, 100));

    // Clear initial messages
    ws1Messages.length = 0;
    ws2Messages.length = 0;

    // Exchange messages
    ws1.send("Hello from A");
    await new Promise((r) => setTimeout(r, 100));

    ws2.send("Hello from B");
    await new Promise((r) => setTimeout(r, 100));

    // Verify message exchange
    expect(ws2Messages).toContain("Hello from A");
    expect(ws1Messages).toContain("Hello from B");

    // Cleanup
    ws1.close();
    ws2.close();
  });

  test("8. Unauthorized access is rejected", async () => {
    // Try to read inbox without auth
    const res = await fetch(`${BASE_URL}/inbox/${addressA}/messages`);
    expect(res.status).toBe(401);

    // Try with wrong signature (B's key for A's inbox)
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const wrongSignature = signMessage(message, privateKeyB);

    const res2 = await fetch(`${BASE_URL}/inbox/${addressA}/messages`, {
      headers: {
        "X-Signature": wrongSignature,
        "X-Message": message,
      },
    });
    expect(res2.status).toBe(401);
  });
});
