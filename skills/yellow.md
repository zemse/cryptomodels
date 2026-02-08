# Yellow Network

Decentralized clearing and settlement protocol using state channels for instant, low-cost off-chain transactions.

**SDK:** `@erc7824/nitrolite` (v0.5.x)
**Docs:** https://docs.yellow.org
**Source:** `nitrolite/` submodule in project root

---

## Table of Contents

1. [Architecture](#architecture)
2. [SDK Quick Start](#sdk-quick-start)
3. [Authentication Flow](#authentication-flow)
4. [RPC Methods](#rpc-methods)
5. [Channels & State Management](#channels--state-management)
6. [On-Chain Operations](#on-chain-operations)
7. [Contracts Reference](#contracts-reference)
8. [Common Issues & Solutions](#common-issues--solutions)

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│ APPLICATION LAYER - Custom business logic, payments, apps   │
├─────────────────────────────────────────────────────────────┤
│ OFF-CHAIN LAYER - Nitrolite RPC, WebSocket, state sync      │
├─────────────────────────────────────────────────────────────┤
│ ON-CHAIN LAYER - Custody contract, adjudicators, disputes   │
└─────────────────────────────────────────────────────────────┘
```

### Key Concepts

| Term | Description |
|------|-------------|
| **Channel** | Two-party state channel between user and server |
| **App Session** | Multi-party channel with custom governance (quorum, weights) |
| **Session Key** | Delegated key for gasless signing without wallet popups |
| **Adjudicator** | Contract that validates state transitions |
| **Custody** | Main contract holding funds and managing channel lifecycle |

### Data Types (from `nitrolite/contract/src/interfaces/Types.sol`)

```solidity
struct Channel {
    address[] participants;  // [user, server] - exactly 2
    address adjudicator;     // State transition validator
    uint64 challenge;        // Dispute period in seconds (min 1 hour)
    uint64 nonce;            // Unique per channel config
}

struct State {
    StateIntent intent;      // OPERATE, INITIALIZE, RESIZE, FINALIZE
    uint256 version;         // Incrementing version number
    bytes data;              // Application-specific data
    Allocation[] allocations; // Fund distribution
    bytes[] sigs;            // Participant signatures
}

struct Allocation {
    address destination;     // Where funds go on close
    address token;           // ERC-20 or address(0) for ETH
    uint256 amount;          // Token amount
}

enum StateIntent { OPERATE, INITIALIZE, RESIZE, FINALIZE }
enum ChannelStatus { VOID, INITIAL, ACTIVE, DISPUTE, FINAL }
```

---

## SDK Quick Start

### Installation

```bash
npm install @erc7824/nitrolite
```

### Key Imports

```typescript
import {
  // RPC
  NitroliteRPC,

  // Signers
  createECDSAMessageSigner,
  WalletStateSigner,
  SessionKeyStateSigner,

  // On-chain service
  NitroliteService,

  // Utilities
  getChannelId,
  getPackedState,
  generateChannelNonce,

  // Types
  EIP712AuthTypes,
} from '@erc7824/nitrolite';
```

### WebSocket Endpoints

```javascript
// Sandbox (testing)
const ws = new WebSocket('wss://clearnet-sandbox.yellow.com/ws');

// Production
const ws = new WebSocket('wss://clearnet.yellow.com/ws');
```

### Assets

| Environment | Asset | Token Address (Sepolia) |
|-------------|-------|-------------------------|
| Sandbox | `ytest.usd` | `0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb` |
| Production | `usdc` | - |

**Balance Units:** 1 USDC = 1,000,000 microunits

---

## Authentication Flow

### Overview

3-step challenge-response flow:
```
auth_request → auth_challenge → auth_verify → JWT token
```

### Step 1: auth_request (PUBLIC - No Signature)

```typescript
const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // SECONDS!

const authParams = {
  address: mainWalletAddress,      // Required: main wallet
  session_key: sessionKeyAddress,  // Required: generated keypair
  expires_at: expiresAt,           // Required: Unix timestamp in SECONDS
  application: 'clearnode',        // Optional
  allowances: [],                  // Optional: spending limits
  scope: ''                        // Optional: permitted operations
};

// NO signature required
ws.send(JSON.stringify({ req: [requestId, 'auth_request', authParams, timestamp] }));
```

### Step 2: auth_challenge (Server Response)

```json
{"res": [requestId, "auth_challenge", {"challenge_message": "uuid-v4"}, timestamp]}
```

### Step 3: auth_verify (EIP-712 Signature with Main Wallet)

```typescript
import { getAddress } from 'viem';
import { EIP712AuthTypes } from '@erc7824/nitrolite';

const typedData = {
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }],  // ONLY name!
    ...EIP712AuthTypes
  },
  primaryType: 'Policy',
  domain: { name: 'clearnode' },  // Must match 'application'
  message: {
    challenge: challengeMessage,
    scope: '',
    wallet: getAddress(mainWalletAddress),      // Checksummed!
    session_key: getAddress(sessionKeyAddress),
    expires_at: expiresAtInSeconds,             // Number, not string!
    allowances: []
  }
};

const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [mainWalletAddress, JSON.stringify(typedData)]
});
```

### Session Key Pattern (Recommended)

```typescript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createECDSAMessageSigner } from '@erc7824/nitrolite';

// Generate during auth
const sessionKeyPrivate = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionKeyPrivate);

// Use for all subsequent signed requests
const messageSigner = createECDSAMessageSigner(sessionKeyPrivate);
```

---

## RPC Methods

### Message Format

**Request:**
```json
{ "req": [requestId, "method", params, timestamp], "sig": ["0x..."] }
```

**Response:**
```json
{ "res": [requestId, "method", result, timestamp], "sig": ["0x..."] }
```

### Available Methods

| Method | Signed | Description |
|--------|--------|-------------|
| `auth_request` | No | Initiate authentication |
| `auth_verify` | Yes (EIP-712) | Complete authentication |
| `get_config` | Yes | Get server configuration |
| `get_ledger_balances` | Yes | Get off-chain balances |
| `get_channels` | Yes | List channels |
| `create_channel` | Yes | Create new channel |
| `resize_channel` | Yes | Adjust channel allocation |
| `close_channel` | Yes | Request channel close |
| `transfer` | Yes | Send payment |
| `create_app_session` | Yes | Create multi-party session |
| `submit_app_state` | Yes | Update app session state |
| `close_app_session` | Yes | Close app session |
| `ping` / `pong` | Yes | Keep-alive |

### Creating Requests with SDK

```typescript
import { NitroliteRPC } from '@erc7824/nitrolite';

const message = NitroliteRPC.createRequest({
  method: 'get_ledger_balances',
  params: {}
});

await NitroliteRPC.signRequestMessage(message, messageSigner);
ws.send(JSON.stringify(message));
```

---

## Channels & State Management

### Channel Lifecycle

```
VOID → INITIAL → ACTIVE → (DISPUTE) → FINAL
         ↓         ↓
      create()   close()/challenge()
```

### Creating a Channel (WebSocket)

```typescript
const params = {
  chain_id: 11155111,  // Sepolia
  token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb'
};

// Response includes: channel, state, server_signature
```

### Resize Channel (Move Funds)

```typescript
const params = {
  channel_id: channelId,
  allocate_amount: 500000n,     // Move from ledger to channel
  // OR
  resize_amount: -500000n,      // Negative to deallocate
  funds_destination: userAddress
};
```

### State Signers

| Signer | Use Case |
|--------|----------|
| `WalletStateSigner` | Browser wallet (MetaMask) - uses EIP-191 |
| `SessionKeyStateSigner` | Session key - uses raw ECDSA |
| `createECDSAMessageSigner` | Raw ECDSA for RPC messages |

### Signing States

```typescript
import { getPackedState, getChannelId } from '@erc7824/nitrolite';

const channelId = getChannelId(channel, chainId);
const packedState = getPackedState(channelId, state);

// With wallet
const sig = await walletClient.signMessage({ message: { raw: packedState } });

// With session key
const sig = await sessionSigner.signState(channelId, state);
```

---

## On-Chain Operations

### Flow for On-Chain Withdrawals

```
┌─────────────────────────────────────────────────────────────────┐
│                     OFF-CHAIN (WebSocket)                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. create_channel → Returns channel + state + server_signature  │
│ 2. resize_channel → Allocates funds from ledger to channel      │
│ 3. close_channel  → Returns final state + server_signature      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ON-CHAIN (Blockchain)                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. NitroliteService.createChannel() - Submit with both sigs     │
│ 2. NitroliteService.resize() - On-chain resize if needed        │
│ 3. NitroliteService.close() - Withdraw to wallet                │
└─────────────────────────────────────────────────────────────────┘
```

### NitroliteService Usage

```typescript
import { NitroliteService } from '@erc7824/nitrolite';

const service = new NitroliteService(
  publicClient,
  { custody: CUSTODY_ADDRESS },
  walletClient,
  account
);

// Deposit to custody
await service.deposit(tokenAddress, amount);

// Create channel on-chain
await service.createChannel(channel, signedState);

// Close and withdraw
await service.close(channelId, finalState, []);

// Withdraw from custody to wallet
await service.withdraw(tokenAddress, amount);
```

### Signature Order

**CRITICAL:** State signatures must be `[userSignature, serverSignature]`

```typescript
const signedState = {
  ...state,
  sigs: [userSignature, serverSignature]  // Order matters!
};
```

---

## Contracts Reference

### Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| Custody | `0x019B65A265EB3363822f2752141b3dF16131b262` |
| Test Token (ytest.usd) | `0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb` |

### Custody.sol Function Selectors

| Function | Selector | Description |
|----------|----------|-------------|
| `deposit(address,address,uint256)` | `0x8340f549` | Deposit tokens to account |
| `withdraw(address,uint256)` | `0xf3fef3a3` | Withdraw from ledger |
| `create(Channel,State)` | `0x4a7e7798` | Create channel |
| `depositAndCreate(...)` | `0x00e2bb2c` | Deposit + create in one tx |
| `join(bytes32,uint256,bytes)` | `0xbab3290a` | Server joins channel |
| `close(bytes32,State,State[])` | `0x7f9ebbd7` | Close channel |
| `challenge(bytes32,State,State[],bytes)` | `0x1474e410` | Initiate dispute |
| `checkpoint(bytes32,State,State[])` | `0xecf668fd` | Store state on-chain |
| `resize(bytes32,State,State[])` | `0x183b4998` | Resize allocations |
| `getAccountsBalances(address[],address[])` | `0x2f33c4d6` | Read balances |
| `getOpenChannels(address[])` | `0xd710e92f` | List open channels |
| `getChannelData(bytes32)` | `0xe617208c` | Get channel info |
| `getChannelBalances(bytes32,address[])` | `0x5a9eb80e` | Channel token balances |

### SimpleConsensus Adjudicator

Validates states based on mutual signatures from both participants.
- Any state is valid if signed by both participants
- Version 0 states validated as initial states
- No proofs required (`proofs.length == 0`)

Source: `nitrolite/contract/src/adjudicators/SimpleConsensus.sol`

### Key Contract Constants

```solidity
uint256 constant PART_NUM = 2;           // Only 2-party channels
uint256 constant CLIENT_IDX = 0;         // User index
uint256 constant SERVER_IDX = 1;         // Server index
uint256 constant MIN_CHALLENGE_PERIOD = 1 hours;
```

---

## Common Issues & Solutions

### expires_at Must Be in SECONDS

```typescript
// WRONG - milliseconds causes "failed to generate JWT token"
const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

// CORRECT - seconds
const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
```

### personal_sign Doesn't Work for auth_verify

Use `eth_signTypedData_v4` (EIP-712), not `personal_sign`. The Ethereum message prefix breaks signature verification.

### Invalid Signature for Transfers

Browser wallets can't do raw ECDSA signing. Use session keys with `createECDSAMessageSigner` for all requests after auth.

### EIP-712 Domain Configuration

```typescript
// CORRECT - only 'name' field
types: { EIP712Domain: [{ name: 'name', type: 'string' }] }
domain: { name: 'clearnode' }
```

### Addresses Must Be Checksummed

```typescript
import { getAddress } from 'viem';
const checksummed = getAddress(address);
```

### WebSocket Disconnects (~60s Idle)

Implement auto-reconnect with re-authentication:

```typescript
ws.onclose = () => {
  isAuthenticated = false;
  setTimeout(() => connectAndReauth(), 3000);
};
```

### Chain Mismatch for On-Chain Transactions

```typescript
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: `0x${chainId.toString(16)}` }]
});
// Recreate viem clients after switch!
```

### Signer Receives Payload Array

```typescript
// SDK signer receives [requestId, method, params, timestamp]
const messageSigner = async (payload) => {
  const message = JSON.stringify(payload);  // Must stringify first
  return signRawECDSAMessage(toHex(message), privateKey);
};
```

### Faucet Tokens Go to Off-Chain Balance

Faucet tokens go to unified OFF-CHAIN balance, not wallet. To withdraw:
1. Create channel via WebSocket
2. Submit channel to blockchain
3. Resize to allocate funds to channel
4. Close channel to withdraw

### Standalone Deposits NOT Detected by Clearnode

**CRITICAL:** The clearnode does NOT monitor standalone `Deposited` events. It only monitors channel-related events:
- `Created` - channel creation
- `Resized` - channel resize
- `Closed` - channel close
- `Challenged` - disputes

If you call `deposit()` directly on the Custody contract, the funds will be stuck in custody but the clearnode's ledger won't know about them.

**Solution: Use `depositAndCreate` Pattern**

```typescript
// 1. Get channel config from clearnode via WebSocket
const channelMessage = await createCreateChannelMessage(signer, {
  chain_id: 8453,
  token: USDC_ADDRESS
});
ws.send(channelMessage);

