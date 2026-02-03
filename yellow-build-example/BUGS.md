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

---

## Bug 7: Chain mismatch when submitting on-chain transactions (SOLVED)

**Error Message:**
```
The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 11155111 – Sepolia). Current Chain ID: 1 Expected Chain ID: 11155111 – Sepolia
```

**Cause:**
When submitting on-chain transactions (create channel, resize, close), the wallet must be on the correct network. If the user's MetaMask is on Ethereum mainnet (chain ID 1) but the transaction targets Sepolia (chain ID 11155111), viem will throw a chain mismatch error during `writeContract`.

**Solution:**
Check the current chain and request a network switch before submitting transactions:

```javascript
async submitChannelOnChain(channelData) {
  const chainId = parseInt(this.elements.chainSelect.value);
  const chainConfig = CHAIN_CONFIG[chainId];

  // Switch to the correct network if needed
  const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
  const currentChainIdDecimal = parseInt(currentChainId, 16);

  if (currentChainIdDecimal !== chainId) {
    this.log(`Switching to ${chainConfig.name}...`);
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }]
      });
      // Recreate wallet client after network switch
      this.walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      this.publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });
    } catch (switchError) {
      this.log(`Please switch to ${chainConfig.name} in your wallet`, 'error');
      return;
    }
  }

  // Continue with on-chain submission...
}
```

**Note:** After switching networks, you must recreate the viem wallet/public clients with the new chain configuration.

---

## Bug 8: Authentication timeout race condition (SOLVED)

**Error Message:**
```
[18:39:50] Authentication successful!
[18:39:50] Failed to connect wallet: Authentication timeout
```

**Cause:**
The authentication flow uses a Promise with a setTimeout for timeout handling. If the timeout is too short (e.g., 15 seconds) and the user is slow to approve the MetaMask EIP-712 signature, the timeout fires and rejects the Promise. However, when the user finally signs, the auth_verify response arrives and tries to resolve the already-rejected Promise.

This causes:
1. The "Authentication timeout" error message
2. The Promise rejection propagates, preventing button state updates
3. The actual successful auth happens but the UI doesn't reflect it

**Solution:**
1. Increase the timeout to allow for MetaMask signing (60+ seconds)
2. Store the timeout ID and clear it when auth succeeds
3. Check `isAuthenticated` before rejecting

```javascript
async authenticate() {
  return new Promise(async (resolve, reject) => {
    this.log('Authenticating with Clearnode...');
    this.pendingAuthResolve = resolve;

    // ... setup auth request ...

    this.ws.send(authMessage);

    // Store timeout ID so we can clear it on success
    this.authTimeoutId = setTimeout(() => {
      if (!this.isAuthenticated) {
        this.pendingAuthResolve = null;
        reject(new Error('Authentication timeout'));
      }
    }, 60000);  // 60 second timeout for MetaMask signing
  });
}

// In the auth_verify response handler:
case 'auth_verify':
  this.log('Authentication successful!');
  this.isAuthenticated = true;
  // Clear the auth timeout
  if (this.authTimeoutId) {
    clearTimeout(this.authTimeoutId);
    this.authTimeoutId = null;
  }
  if (this.pendingAuthResolve) {
    this.pendingAuthResolve();
    this.pendingAuthResolve = null;
  }
  break;
```

---

## Bug 9: On-chain channel creation requires both signatures (SOLVED)

**Error Message:**
```
Transaction failed during operation 'createChannel'
Contract call simulation failed for function 'prepareCreateChannel'
```

**Cause:**
The custody contract's `create` function requires the initial state to have signatures from BOTH channel participants:
1. The user's signature (first participant)
2. The server's signature (provided in `create_channel` response as `server_signature`)

Initially, we were only passing the server signature, or signing with the wrong key (session key instead of main wallet).

**Solution:**
1. The `create_channel` WebSocket response includes `server_signature` - this is the server's signature over the initial state
2. The user must sign the packed state using their main wallet (the address that appears as `participants[0]`)
3. Pass both signatures in the correct order: `[userSignature, serverSignature]`

