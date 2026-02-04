import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const keccak256 = (data: Uint8Array) => keccak_256(data);

/**
 * Derive uncompressed public key from private key
 */
export function privateKeyToPublicKey(privateKey: string): string {
  const pkHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const pkBytes = hexToBytes(pkHex);
  const pubkeyPoint = secp256k1.ProjectivePoint.fromPrivateKey(pkBytes);
  const uncompressedBytes = pubkeyPoint.toRawBytes(false); // 65 bytes, starts with 0x04
  return "0x" + bytesToHex(uncompressedBytes);
}

/**
 * Derive Ethereum address from public key
 */
export function publicKeyToAddress(pubkey: string): string {
  const pubkeyHex = pubkey.startsWith("0x") ? pubkey.slice(2) : pubkey;
  const pubkeyBytes = hexToBytes(pubkeyHex);

  let uncompressedBytes: Uint8Array;
  if (pubkeyBytes.length === 33) {
    const point = secp256k1.ProjectivePoint.fromHex(pubkeyBytes);
    uncompressedBytes = point.toRawBytes(false);
  } else if (pubkeyBytes.length === 65) {
    uncompressedBytes = pubkeyBytes;
  } else {
    throw new Error(`Invalid pubkey length: ${pubkeyBytes.length}`);
  }

  // Address = last 20 bytes of keccak256(pubkey without 0x04 prefix)
  const addressBytes = keccak256(uncompressedBytes.slice(1)).slice(-20);
  return "0x" + bytesToHex(addressBytes);
}

/**
 * Derive address directly from private key
 */
export function privateKeyToAddress(privateKey: string): string {
  const pubkey = privateKeyToPublicKey(privateKey);
  return publicKeyToAddress(pubkey);
}
