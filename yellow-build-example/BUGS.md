# Yellow Network SDK - Bugs & Solutions

## Quick Start Tutorial Issues

The [Quick Start tutorial](https://docs.yellow.org/docs/build/quick-start/) has several misleading examples:

### Issue 1: `personal_sign` doesn't work for auth_verify

The tutorial shows:
```javascript
const messageSigner = async (message) => {
  return await window.ethereum.request({
    method: 'personal_sign',  // ❌ WRONG!
    params: [message, userAddress]
  });
};
```

**Problem:** `personal_sign` adds an Ethereum message prefix which breaks signature verification for `auth_verify`.

**Solution:** Use `eth_signTypedData_v4` (EIP-712) for `auth_verify`. See Bug 4 below.

### Issue 2: Missing auth_verify documentation

The tutorial doesn't explain that `auth_verify` requires **EIP-712 typed data signing** with specific domain configuration. This critical information is only in `/docs/protocol/off-chain/authentication/`.

### Issue 3: Missing EIP-712 configuration

Required but not documented in tutorial:
- Domain: `{name: "clearnode"}` (or your application name)
- EIP712Domain type: only `name` field (no version, chainId)
- Addresses must be checksummed

### Issue 4: Signer function receives payload array

The SDK's signer receives `[requestId, method, params, timestamp]` array, not a simple string. The tutorial's example is misleading.

---

## Bug 1: Invalid message "data" must be a valid string

**Error Message:**
```
ERROR] Failed to create session: Invalid message "data": 1770108494460,create_app_session,[object Object],1770108488680 must be a valid string.
```

**Cause:**
The `MessageSigner` function in the SDK expects to receive a payload array `[requestId, method, params, timestamp]` and sign it. The initial implementation passed a simple string message to `personal_sign`, but the SDK passes the raw array.

**Solution:**
The signer function must JSON.stringify the payload array before signing:

```javascript
createMessageSigner(address) {
  return async (payload) => {
    // The payload is an array like [requestId, method, params, timestamp]
    // We need to stringify it and sign the result
    const message = JSON.stringify(payload);
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address]
    });
    return signature;
  };
}
```

---

## Bug 2: Invalid response - Invalid 'res' payload structure or types

**Error Message:**
```
[ERROR] Invalid response: Invalid 'res' payload structure or types.
```

**Cause:**
The SDK's `NitroliteRPC.parseResponse()` expects responses in a specific format: `{res: [requestId, method, data, timestamp], sig: [...]}`. Some server messages (like initial connection messages or notifications) don't follow this format.

**Solution:**
Handle raw messages before passing to the SDK parser:

```javascript
handleMessage(data) {
  let parsed;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    this.log(`Non-JSON message: ${data}`);
    return;
  }

  // Check if it's a standard response format before using SDK parser
  if (parsed.res) {
    const [requestId, method, responseData, timestamp] = parsed.res;
    // Handle response...
  } else {
    // Handle non-standard message formats
  }
}
```

---

## Bug 3: Failed to parse auth parameters

**Error Message:**
```
{"res":[1770108871038,"error",{"error":"failed to parse auth parameters"},1770108868021],"sig":["0x9..."]}
```

**Cause:**
Multiple issues:
1. The SDK's `createAuthRequestMessage()` only sends `[clientAddress]` as params
2. The server expects a specific object format with different field names
3. `auth_request` is a **PUBLIC endpoint that does NOT require a signature**
4. `expires_at` must be in **SECONDS** (10 digits), not milliseconds - Go server uses `time.Unix()`

**Required Parameters (from Yellow docs):**
- `address` (required) - Main wallet address
- `session_key` (required) - Session keypair address
- `expires_at` (required) - Unix timestamp in SECONDS
- `application` (optional) - Defaults to "clearnode"
- `allowances` (optional) - Spending limits per asset
- `scope` (optional) - Permitted operations

**Solution:**
Create an UNSIGNED auth request with correct parameter format:

```javascript
async authenticate() {
  const requestId = generateRequestId();
  const timestamp = getCurrentTimestamp();

  // expires_at must be in SECONDS (10 digits) - Go server uses time.Unix()
  const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now

  const authParams = [{
    address: this.userAddress,
    session_key: this.userAddress, // Can use wallet or generate separate key
    expires_at: expiresAt,
    application: 'clearnode' // Full access
  }];

  const payload = [requestId, 'auth_request', authParams, timestamp];

  // NO SIGNATURE - auth_request is public
  const authRequest = {
    req: payload
    // Note: no sig field
  };

  this.ws.send(JSON.stringify(authRequest));
}
```

**Reference:** https://docs.yellow.org/docs/protocol/off-chain/authentication/

---

## Bug 4: Invalid challenge or signature (Browser Wallet Authentication)

**Error Message:**
```
{"res":[...,"error",{"error":"invalid challenge or signature"},...],"sig":[...]}
```

**Cause:**
Browser wallets (MetaMask) cannot do raw ECDSA signing like the SDK's `createECDSAMessageSigner`. The SDK expects signatures over `keccak256(toHex(JSON.stringify(payload)))` without the Ethereum message prefix, but `personal_sign` adds the prefix `"\x19Ethereum Signed Message:\n"`.

**Solution:**
Use EIP-712 typed data signing for `auth_verify`. The **critical configuration** discovered:

1. **EIP712Domain only has `name` field** (no version, chainId, etc.)
2. **Domain name must be the `application` value from `auth_request`** (e.g., `"clearnode"`)
3. **Addresses must be checksummed** (use viem's `getAddress()`)
4. **expires_at should be a number** (not a string)

```javascript
import { getAddress } from 'viem';
import { EIP712AuthTypes } from '@erc7824/nitrolite';

// Checksum addresses for consistency
const checksummedAddress = getAddress(userAddress);

// EIP-712 typed data (per docs.yellow.org/docs/protocol/off-chain/authentication)
const typedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' }  // ONLY name field!
    ],
    ...EIP712AuthTypes  // Policy and Allowance types
  },
  primaryType: 'Policy',
  domain: {
    name: 'clearnode'  // Must match 'application' from auth_request
  },
  message: {
    challenge: challengeMessage,  // From auth_challenge response
    scope: '',
    wallet: checksummedAddress,   // Checksummed!
    session_key: checksummedAddress,
    expires_at: expiresAtTimestamp,  // Number, not string
    allowances: []
  }
};

const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [userAddress, JSON.stringify(typedData)]
});
```

**Important:** The signature must be created with the **main wallet** (not the session key).

**Reference:** https://docs.yellow.org/docs/protocol/off-chain/authentication/

---

## Bug 5: Failed to generate JWT token (SOLVED)

**Error Message:**
```
{"res":[...,"error",{"error":"failed to generate JWT token"},...],"sig":[...]}
```

**Cause:**
The `expires_at` timestamp was being sent in **milliseconds**, but the Go server expects **seconds**. The server uses `time.Unix(int64(sessionKeyExpiresAt), 0)` which interprets the value as seconds since epoch.

When milliseconds are passed (e.g., `1770206055276`), the server interprets this as a date in the year 58065, causing JWT generation to fail.

**Solution:**
Use seconds instead of milliseconds for `expires_at`:

```javascript
// WRONG - milliseconds
const expiresAt = Date.now() + (24 * 60 * 60 * 1000);  // ❌

// CORRECT - seconds
const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60);  // ✓
```

**Reference:** Go server code at `clearnode/auth.go`:
```go
ExpiresAt: time.Unix(int64(sessionKeyExpiresAt), 0),  // Expects SECONDS
```

---

## General Notes

### Nitro RPC Message Format

All messages to Yellow Network follow this format:

**Request:**
```json
{
  "req": [requestId, "method_name", [params], timestamp],
  "sig": ["0x...signature"]
}
```

**Response:**
```json
{
  "res": [requestId, "method_name", [result_data], timestamp],
  "sig": ["0x...signature"]
}
```

### Signature Format

- Signatures are 65-byte ECDSA signatures (r + s + v)
- Represented as 0x-prefixed hex strings
- The payload being signed is the JSON.stringify'd version of the request/response array

### SDK Version Compatibility

These bugs were encountered with `@erc7824/nitrolite` version `0.5.3`. The SDK provides:
- `createECDSAMessageSigner` - For server-side signing with private keys
- `createEIP712AuthMessageSigner` - For browser wallet EIP-712 signing
- `EIP712AuthTypes` - The typed data schema for authentication

For browser wallets, use EIP-712 typed data signing with the domain `{name: "clearnode"}`.

---

## Bug 6: Invalid signature for transfer requests (SOLVED)

**Error Message:**
```
{"res":[...,"error",{"error":"invalid signature"},...],..."sig":[...]}
```

**Cause:**
Browser wallets (MetaMask) use `personal_sign` which adds the Ethereum message prefix `"\x19Ethereum Signed Message:\n{length}"`. The SDK's `createECDSAMessageSigner` does raw ECDSA signing (keccak256 hash without prefix), which is what the server expects for transfer and other signed requests.

The `createEIP712AuthMessageSigner` in the SDK is **only for auth_verify** - it throws an error for other methods.

**Solution:**
Use a **session key** approach:

1. Generate a temporary private key in the browser during authentication
2. Use the session key address in `auth_request` (not the main wallet address)
3. Use `createECDSAMessageSigner` with the private key for all subsequent requests

```javascript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createECDSAMessageSigner } from '@erc7824/nitrolite';

// During authentication:
const sessionKeyPrivate = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionKeyPrivate);
const sessionKeyAddress = sessionAccount.address;

// Create ECDSA signer for all subsequent requests
const messageSigner = createECDSAMessageSigner(sessionKeyPrivate);

// Use session key in auth_request
const authParams = {
  address: checksummedMainWalletAddress,  // Main wallet
  session_key: checksummedSessionKeyAddress,  // Session key (different!)
  application: 'clearnode',
  allowances: [],
  expires_at: expiresAtInSeconds,
  scope: ''
};
```

The main wallet only signs the EIP-712 auth_verify (one-time authorization). The session key handles all subsequent operations (transfers, etc.) with raw ECDSA signatures.

**Benefits:**
- No MetaMask popup for every transaction (better UX)
- Session keys can have limited scope/allowances
- If compromised, only affects the session (not main wallet)
