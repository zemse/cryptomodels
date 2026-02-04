import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const keccak256 = (data: Uint8Array) => keccak_256(data);
import { bytesToHex } from "@noble/hashes/utils";

const BASE_URL = "http://localhost:4003";
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
    env: { ...process.env, PORT: "4003", DATABASE_PATH: "test-routes.db" },
    stdout: "ignore",
    stderr: "ignore",
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 1500));
});

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill();
  }
  // Clean up test database
  try {
    const fs = require("fs");
    fs.unlinkSync("test-routes.db");
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

describe("Health Check", () => {
  test("GET / returns ok status", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("relay");
  });
});

describe("OTP Route", () => {
  test("GET /otp returns valid OTP", async () => {
    const res = await fetch(`${BASE_URL}/otp`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toMatch(/^relay-auth-\d+$/);
    expect(typeof data.validUntil).toBe("number");
    expect(data.validUntil).toBeGreaterThan(Date.now());
  });
});

describe("Inbox Routes - Error Cases", () => {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const pubkeyHex = "0x" + bytesToHex(publicKey);
  const address = "0x" + bytesToHex(keccak256(publicKey.slice(1)).slice(-20));

  test("POST /inbox without auth headers returns 401", async () => {
    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Missing");
  });

  test("POST /inbox with invalid pubkey returns 400", async () => {
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const signature = signMessage(message, privateKey);

    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({ pubkey: "invalid-pubkey" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("pubkey");
  });

  test("POST /inbox with empty body returns 400", async () => {
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const signature = signMessage(message, privateKey);

    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("POST /inbox with mismatched pubkey/signature returns 401", async () => {
    // Use a different keypair for signing
    const otherPrivateKey = secp256k1.utils.randomPrivateKey();
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const signature = signMessage(message, otherPrivateKey);

    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("mismatch");
  });

  test("POST /inbox with expired OTP returns 401", async () => {
    const expiredMessage = "relay-auth-0"; // Epoch 0 is definitely expired
    const signature = signMessage(expiredMessage, privateKey);

    const res = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": expiredMessage,
      },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("expired");
  });

  test("GET /inbox/:address for non-existent inbox returns 404", async () => {
    const nonExistentAddress = "0x0000000000000000000000000000000000000001";
    const res = await fetch(`${BASE_URL}/inbox/${nonExistentAddress}`);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  test("POST /inbox/:address to non-existent inbox returns 404", async () => {
    const nonExistentAddress = "0x0000000000000000000000000000000000000002";
    const res = await fetch(`${BASE_URL}/inbox/${nonExistentAddress}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /inbox/:address with invalid pubkey returns 400", async () => {
    // First create an inbox
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const signature = signMessage(message, privateKey);

    await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    // Post with invalid pubkey
    const res = await fetch(`${BASE_URL}/inbox/${address}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: "not-a-valid-pubkey" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("pubkey");
  });

  test("GET /inbox/:address/messages without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/inbox/${address}/messages`);
    expect(res.status).toBe(401);
  });

  test("GET /inbox/:address/messages for non-existent inbox returns 404", async () => {
    const nonExistentAddress = "0x0000000000000000000000000000000000000003";
    const otpRes = await fetch(`${BASE_URL}/otp`);
    const { message } = await otpRes.json();
    const signature = signMessage(message, privateKey);

    const res = await fetch(`${BASE_URL}/inbox/${nonExistentAddress}/messages`, {
      headers: {
        "X-Signature": signature,
        "X-Message": message,
      },
    });

    expect(res.status).toBe(404);
  });
});

describe("Inbox Routes - Duplicate Handling", () => {
  test("POST /inbox for existing address returns 409", async () => {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    const pubkeyHex = "0x" + bytesToHex(publicKey);

    // Create inbox first time
    const otpRes1 = await fetch(`${BASE_URL}/otp`);
    const { message: message1 } = await otpRes1.json();
    const signature1 = signMessage(message1, privateKey);

    const res1 = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature1,
        "X-Message": message1,
      },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });
    expect(res1.status).toBe(200);

    // Try to create again
    const otpRes2 = await fetch(`${BASE_URL}/otp`);
    const { message: message2 } = await otpRes2.json();
    const signature2 = signMessage(message2, privateKey);

    const res2 = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature2,
        "X-Message": message2,
      },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });

    expect(res2.status).toBe(409);
    const data = await res2.json();
    expect(data.error).toContain("already exists");
  });
});

describe("WebSocket Routes - Error Cases", () => {
  test("Invalid dhHash format returns 400", async () => {
    const res = await fetch(`${BASE_URL}/socket/invalid-hash`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid dhHash");
  });

  test("Too short dhHash returns 400", async () => {
    const res = await fetch(`${BASE_URL}/socket/abc123`);
    expect(res.status).toBe(400);
  });

  test("Non-hex dhHash returns 400", async () => {
    const nonHex = "g".repeat(64); // 'g' is not a valid hex character
    const res = await fetch(`${BASE_URL}/socket/${nonHex}`);
    expect(res.status).toBe(400);
  });
});
