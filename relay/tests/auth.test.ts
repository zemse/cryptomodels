import { describe, test, expect, beforeAll } from "bun:test";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const keccak256 = (data: Uint8Array) => keccak_256(data);
import { bytesToHex } from "@noble/hashes/utils";
import { getOtpMessage, isValidOtp, getOtpPrefix } from "../src/auth/otp";
import { recoverAddress, pubkeyToAddress, isValidPubkey } from "../src/auth/verify";

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

describe("OTP", () => {
  test("getOtpMessage returns valid structure", () => {
    const otp = getOtpMessage();
    expect(otp.message).toMatch(/^relay-auth-\d+$/);
    expect(otp.validUntil).toBeGreaterThan(Date.now());
  });

  test("getOtpPrefix returns correct prefix", () => {
    expect(getOtpPrefix()).toBe("relay-auth-");
  });

  test("isValidOtp accepts current message", () => {
    const otp = getOtpMessage();
    expect(isValidOtp(otp.message)).toBe(true);
  });

  test("isValidOtp rejects invalid message", () => {
    expect(isValidOtp("relay-auth-0")).toBe(false);
    expect(isValidOtp("invalid")).toBe(false);
    expect(isValidOtp("")).toBe(false);
  });
});

describe("Signature Verification", () => {
  // Generate a test keypair
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, false); // uncompressed

  // Derive expected address
  const expectedAddress =
    "0x" + bytesToHex(keccak256(publicKey.slice(1)).slice(-20));

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

  test("recoverAddress recovers correct address", () => {
    const message = "test message";
    const signature = signMessage(message, privateKey);
    const recovered = recoverAddress(message, signature);

    expect(recovered?.toLowerCase()).toBe(expectedAddress.toLowerCase());
  });

  test("recoverAddress returns null for invalid signature", () => {
    expect(recoverAddress("test", "0x1234")).toBeNull();
    expect(recoverAddress("test", "invalid")).toBeNull();
    expect(recoverAddress("test", "")).toBeNull();
  });

  test("pubkeyToAddress derives correct address", () => {
    const pubkeyHex = "0x" + bytesToHex(publicKey);
    const address = pubkeyToAddress(pubkeyHex);

    expect(address?.toLowerCase()).toBe(expectedAddress.toLowerCase());
  });

  test("pubkeyToAddress handles compressed pubkey", () => {
    const compressedPubkey = secp256k1.getPublicKey(privateKey, true);
    const pubkeyHex = "0x" + bytesToHex(compressedPubkey);
    const address = pubkeyToAddress(pubkeyHex);

    expect(address?.toLowerCase()).toBe(expectedAddress.toLowerCase());
  });

  test("pubkeyToAddress returns null for invalid pubkey", () => {
    expect(pubkeyToAddress("0x1234")).toBeNull();
    expect(pubkeyToAddress("invalid")).toBeNull();
  });

  test("isValidPubkey validates pubkeys correctly", () => {
    const pubkeyHex = "0x" + bytesToHex(publicKey);
    expect(isValidPubkey(pubkeyHex)).toBe(true);

    const compressedPubkey = secp256k1.getPublicKey(privateKey, true);
    expect(isValidPubkey("0x" + bytesToHex(compressedPubkey))).toBe(true);

    expect(isValidPubkey("0x1234")).toBe(false);
    expect(isValidPubkey("invalid")).toBe(false);
  });
});