// 2. In response handler, sign state and call depositAndCreate on-chain
const { channel, state, serverSignature } = channelData;
const channelId = getChannelId(channel, chainId);
const packedState = getPackedState(channelId, unsignedState);
const userSignature = await wallet.signMessage({ message: { raw: packedState } });

// 3. Execute depositAndCreate with both signatures
await custody.depositAndCreate(
  tokenAddress,
  depositAmount,
  channel,
  { ...state, sigs: [userSignature, serverSignature] }
);
```

This emits a `Created` event which clearnode monitors.

**IMPORTANT LIMITATION (as of Feb 2026):** Even with `depositAndCreate`, the deposited funds go to the user's on-chain custody account, while the channel is created with 0 allocation. The clearnode sees the Created event but only knows about the 0-allocation channel, not the custody deposit.

Calling `resize_channel` after `depositAndCreate` fails with "insufficient unified balance" because clearnode's internal ledger doesn't track on-chain custody balances.

**Current workaround:**
- Withdraw stuck custody funds directly using `Custody.withdraw(token, amount)`
- Use testnet faucet which credits directly to clearnode's internal ledger
- This is a protocol limitation that needs clearnode changes to fix

---

## SDK Source Reference

Key files in `nitrolite/sdk/src/`:

| File | Purpose |
|------|---------|
| `client/services/NitroliteService.ts` | On-chain contract interactions |
| `client/signer.ts` | State signing (Wallet/SessionKey) |
| `client/state.ts` | State preparation helpers |
| `rpc/nitrolite.ts` | RPC message creation/signing |
| `rpc/types/request.ts` | All RPC request types |
| `utils/channel.ts` | Channel ID, nonce generation |
| `utils/state.ts` | State hashing, packing |