```javascript
// Get channel data from create_channel response
const { channel, state, server_signature } = channelData;

// Calculate channel ID
const channelIdCalculated = getChannelId(channel, chainId);

// Pack the state for signing
const packedState = getPackedState(channelIdCalculated, unsignedState);

// Sign with main wallet (the first participant)
const userSignature = await walletClient.signMessage({
  account: userAddress,
  message: { raw: packedState }
});

// State needs sigs in order: [userSignature, serverSignature]
const signedState = {
  ...unsignedState,
  sigs: [userSignature, server_signature]
};

// Submit to blockchain
const txHash = await nitroliteService.createChannel(channel, signedState);
```

**Key insight:** The SDK's `WalletStateSigner` uses `walletClient.signMessage({ message: { raw: packedState } })` which signs the keccak256 hash of the packed state with the Ethereum message prefix. The contract expects this format.

---

## Bug 10: WebSocket disconnects frequently (SOLVED)

**Symptom:**
```
[18:52:52] Disconnected from Yellow Network
[18:52:55] Connecting to Yellow Network...
[18:52:56] Connected to Yellow Network!
[18:53:56] Disconnected from Yellow Network
```

**Cause:**
The WebSocket connection to `wss://clearnet-sandbox.yellow.com/ws` disconnects approximately every 60 seconds. This appears to be a server-side idle timeout. When disconnected:
1. The authentication state is lost
2. Ongoing operations (like channel creation) are interrupted
3. Users see "Please authenticate first" errors

**Solution:**
Implemented auto-reconnect with re-authentication. When the WebSocket reconnects and a wallet was previously connected, the app automatically:
1. Re-authenticates with the Clearnode (generates new session key)
2. Fetches updated balances
3. Refreshes channels list
4. Restores button states

```javascript
this.ws.onopen = async () => {
  this.elements.wsStatus.classList.add('connected');
  this.elements.wsStatusText.textContent = 'Connected to Yellow Network';
  this.log('Connected to Yellow Network!');

  // Auto re-authenticate if wallet was previously connected
  if (this.userAddress && !this.isAuthenticated) {
    this.log('Re-authenticating...');
    this.elements.connectBtn.textContent = 'Authenticating...';
    try {
      await this.authenticate();
      this.log('Re-authenticated successfully!');
      // Restore UI state
      this.elements.connectBtn.textContent = 'Connected';
      this.elements.connectBtn.disabled = true;
      // ... enable other buttons ...
      // Refresh data after re-authentication
      await this.getBalances();
      await this.getChannels();
    } catch (error) {
      this.log(`Re-authentication failed: ${error.message}`, 'error');
      this.elements.connectBtn.textContent = 'Reconnect';
      this.elements.connectBtn.disabled = false;
    }
  }
};

this.ws.onclose = () => {
  this.isAuthenticated = false;
  // Update button to show reconnecting state
  if (this.userAddress) {
    this.elements.connectBtn.textContent = 'Reconnecting...';
    this.elements.connectBtn.disabled = true;
  }
  // Auto-reconnect after 3 seconds
  setTimeout(() => this.connectWebSocket(), 3000);
};
```

**Note:** Each reconnect generates a new session key for security. The user only needs to sign the initial EIP-712 auth (once per browser session). Subsequent reconnects use the existing wallet connection without requiring new MetaMask popups.

---

## Bug 11: On-chain channel data lost on page reload (LIMITATION)

**Symptom:**
After creating a channel on-chain and reloading the page, the "Close & Withdraw" button disappears because the on-chain channel data is stored in memory only.

**Cause:**
The `onChainChannels` Map that tracks channels submitted to the blockchain is stored in the app's JavaScript memory. On page reload:
1. The Map is reinitialized as empty
2. The channel still exists on-chain but the app doesn't know about it
3. The `get_channels` WebSocket call returns empty because the server may not track on-chain-only channels

**Solution:**
Store on-chain channel data in localStorage:

```javascript
// Save after on-chain creation
this.onChainChannels.set(channelData.channel_id, data);
localStorage.setItem('onChainChannels', JSON.stringify([...this.onChainChannels]));

// Restore on app init
const stored = localStorage.getItem('onChainChannels');
if (stored) {
  this.onChainChannels = new Map(JSON.parse(stored));
}
```

**Alternative:** Query the custody contract directly using `NitroliteService.getOpenChannels(userAddress)` to find all on-chain channels.

