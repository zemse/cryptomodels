# Relay API Documentation

A relay service for secure peer-to-peer communication using inbox-based key exchange and WebSocket forwarding.

## Authentication

The relay uses signature-based authentication with time-based OTP challenges.

### How It Works

1. **Get OTP**: Request a time-based challenge message
2. **Sign Message**: Sign the OTP using your private key (EIP-191 personal_sign)
3. **Include Headers**: Add signature and message to authenticated requests

### Authentication Headers

```
X-Signature: 0x...  # EIP-191 signature of the OTP message
X-Message: relay-auth-1707123450  # The OTP message that was signed
```

---

## Endpoints

### Health Check

```
GET /
```

**Response:**
```json
{
  "status": "ok",
  "service": "relay"
}
```

---

### Get OTP Challenge

```
GET /otp
```

Returns a time-based challenge message for authentication.

**Response:**
```json
{
  "message": "relay-auth-1707123450",
  "validUntil": 1707123460000
}
```

**Notes:**
- Message changes every 10 seconds
- Both current and previous messages are accepted (handles clock skew)

---

### Create Inbox

```
POST /inbox
```

Create an inbox identified by your Ethereum address.

**Headers:**
```
Content-Type: application/json
X-Signature: 0x...
X-Message: relay-auth-...
```

**Body:**
```json
{
  "pubkey": "0x04..."  // Your uncompressed secp256k1 public key (65 bytes)
}
```

**Response (200):**
```json
{
  "success": true,
  "address": "0x1234...",
  "inbox": "/inbox/0x1234..."
}
```

**Errors:**
- `400`: Invalid or missing pubkey
- `401`: Invalid signature or address mismatch
- `409`: Inbox already exists

---

### Get Inbox Public Key

```
GET /inbox/:address
```

Get the public key of an inbox owner (public endpoint).

**Response (200):**
```json
{
  "address": "0x1234...",
  "pubkey": "0x04..."
}
```

**Errors:**
- `404`: Inbox not found

---

### Post to Inbox

```
POST /inbox/:address
```

Post your public key to someone's inbox (public endpoint).

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "pubkey": "0x04..."  // Your uncompressed secp256k1 public key
}
```

**Response (200):**
```json
{
  "success": true
}
```

**Errors:**
- `400`: Invalid or missing pubkey
- `404`: Inbox not found

---

### Get Inbox Messages

```
GET /inbox/:address/messages
```

Get all messages in your inbox (authenticated, owner only).

**Headers:**
```
X-Signature: 0x...
X-Message: relay-auth-...
```

**Response (200):**
```json
{
  "messages": [
    {
      "pubkey": "0x04...",
      "createdAt": 1707123450
    }
  ]
}
```

**Errors:**
- `401`: Invalid signature or address mismatch
- `404`: Inbox not found

---

### WebSocket Connection

```
WS /socket/:dhHash
```

Connect to a relay room using the shared ECDH hash.

**URL Parameters:**
- `dhHash`: 64-character hex string (keccak256 of ECDH shared secret)

**Connection Flow:**
1. First connection receives `connected` with `peers: 0`
2. Second connection receives `connected` with `peers: 1`
3. First connection receives `peer_joined`
4. Messages are forwarded to all other peers in the room

**Server Messages:**
```json
{ "type": "connected", "peers": 0, "message": "Waiting for peer..." }
{ "type": "connected", "peers": 1, "message": "Peer connected, ready to communicate" }
{ "type": "peer_joined", "peers": 1 }
{ "type": "peer_left", "peers": 0 }
```

**Client Messages:**
- Any format (raw bytes or JSON) - forwarded as-is to peers

---

## Usage Example

### Party A: Create Inbox and Wait for Connections

```typescript
import * as secp256k1 from "@noble/secp256k1";
import { keccak256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

const BASE_URL = "http://localhost:4000";

// Generate keypair
const privateKeyA = secp256k1.utils.randomPrivateKey();
const publicKeyA = secp256k1.getPublicKey(privateKeyA, false);
const pubkeyHexA = "0x" + bytesToHex(publicKeyA);
const addressA = "0x" + bytesToHex(keccak256(publicKeyA.slice(1)).slice(-20));

// Sign message (EIP-191)
function signMessage(message: string, privKey: Uint8Array): string {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const hash = keccak256(new TextEncoder().encode(prefix + message));
  const sig = secp256k1.sign(hash, privKey);
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return "0x" + r + s + v;
}

// 1. Get OTP and create inbox
const otp = await fetch(`${BASE_URL}/otp`).then(r => r.json());
const signature = signMessage(otp.message, privateKeyA);

await fetch(`${BASE_URL}/inbox`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Signature": signature,
    "X-Message": otp.message,
  },
  body: JSON.stringify({ pubkey: pubkeyHexA }),
});

console.log("Inbox created at:", addressA);

// 2. Poll for messages
const checkMessages = async () => {
  const otp = await fetch(`${BASE_URL}/otp`).then(r => r.json());
  const sig = signMessage(otp.message, privateKeyA);

  const res = await fetch(`${BASE_URL}/inbox/${addressA}/messages`, {
    headers: { "X-Signature": sig, "X-Message": otp.message },
  });
  return res.json();
};

// 3. When B's pubkey arrives, compute shared secret and connect
const { messages } = await checkMessages();
const bPubkey = messages[0].pubkey;
const bPubkeyBytes = hexToBytes(bPubkey.slice(2));

const shared = secp256k1.getSharedSecret(privateKeyA, bPubkeyBytes);
const dhHash = bytesToHex(keccak256(shared));

const ws = new WebSocket(`ws://localhost:4000/socket/${dhHash}`);
ws.onmessage = (e) => console.log("Received:", e.data);
ws.send("Hello from A!");
```

### Party B: Connect to A's Inbox

```typescript
// 1. Get A's public key
const { pubkey: aPubkey } = await fetch(`${BASE_URL}/inbox/${addressA}`).then(r => r.json());

// 2. Post B's pubkey to A's inbox
await fetch(`${BASE_URL}/inbox/${addressA}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pubkey: pubkeyHexB }),
});

// 3. Compute shared secret and connect
const aPubkeyBytes = hexToBytes(aPubkey.slice(2));
const shared = secp256k1.getSharedSecret(privateKeyB, aPubkeyBytes);
const dhHash = bytesToHex(keccak256(shared));

const ws = new WebSocket(`ws://localhost:4000/socket/${dhHash}`);
ws.onmessage = (e) => console.log("Received:", e.data);
ws.send("Hello from B!");
```

---

## Security Considerations

1. **Address Ownership**: Only the private key holder can create/access their inbox
2. **Time-Limited OTP**: Signatures are valid for ~20 seconds (current + previous interval)
3. **End-to-End Privacy**: Server cannot read WebSocket messages (ECDH shared secret is computed client-side)
4. **IP Protection**: Parties never connect directly; relay forwards messages

### Limitations

- **Inbox Spam**: Anyone can post to any inbox. Owner should ignore unknown pubkeys.
- **No Message Encryption**: WebSocket messages are forwarded as-is. Implement E2E encryption client-side if needed.
- **Single Server**: No federation or backup relay support.
