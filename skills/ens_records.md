# ENS (Ethereum Name Service) Records - LLM Optimized

**Last Updated**: February 2026
**ENS Version**: V2 Ready
**Library**: Viem (recommended)

---

## EXECUTIVE SUMMARY

ENS (Ethereum Name Service) is a decentralized naming system that maps human-readable names like `alice.eth` to blockchain addresses, content hashes, and metadata.

**Key Features**:
- Resolve names to addresses (forward lookup)
- Resolve addresses to names (reverse lookup)
- Store text records (email, social handles, avatar)
- Multi-chain address support (BTC, SOL, L2s)
- Decentralized, self-sovereign identity

**Core Architecture**: Registry (maps names to resolvers) + Resolvers (translate names to data)

---

## TABLE OF CONTENTS

1. [Core Concepts](#core-concepts)
2. [Record Types](#record-types)
3. [Implementation with Viem](#implementation-with-viem)
4. [Text Records](#text-records)
5. [Multi-Chain Addresses](#multi-chain-addresses)
6. [Common Mistakes & Gotchas](#common-mistakes--gotchas)
7. [Code Examples](#code-examples)
8. [Best Practices](#best-practices)

---

## CORE CONCEPTS

### What is ENS?

ENS is like DNS for blockchain:
- DNS: `google.com` → `142.250.185.46`
- ENS: `vitalik.eth` → `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

### Two-Layer Architecture

```
┌──────────────────────────────────────────┐
│         ENS Registry                     │
│  Maps: name → resolver address           │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│         Resolver Contract                │
│  Translates: name → address/text/hash    │
└──────────────────────────────────────────┘
```

**Registry**: On-chain database mapping names to resolver contracts
**Resolver**: Smart contract that translates names into actual data

### Name Components

**Primary Name** (`alice.eth`):
- `.eth` - Top-level domain (TLD)
- `alice` - Label/subdomain

**Subdomains** (`pay.alice.eth`):
- `pay` - Subdomain label
- `alice.eth` - Parent domain

### Namehash

ENS uses namehash (not plain text) for on-chain operations:
- `alice.eth` → `0x787192fc5378cc32aa956ddfdedbf26b24e8d78e40109add0eea2c1a012c3dec`
- Deterministic hash algorithm
- Preserves hierarchy

**Important**: Always use namehash for contract calls, never raw strings.

---

## RECORD TYPES

### ENSIP-1: Standard Resolver Interfaces

| Record Type | Interface ID | Purpose |
|-------------|--------------|---------|
| `addr` | `0x3b3b57de` | Ethereum address |
| `name` | `0x691f3431` | Reverse resolution |
| `text` | `0x59d1d43c` | Key-value metadata |
| `contenthash` | `0xbc1c58d1` | IPFS/Swarm hashes |
| `addr(bytes32,uint256)` | `0xf1cb7e06` | Multi-chain addresses |

### Primary Address Record

**Interface**:
```solidity
function addr(bytes32 node) returns (address)
```

**Behavior**:
- Returns `0x0000...0000` if no address set
- Must emit `AddrChanged` event on updates
- Clients must validate non-zero address

### Text Records (ENSIP-5)

**Interface**:
```solidity
function text(bytes32 node, string key) returns (string)
```

**Returns**: UTF-8 text or empty string if key doesn't exist

### Multi-Chain Addresses (ENSIP-9)

**Interface**:
```solidity
function addr(bytes32 node, uint256 coinType) returns (bytes)
```

**Coin Types** (from SLIP-0044):
- Bitcoin: `0`
- Litecoin: `2`
- Dogecoin: `3`
- Solana: `501`

**ENSIP-11 for L2s**:
- Base: `2147492101`
- Arbitrum: `2147525809`
- Optimism: `2147483658`

---

## IMPLEMENTATION WITH VIEM

### Installation

```bash
npm install viem
```

### Basic Setup

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});
```

### Forward Resolution (Name → Address)

```typescript
// Resolve ENS name to address
const address = await client.getEnsAddress({
  name: normalize('vitalik.eth'),
});

console.log(address); // 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

**Key Points**:
- Always use `normalize()` to handle case-folding and validation
- Returns `null` if name not registered
- Automatically uses Universal Resolver

### Reverse Resolution (Address → Name)

```typescript
// Resolve address to ENS name
const name = await client.getEnsName({
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
});

console.log(name); // vitalik.eth
```

**Important**: Only returns name if primary name is set for that address.

### Get ENS Resolver

```typescript
import { getEnsResolver } from 'viem/ens';

const resolver = await client.getEnsResolver({
  name: normalize('vitalik.eth'),
});

console.log(resolver); // 0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41
```

### Read Text Records

```typescript
// Get text record
const email = await client.getEnsText({
  name: normalize('vitalik.eth'),
  key: 'email',
});

const twitter = await client.getEnsText({
  name: normalize('vitalik.eth'),
  key: 'com.twitter',
});

const avatar = await client.getEnsText({
  name: normalize('vitalik.eth'),
  key: 'avatar',
});
```

### Read Multi-Chain Addresses

```typescript
// Get Bitcoin address
const btcAddress = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 0, // Bitcoin
});

// Get Solana address
const solAddress = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 501, // Solana
});

// Get Base address (L2)
const baseAddress = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 2147492101, // Base
});
```

### Get Avatar

```typescript
import { getEnsAvatar } from 'viem/ens';

const avatar = await client.getEnsAvatar({
  name: normalize('vitalik.eth'),
});

console.log(avatar); // URL or data URI
```

**Avatar Resolution Order**:
1. Check `avatar` text record
2. Resolve NFT if format is `eip155:1/erc721:0x...`
3. Resolve HTTP/IPFS URL
4. Return data URI if applicable

---

## TEXT RECORDS

### Standard Global Keys (ENSIP-5)

**Personal Information**:
- `avatar` - Profile picture URL
- `email` - Email address
- `description` - Bio/description
- `display` - Canonical display name (must match name)
- `keywords` - Comma-separated tags
- `location` - Geographic location
- `phone` - E.164 formatted phone
- `url` - Website URL
- `notice` - Important notice
- `mail` - Physical mailing address

**Naming Convention**: lowercase, hyphen-separated

### Service Keys (Extensible)

**Format**: Reverse domain notation (e.g., `com.github`)

**Common Services**:
- `com.github` - GitHub username
- `com.twitter` - Twitter handle
- `com.discord` - Discord username
- `org.telegram` - Telegram handle
- `io.keybase` - Keybase identity

**Custom Services**:
```
com.example.api.key
com.example.groups.private
org.myservice.userid
```

**Rule**: Must contain at least one dot to distinguish from global keys

### Reading Text Records (Viem)

```typescript
// Single record
const github = await client.getEnsText({
  name: normalize('alice.eth'),
  key: 'com.github',
});

// Multiple records in parallel
const [email, twitter, github] = await Promise.all([
  client.getEnsText({ name: normalize('alice.eth'), key: 'email' }),
  client.getEnsText({ name: normalize('alice.eth'), key: 'com.twitter' }),
  client.getEnsText({ name: normalize('alice.eth'), key: 'com.github' }),
]);
```

### Setting Text Records (Requires Ownership)

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const account = privateKeyToAccount('0x...');

const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
});

// Get resolver contract
const resolverAddress = await client.getEnsResolver({
  name: normalize('alice.eth'),
});

// Set text record
const hash = await walletClient.writeContract({
  address: resolverAddress,
  abi: [{
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' }
    ],
    outputs: []
  }],
  functionName: 'setText',
  args: [
    namehash('alice.eth'),
    'com.github',
    'alice-codes'
  ],
});

await client.waitForTransactionReceipt({ hash });
```

---

## MULTI-CHAIN ADDRESSES

### Coin Types (SLIP-0044)

**Major Chains**:
```typescript
const COIN_TYPES = {
  BITCOIN: 0,
  LITECOIN: 2,
  DOGECOIN: 3,
  ETHEREUM: 60,
  SOLANA: 501,
  COSMOS: 118,
  POLKADOT: 354,
};
```

### L2 Coin Types (ENSIP-11)

**Formula**: `0x80000000 | chainId`

```typescript
import { toCoinType } from 'viem/ens';

const baseCoinType = toCoinType(8453); // 2147492101
const arbCoinType = toCoinType(42161); // 2147525809
const opCoinType = toCoinType(10); // 2147483658
```

### Reading Multi-Chain Addresses

```typescript
import { normalize } from 'viem/ens';

// Bitcoin address
const btc = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 0,
});

// Solana address
const sol = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 501,
});

// Base (L2) address
const base = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 2147492101,
});
```

### Setting Multi-Chain Addresses

```typescript
import { namehash } from 'viem/ens';

// Set Bitcoin address
const hash = await walletClient.writeContract({
  address: resolverAddress,
  abi: [{
    name: 'setAddr',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
      { name: 'a', type: 'bytes' }
    ],
    outputs: []
  }],
  functionName: 'setAddr',
  args: [
    namehash('alice.eth'),
    0, // Bitcoin
    '0x...' // Bitcoin address bytes
  ],
});
```

### Address Encoding

**Important**: Non-EVM addresses must be properly encoded

```typescript
import { encodeAddress } from '@ensdomains/address-encoder';

// Encode Bitcoin address
const btcBytes = encodeAddress('BTC', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

// Encode Solana address
const solBytes = encodeAddress('SOL', '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK');
```

---

## COMMON MISTAKES & GOTCHAS

### 1. Not Normalizing Names

❌ **WRONG:**
```typescript
const address = await client.getEnsAddress({
  name: 'ALICE.ETH', // Uppercase
});
```

✅ **CORRECT:**
```typescript
import { normalize } from 'viem/ens';

const address = await client.getEnsAddress({
  name: normalize('ALICE.ETH'), // Normalizes to alice.eth
});
```

**GOTCHA**: ENS names are case-insensitive but must be normalized for on-chain calls. Always use `normalize()`.

### 2. Forgetting to Check for Null

❌ **WRONG:**
```typescript
const address = await client.getEnsAddress({ name: normalize('nonexistent.eth') });
console.log(address.toLowerCase()); // Error: Cannot read toLowerCase of null
```

✅ **CORRECT:**
```typescript
const address = await client.getEnsAddress({ name: normalize('nonexistent.eth') });

if (address) {
  console.log(address.toLowerCase());
} else {
  console.log('Name not registered');
}
```

**GOTCHA**: Returns `null` if name doesn't exist, not an error.

### 3. Wrong Chain for Resolution

❌ **WRONG:**
```typescript
const client = createPublicClient({
  chain: sepolia, // Wrong chain
  transport: http(),
});

// ENS resolution fails on testnet
const address = await client.getEnsAddress({ name: normalize('vitalik.eth') });
```

✅ **CORRECT:**
```typescript
const client = createPublicClient({
  chain: mainnet, // ENS is on mainnet
  transport: http(),
});
```

**GOTCHA**: ENS registry is on Ethereum mainnet. Always use mainnet client for resolution.

### 4. Using Raw Strings Instead of Namehash

❌ **WRONG:**
```typescript
// Direct contract call with raw string
await contract.read.addr(['alice.eth']); // Fails
```

✅ **CORRECT:**
```typescript
import { namehash } from 'viem/ens';

await contract.read.addr([namehash('alice.eth')]);
```

**GOTCHA**: Smart contracts use namehash, not plain strings.

### 5. Assuming Text Records Exist

❌ **WRONG:**
```typescript
const email = await client.getEnsText({ name: normalize('alice.eth'), key: 'email' });
console.log(email.toLowerCase()); // Error if email not set
```

✅ **CORRECT:**
```typescript
const email = await client.getEnsText({ name: normalize('alice.eth'), key: 'email' });

if (email && email.length > 0) {
  console.log(email);
} else {
  console.log('Email not set');
}
```

**GOTCHA**: Returns empty string `""` if record doesn't exist, not `null`.

### 6. Incorrect Coin Type for L2s

❌ **WRONG:**
```typescript
// Using chain ID directly
const baseAddress = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: 8453, // Wrong: This is chain ID, not coin type
});
```

✅ **CORRECT:**
```typescript
import { toCoinType } from 'viem/ens';

const baseAddress = await client.getEnsAddress({
  name: normalize('alice.eth'),
  coinType: toCoinType(8453), // Correct: Convert chain ID to coin type
});
```

**GOTCHA**: L2s use ENSIP-11 coin types, not raw chain IDs. Use `toCoinType()` helper.

### 7. Not Handling Reverse Resolution Absence

❌ **WRONG:**
```typescript
const name = await client.getEnsName({ address: '0x...' });
console.log(`User: ${name.toUpperCase()}`); // Error if no primary name
```

✅ **CORRECT:**
```typescript
const name = await client.getEnsName({ address: '0x...' });

if (name) {
  console.log(`User: ${name}`);
} else {
  console.log('User: 0x...' + address.slice(2, 6));
}
```

**GOTCHA**: Returns `null` if address has no primary name set.

### 8. Mixing Up Node vs Name

❌ **WRONG:**
```typescript
// Passing namehash to viem functions
const address = await client.getEnsAddress({
  name: namehash('alice.eth'), // Wrong: expects normalized string
});
```

✅ **CORRECT:**
```typescript
// Viem handles namehashing internally
const address = await client.getEnsAddress({
  name: normalize('alice.eth'), // Correct: pass normalized string
});
```

**GOTCHA**: Viem's high-level functions expect normalized strings, not namehashes. Only use namehash for direct contract calls.

### 9. Setting Records Without Ownership

❌ **WRONG:**
```typescript
// Try to set record for name you don't own
const hash = await walletClient.writeContract({
  address: resolverAddress,
  functionName: 'setText',
  args: [namehash('vitalik.eth'), 'email', 'fake@email.com']
}); // Transaction reverts
```

✅ **CORRECT:**
```typescript
// Only set records for names you own
const hash = await walletClient.writeContract({
  address: resolverAddress,
  functionName: 'setText',
  args: [namehash('myname.eth'), 'email', 'real@email.com']
});
```

**GOTCHA**: Only the name owner (or approved operator) can set records.

### 10. Not Using Universal Resolver

❌ **WRONG:**
```typescript
// Manually querying registry then resolver
const registry = getContract({ address: ENS_REGISTRY, abi, client });
const resolverAddr = await registry.read.resolver([namehash('alice.eth')]);
const resolver = getContract({ address: resolverAddr, abi, client });
const address = await resolver.read.addr([namehash('alice.eth')]);
```

✅ **CORRECT:**
```typescript
// Viem uses Universal Resolver automatically
const address = await client.getEnsAddress({
  name: normalize('alice.eth'),
});
```

**GOTCHA**: Viem abstracts resolver lookups. No need to query registry manually.

---

## CODE EXAMPLES

### Complete Resolution Example

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

async function resolveENS(name: string) {
  try {
    // Normalize name
    const normalized = normalize(name);

    // Get Ethereum address
    const ethAddress = await client.getEnsAddress({ name: normalized });

    if (!ethAddress) {
      console.log(`${name} is not registered`);
      return;
    }

    // Get text records
    const [email, twitter, github, avatar] = await Promise.all([
      client.getEnsText({ name: normalized, key: 'email' }),
      client.getEnsText({ name: normalized, key: 'com.twitter' }),
      client.getEnsText({ name: normalized, key: 'com.github' }),
      client.getEnsText({ name: normalized, key: 'avatar' }),
    ]);

    // Get multi-chain addresses
    const [btcAddress, solAddress] = await Promise.all([
      client.getEnsAddress({ name: normalized, coinType: 0 }),
      client.getEnsAddress({ name: normalized, coinType: 501 }),
    ]);

    console.log({
      name: normalized,
      addresses: {
        ethereum: ethAddress,
        bitcoin: btcAddress,
        solana: solAddress,
      },
      socials: {
        email,
        twitter,
        github,
      },
      avatar,
    });
  } catch (error) {
    console.error('Resolution failed:', error);
  }
}

resolveENS('vitalik.eth');
```

### Batch Resolution

```typescript
async function resolveBatch(names: string[]) {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const normalized = normalize(name);
        const address = await client.getEnsAddress({ name: normalized });
        return { name: normalized, address, error: null };
      } catch (error) {
        return { name, address: null, error: error.message };
      }
    })
  );

  return results;
}