---

## On-Chain Channel Flow Summary

Based on testing and the [GitHub discussion](https://github.com/layer-3/docs/discussions/20), here's the complete flow for on-chain withdrawals:

### Getting Test Tokens On-Chain - SIMPLIFIED FLOW

**The correct simple 3-step flow:**

1. **Faucet tokens go to unified OFF-CHAIN balance** - NOT directly to your wallet
2. **To get tokens ON-CHAIN (Simple 3-step):**
   - **Step 1**: Create channel via WebSocket (off-chain only)
   - **Step 2**: Resize with **positive** `resize_amount` (moves from ledger to on-chain custody)
   - **Step 3**: Close channel on-chain (withdraws to wallet)

### Channel Lifecycle - CORRECTED

```
┌─────────────────────────────────────────────────────────────────┐
│                     OFF-CHAIN (WebSocket)                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. create_channel → Returns channel + state + server_signature  │
│ 2. resize_channel (resize_amount: +amount) → Moves to custody   │
│ 3. close_channel  → Returns final state + server_signature      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ON-CHAIN (Blockchain)                        │
├─────────────────────────────────────────────────────────────────┤
│ NitroliteService.close(channelId, finalState, [])               │
│    - User signs final state with main wallet                    │
│    - Submit close transaction                                    │
│    - Tokens sent to funds_destination address                   │
└─────────────────────────────────────────────────────────────────┘
```

### IMPORTANT: resize_amount vs allocate_amount

| Parameter | Direction | Use Case |
|-----------|-----------|----------|
| `allocate_amount` | Ledger → Channel (off-chain) | Fund existing channel |
| `resize_amount` (positive) | Ledger → On-chain custody | **Withdrawal flow** |
| `resize_amount` (negative) | Channel → Custody | Reduce channel size |

### Key Points

- **You do NOT need to submit channel creation on-chain first**
- **Use `resize_amount` (positive) to move from ledger to custody**
- **Custody Contract (Sepolia):** `0x019B65A265EB3363822f2752141b3dF16131b262`
- **Test Token (ytest.usd):** `0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb`
- **Signatures order:** Always `[userSignature, serverSignature]`
- **State signing:** Use `getPackedState(channelId, state)` then sign with `walletClient.signMessage({ message: { raw: packedState } })`

### What Was Wrong

The initial implementation tried a complex 5-step flow:
```
create → submit on-chain → allocate → negative resize → submit resize → withdraw
```

This was caused by misunderstanding the difference between `allocate_amount` and `resize_amount`:
- `allocate_amount` moves funds from ledger to channel (OFF-CHAIN only)
- `resize_amount` (positive) moves funds from ledger to ON-CHAIN custody

The correct 3-step flow is:
```
create → resize (+amount) → close on-chain
```

### Implementation Status

✅ **FIXED** - The simplified 3-step withdrawal flow has been implemented in `src/app.js`:

1. `withdrawToWallet()` - Initiates withdrawal with proper balance checks
2. `handleCreateChannelResponse()` - Triggers resize with positive amount
3. `handleResizeChannelResponse()` - Triggers close channel
4. `handleCloseChannelResponse()` - Submits close transaction on-chain
5. `submitCloseOnChainSimple()` - New method to handle final on-chain close

The old complex methods have been commented out with deprecation notes:
- `allocateFundsToChannel()`
- `resizeNegativeForWithdrawal()`
- `requestWithdrawalResize()`
- `submitStateToCustody()`
- `withdrawFromCustodyFinal()`

### Testing

To test the fixed withdrawal flow:
1. Connect wallet and authenticate
2. Get test tokens from faucet (off-chain balance)
3. Click "Withdraw to Wallet"
4. Approve MetaMask signature for final state (once)
5. Approve MetaMask transaction for on-chain close (once)
6. Check Sepolia wallet for ytest.usd tokens

Expected logs:
```
Starting withdrawal: 1.0 USDC to Ethereum Sepolia
Step 1/3: Creating off-chain channel...
Step 2/3: Moving funds to on-chain custody...
Step 3/3: Closing channel to withdraw to wallet...
Submitting close transaction on-chain...
✓ Withdrawal complete!
```
