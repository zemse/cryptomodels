import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { hexToBytes } from "@noble/hashes/utils";

const keccak256 = (data: Uint8Array) => keccak_256(data);

/**
 * EIP-191 personal_sign message hashing
 */
function hashMessage(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const prefixedMessage = new TextEncoder().encode(prefix + message);
  return keccak256(prefixedMessage);
}

/**
 * Sign a message using EIP-191 personal_sign
 */
export async function signMessage(
  message: string,
  privateKey: string
): Promise<string> {
  const hash = hashMessage(message);
  const pkHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const pkBytes = hexToBytes(pkHex);

  const sig = await secp256k1.signAsync(hash, pkBytes, { lowS: true });
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery! + 27).toString(16).padStart(2, "0");

  return "0x" + r + s + v;
}
