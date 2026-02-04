import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const keccak256 = (data: Uint8Array) => keccak_256(data);

/**
 * Compute dhHash from ECDH shared secret
 * Both parties derive the same dhHash from their keys
 */
export function computeDhHash(
  myPrivateKey: string,
  theirPublicKey: string
): string {
  const pkHex = myPrivateKey.startsWith("0x")
    ? myPrivateKey.slice(2)
    : myPrivateKey;
  const theirPubHex = theirPublicKey.startsWith("0x")
    ? theirPublicKey.slice(2)
    : theirPublicKey;

  const theirPubBytes = hexToBytes(theirPubHex);

  // Get their public key point
  const theirPoint = secp256k1.ProjectivePoint.fromHex(theirPubBytes);

  // Multiply by our private key to get shared point
  const sharedPoint = theirPoint.multiply(BigInt("0x" + pkHex));

  // Get x-coordinate of shared point (32 bytes)
  const sharedBytes = sharedPoint.toRawBytes(true).slice(1); // compressed without prefix

  // Hash to get dhHash
  return bytesToHex(keccak256(sharedBytes));
}
