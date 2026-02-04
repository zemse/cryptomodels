import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const keccak256 = (data: Uint8Array) => keccak_256(data);
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// EIP-191 personal_sign prefix
function hashMessage(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const prefixedMessage = new TextEncoder().encode(prefix + message);
  return keccak256(prefixedMessage);
}

export function recoverAddress(message: string, signature: string): string | null {
  try {
    const hash = hashMessage(message);

    // Remove 0x prefix if present
    const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;

    if (sigHex.length !== 130) {
      return null;
    }

    // Extract r, s, v from signature
    const r = sigHex.slice(0, 64);
    const s = sigHex.slice(64, 128);
    const vHex = sigHex.slice(128, 130);
    let v = parseInt(vHex, 16);

    // Handle both pre-EIP-155 (27/28) and EIP-155 style recovery values
    if (v >= 27) {
      v -= 27;
    }

    if (v !== 0 && v !== 1) {
      return null;
    }

    const sig = new secp256k1.Signature(
      BigInt("0x" + r),
      BigInt("0x" + s)
    ).addRecoveryBit(v);

    const pubkey = sig.recoverPublicKey(hash);
    const pubkeyBytes = pubkey.toRawBytes(false); // Uncompressed

    // Address = last 20 bytes of keccak256(pubkey without 0x04 prefix)
    const addressBytes = keccak256(pubkeyBytes.slice(1)).slice(-20);
    return "0x" + bytesToHex(addressBytes);
  } catch {
    return null;
  }
}

export function pubkeyToAddress(pubkey: string): string | null {
  try {
    // Remove 0x prefix if present
    const pubkeyHex = pubkey.startsWith("0x") ? pubkey.slice(2) : pubkey;
    const pubkeyBytes = hexToBytes(pubkeyHex);

    // Handle compressed (33 bytes) or uncompressed (65 bytes) pubkeys
    let uncompressedBytes: Uint8Array;
    if (pubkeyBytes.length === 33) {
      // Decompress the public key
      const point = secp256k1.ProjectivePoint.fromHex(pubkeyBytes);
      uncompressedBytes = point.toRawBytes(false);
    } else if (pubkeyBytes.length === 65) {
      uncompressedBytes = pubkeyBytes;
    } else {
      return null;
    }

    // Address = last 20 bytes of keccak256(pubkey without 0x04 prefix)
    const addressBytes = keccak256(uncompressedBytes.slice(1)).slice(-20);
    return "0x" + bytesToHex(addressBytes);
  } catch {
    return null;
  }
}

export function isValidPubkey(pubkey: string): boolean {
  try {
    const pubkeyHex = pubkey.startsWith("0x") ? pubkey.slice(2) : pubkey;
    const pubkeyBytes = hexToBytes(pubkeyHex);

    // Verify it's a valid point on the curve
    if (pubkeyBytes.length === 33 || pubkeyBytes.length === 65) {
      secp256k1.ProjectivePoint.fromHex(pubkeyBytes);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