const names = ['vitalik.eth', 'alice.eth', 'nonexistent.eth'];
const resolved = await resolveBatch(names);
console.log(resolved);
```

### Reverse Resolution with Fallback

```typescript
async function displayName(address: string): Promise<string> {
  const name = await client.getEnsName({ address });

  if (name) {
    return name;
  }

  // Fallback to shortened address
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const display = await displayName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
console.log(display); // "vitalik.eth"
```

### Set Primary Name (Reverse Record)

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const account = privateKeyToAccount(process.env.PRIVATE_KEY);

const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
});

// Address of Reverse Registrar
const REVERSE_REGISTRAR = '0x084b1c3C81545d370f3634392De611CaaBFf8148';

async function setPrimaryName(name: string) {
  const hash = await walletClient.writeContract({
    address: REVERSE_REGISTRAR,
    abi: [{
      name: 'setName',
      type: 'function',
      inputs: [{ name: 'name', type: 'string' }],
      outputs: [{ name: '', type: 'bytes32' }]
    }],
    functionName: 'setName',
    args: [name],
  });

  await client.waitForTransactionReceipt({ hash });
  console.log(`Primary name set to ${name}`);
}

await setPrimaryName('alice.eth');
```

### Update Multiple Text Records

```typescript
async function updateProfile(name: string, updates: Record<string, string>) {
  const normalized = normalize(name);

  // Get resolver
  const resolverAddress = await client.getEnsResolver({ name: normalized });

  if (!resolverAddress) {
    throw new Error('No resolver found');
  }

  // Prepare all setText calls
  const calls = Object.entries(updates).map(([key, value]) => ({
    address: resolverAddress,
    abi: [{
      name: 'setText',
      type: 'function',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'key', type: 'string' },
        { name: 'value', type: 'string' }
      ],
      outputs: []
    }],
    functionName: 'setText',
    args: [namehash(normalized), key, value],
  }));

  // Execute all updates
  const hashes = await Promise.all(
    calls.map(call => walletClient.writeContract(call))
  );

  // Wait for all transactions
  await Promise.all(
    hashes.map(hash => client.waitForTransactionReceipt({ hash }))
  );

  console.log(`Updated ${Object.keys(updates).length} records for ${name}`);
}

await updateProfile('alice.eth', {
  'email': 'alice@example.com',
  'com.twitter': 'alice_codes',
  'com.github': 'alice-dev',
  'url': 'https://alice.dev',
});
```

### Multi-Chain Payment Address Resolver

```typescript
import { toCoinType } from 'viem/ens';

type ChainName = 'ethereum' | 'bitcoin' | 'solana' | 'base' | 'arbitrum' | 'optimism';

const CHAIN_COIN_TYPES: Record<ChainName, number> = {
  ethereum: 60,
  bitcoin: 0,
  solana: 501,
  base: toCoinType(8453),
  arbitrum: toCoinType(42161),
  optimism: toCoinType(10),
};

async function getPaymentAddress(name: string, chain: ChainName): Promise<string | null> {
  const normalized = normalize(name);
  const coinType = CHAIN_COIN_TYPES[chain];

  const address = await client.getEnsAddress({
    name: normalized,
    coinType,
  });

  return address;
}

// Usage
const ethAddr = await getPaymentAddress('alice.eth', 'ethereum');
const btcAddr = await getPaymentAddress('alice.eth', 'bitcoin');
const baseAddr = await getPaymentAddress('alice.eth', 'base');

console.log({ ethAddr, btcAddr, baseAddr });
```

---

## BEST PRACTICES

### 1. Always Normalize Input

```typescript
import { normalize } from 'viem/ens';

// Wrap all user input
function resolveUserInput(input: string) {
  try {
    const normalized = normalize(input);
    return client.getEnsAddress({ name: normalized });
  } catch (error) {
    console.error('Invalid ENS name:', error);
    return null;
  }
}
```

### 2. Cache Resolution Results

```typescript
const cache = new Map<string, { address: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function cachedResolve(name: string): Promise<string | null> {
  const cached = cache.get(name);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.address;
  }

  const address = await client.getEnsAddress({ name: normalize(name) });

  if (address) {
    cache.set(name, { address, timestamp: Date.now() });
  }

  return address;
}
```

### 3. Handle All Null Cases

```typescript
async function safeResolve(name: string) {
  const normalized = normalize(name);
  const address = await client.getEnsAddress({ name: normalized });

  if (!address) {
    throw new Error(`${name} does not resolve to an address`);
  }

  return address;
}
```

### 4. Use Parallel Requests

```typescript
// ✅ Good: Parallel
const [addr, email, twitter] = await Promise.all([
  client.getEnsAddress({ name: normalized }),
  client.getEnsText({ name: normalized, key: 'email' }),
  client.getEnsText({ name: normalized, key: 'com.twitter' }),
]);

// ❌ Bad: Sequential (slower)
const addr = await client.getEnsAddress({ name: normalized });
const email = await client.getEnsText({ name: normalized, key: 'email' });
const twitter = await client.getEnsText({ name: normalized, key: 'com.twitter' });
```

### 5. Implement Retry Logic

```typescript
async function resolveWithRetry(name: string, retries = 3): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      return await client.getEnsAddress({ name: normalize(name) });
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return null;
}
```

### 6. Validate Text Record Keys

```typescript
const VALID_GLOBAL_KEYS = [
  'avatar', 'description', 'display', 'email', 'keywords',
  'location', 'notice', 'phone', 'url', 'mail'
];

function isValidServiceKey(key: string): boolean {
  return key.includes('.') && /^[a-z0-9.-]+$/.test(key);
}

function validateTextKey(key: string): boolean {
  return VALID_GLOBAL_KEYS.includes(key) || isValidServiceKey(key);
}
```

### 7. Use TypeScript for Safety

```typescript
interface ENSProfile {
  name: string;
  address: string;
  email?: string;
  twitter?: string;
  github?: string;
  avatar?: string;
}

async function getProfile(name: string): Promise<ENSProfile | null> {
  const normalized = normalize(name);
  const address = await client.getEnsAddress({ name: normalized });

  if (!address) return null;

  const [email, twitter, github, avatar] = await Promise.all([
    client.getEnsText({ name: normalized, key: 'email' }),
    client.getEnsText({ name: normalized, key: 'com.twitter' }),
    client.getEnsText({ name: normalized, key: 'com.github' }),
    client.getEnsText({ name: normalized, key: 'avatar' }),
  ]);

  return {
    name: normalized,
    address,
    ...(email && { email }),
    ...(twitter && { twitter }),
    ...(github && { github }),
    ...(avatar && { avatar }),
  };
}
```

### 8. Monitor for Changes

```typescript
import { watchContractEvent } from 'viem/actions';

// Watch for address changes
watchContractEvent(client, {
  address: resolverAddress,
  abi: [{
    name: 'AddrChanged',
    type: 'event',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'a', type: 'address' }
    ]
  }],
  eventName: 'AddrChanged',
  onLogs: (logs) => {
    logs.forEach(log => {
      console.log('Address changed:', log.args);
      // Invalidate cache, update UI, etc.
    });
  }
});
```

### 9. Graceful Degradation

```typescript
async function displayUser(address: string) {
  try {
    const name = await client.getEnsName({ address });
    return name || address;
  } catch (error) {
    // Fallback to address on error
    console.warn('ENS lookup failed:', error);
    return address;
  }
}
```

### 10. Use Environment-Specific RPC

```typescript
const RPC_URLS = {
  production: process.env.MAINNET_RPC_URL,
  development: process.env.ALCHEMY_API_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : 'https://cloudflare-eth.com',
};

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URLS[process.env.NODE_ENV || 'development']),
});
```

---

## RESOURCES

### Official Documentation

- **Main Site**: https://ens.domains/
- **Documentation**: https://docs.ens.domains/
- **Protocol Docs**: https://docs.ens.domains/learn/protocol/
- **GitHub**: https://github.com/ensdomains

### ENSIPs (ENS Improvement Proposals)

- **ENSIP-1**: Resolver Interfaces (https://docs.ens.domains/ensip/1)
- **ENSIP-5**: Text Records (https://docs.ens.domains/ensip/5)
- **ENSIP-9**: Multichain Addresses (https://docs.ens.domains/ensip/9)
- **ENSIP-11**: L2 Address Resolution

### Viem Documentation

- **Main Docs**: https://viem.sh/
- **ENS Actions**: https://viem.sh/docs/ens/actions/getEnsAddress
- **ENS Utils**: https://viem.sh/docs/ens/utilities/normalize

### Libraries & Tools

- **viem**: https://viem.sh/ (recommended)
- **@ensdomains/address-encoder**: Multi-chain address encoding
- **ENS Manager App**: https://app.ens.domains/
- **ENS Subgraph**: Query ENS data via GraphQL

### Contract Addresses (Mainnet)

- **ENS Registry**: `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`
- **Public Resolver**: `0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41`
- **Reverse Registrar**: `0x084b1c3C81545d370f3634392De611CaaBFf8148`
- **Universal Resolver**: (used automatically by viem)

---

## VERSION HISTORY

- **February 2026**: Documentation created
- **ENS V2**: Name Wrapper, enhanced features
- **Current Standard**: ENSIPs 1, 5, 9, 11

---

## QUICK REFERENCE

### Common Coin Types

| Blockchain | Coin Type | How to Get |
|------------|-----------|------------|
| Bitcoin | 0 | Direct value |
| Ethereum | 60 | Direct value |
| Solana | 501 | Direct value |
| Base | 2147492101 | `toCoinType(8453)` |
| Arbitrum | 2147525809 | `toCoinType(42161)` |
| Optimism | 2147483658 | `toCoinType(10)` |

### Text Record Keys

| Key | Example Value |
|-----|---------------|
| `email` | `alice@example.com` |
| `avatar` | `https://i.imgur.com/abc.png` |
| `url` | `https://alice.dev` |
| `com.twitter` | `alice_codes` |
| `com.github` | `alice-dev` |
| `com.discord` | `alice#1234` |

### Viem Functions

| Function | Purpose |
|----------|---------|
| `normalize(name)` | Normalize ENS name |
| `namehash(name)` | Convert name to node hash |
| `getEnsAddress({ name })` | Resolve name to address |
| `getEnsName({ address })` | Reverse resolve address |
| `getEnsText({ name, key })` | Get text record |
| `getEnsResolver({ name })` | Get resolver address |
| `getEnsAvatar({ name })` | Get avatar URL |
| `toCoinType(chainId)` | Convert chain ID to coin type |
