# Yellow Network Documentation - LLM Optimized

**Last Updated**: February 2026
**Source**: https://docs.yellow.org/docs/learn/
**Protocol Version**: Nitrolite 0.5.0 | Nitro RPC 0.4

---

## EXECUTIVE SUMMARY

Yellow Network is a state channel-based scaling solution for blockchain applications. It enables:
- **Sub-second transaction finality** (< 1 second vs 1-15 seconds on L1)
- **Zero gas costs** for off-chain operations
- **Unlimited throughput** for high-frequency interactions among known participants
- **Cross-chain unified balances** via Clearnode coordination

Core mechanic: Lock funds in smart contracts, exchange cryptographically signed states off-chain, settle disputes on-chain if needed.

---

## TABLE OF CONTENTS

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Core Concepts](#core-concepts)
4. [Getting Started](#getting-started)
5. [Protocol Components](#protocol-components)
6. [Security Model](#security-model)
7. [Advanced Topics](#advanced-topics)

---

## PROBLEM STATEMENT

### Blockchain Scalability Challenges

**Layer 1 Limitations:**
- Latency: 15 seconds to minutes per transaction
- Throughput: 15-30 TPS (Ethereum)
- Cost: $0.001-$50 per transaction during congestion

**Layer 2 Improvements (Rollups):**
- Throughput: 2,000-4,000 TPS
- Latency: 1-10 seconds
- Cost: $0.01-$0.50 per transaction
- Trade-off: Inherits L1 bottleneck for settlement

**State Channels Advantages:**
- Throughput: Unlimited (depends on signature generation speed)
- Latency: < 1 second
- Cost: $0 for off-chain operations
- Trade-off: Requires known participants and upfront liquidity

### Yellow Network's Solution

Yellow Network uses **state channels** with **two innovations**:

1. **Nitrolite Protocol**: On-chain custody, dispute resolution, and settlement
2. **Clearnode**: Off-chain coordination layer managing unified balances across chains

Real-world analogy: Bar tab model
- Instead of paying per transaction, open a channel (tab)
- Execute unlimited transactions off-chain (order drinks)
- Settle once at the end (pay tab on-chain)

**Example**: Chess game between Alice and Bob
- On-chain: 40+ transactions, hundreds in fees
- State channels: 2 on-chain transactions (open/close), minimal fees

---

## ARCHITECTURE OVERVIEW

### Three-Layer Stack

```
┌─────────────────────────────────────────┐
│ Application Layer                       │
│ (Business logic, User interface)        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Off-Chain Layer (Clearnode)             │
│ • Nitro RPC Protocol                    │
│ • Unified Balance Management            │
│ • State Channel Coordination             │
│ • App Session Hosting                   │
│ Performance: < 1 sec, $0 cost           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ On-Chain Layer (Nitrolite)              │
│ • Custody Contract (fund management)    │
│ • Adjudicator Contracts (validation)    │
│ • Dispute Resolution                    │
│ • Final Settlement                      │
│ Performance: Block time, gas fees       │
└─────────────────────────────────────────┘
```

### Component Roles

**On-Chain Contracts:**
- **Custody Contract**: Main entry point
  - Creates and manages channels
  - Locks/unlocks funds
  - Handles disputes
  - Distributes final settlements

- **Adjudicator Contracts**: Validate state transitions
  - SimpleConsensus: Both parties must sign
  - Remittance: Only sender signature required
  - Custom: Application-defined validation logic

**Off-Chain Services:**
- **Clearnode**: Central coordination service
  - Manages Nitro RPC protocol
  - Maintains unified balances across chains
  - Coordinates payment channels
  - Hosts multi-party app sessions
  - Monitors for disputes and enforces rules

- **Nitro RPC Protocol**: Compact communication format
  - 30% smaller than standard JSON-RPC
  - Cryptographically signed messages
  - Bidirectional WebSocket communication
  - Message format: `[requestId, method, params, timestamp]`

### Fund Flow

User Wallet → Available Balance → Channel-Locked → Unified Balance → App Session

1. **Deposit**: Transfer tokens from wallet to Unified Balance
2. **Create Channel**: Lock funds in on-chain Custody Contract
3. **Off-Chain Operations**: Exchange unlimited signed states
4. **Close Channel**: Both parties sign final state
5. **Withdraw**: Settle on-chain, transfer back to wallet

---

## CORE CONCEPTS

### 1. State Channels

**Definition**: A secure pathway for exchanging cryptographically signed states between participants without blockchain involvement.

**Mechanics**:
1. Lock funds in smart contract (on-chain)
2. Exchange signed states between participants (off-chain)
3. Settle upon completion or disputes (on-chain)

**Key Properties**:
- Funds secured by smart contract
- All operations require cryptographic signatures
- Only opening/closing require on-chain transactions
- Privacy: Off-chain activity not publicly visible
- Trustless: No intermediary required

**Limitations** (addressed by Yellow):
- Require known participants beforehand
- Need upfront locked liquidity
- Demand participant liveness
- Require monitoring for disputes

### 2. Channel Lifecycle

**Channel States**:
- VOID: Non-existent
- INITIAL: Created but not yet active
- ACTIVE: Operational (participants exchanging states)
- DISPUTE: Challenge in progress
- FINAL: Closed and funds distributed

**Channel Creation**:
- Requires mutual signatures from both participants
- On-chain: Custody contract creates channel with participants, adjudicator, and challenge window
- Channel ID: Computed deterministically from parameters (deterministic, not random)

**Channel Parameters**:
- Participants: Wallet addresses
- Adjudicator Contract: Defines validation rules
- Challenge Window: Time period for disputes (typically 86400 seconds = 24 hours)
- Nonce: Unique identifier per channel pair

**Closing Process**:
1. Both parties sign final state (cooperative close)
2. Submit final state on-chain
3. Custody contract validates signatures
4. Distribute funds to recipients
5. Channel transitions to FINAL state

### 3. States

**Definition**: A snapshot of channel conditions with cryptographic proof of validity.

**State Structure**:
- Intent: INITIALIZE | OPERATE | RESIZE | FINALIZE
- Version: Incrementing counter (higher version supersedes lower)
- Application Data: Custom logic data
- Allocations: Fund distributions to recipients
- Signatures: Cryptographic signatures from all required participants

**State Ordering**:
- Version numbers ensure causality
- Higher version numbers always supersede lower versions
- Only newest valid state matters for settlement
- All states must be cryptographically signed

### 4. Allocations

**Definition**: Specifies how funds are distributed at state settlement.

**Allocation Properties**:
- Destination Address: Where funds go
- Token Contract: Which token (address)
- Amount: In smallest units (e.g., wei for Ethereum)

**Example**:
```json
{
  "allocations": [
    { "destination": "0xAlice", "token": "0xUSDC", "amount": "100000000" },
    { "destination": "0xBob", "token": "0xUSDC", "amount": "100000000" }
  ]
}
```

### 5. Clearnode

**Definition**: Off-chain service managing protocol operations and unified balances.

**Core Functions**:
- Manages Nitro RPC protocol communication
- Maintains unified balance aggregation across chains
- Coordinates state channel lifecycle
- Hosts multi-party app sessions
- Provides always-on dispute monitoring

**Unified Balance**:
- Aggregates deposits across all supported chains
- Enables instant cross-chain transfers
- Single point of access for all chains
- Allows withdrawals to any supported chain
- No re-bridging required

### 6. Unified Balance

**Definition**: Aggregated funds across all chains accessible through Clearnode.

**Key Benefits**:
- Deposit on any chain, withdraw from any chain
- Instant cross-chain transfers (no bridge delay)
- Single balance view across networks
- Efficient capital utilization

**Supported Operations**:
- Deposit: Chain-specific → Unified Balance
- Transfer: Between users within Unified Balance
- Allocate: Unified Balance → Channel
- Withdraw: Unified Balance → Any supported chain

### 7. App Sessions

**Definition**: Temporary multi-party channels where participants lock funds, execute application logic, and redistribute assets based on outcomes.

**Comparison to Payment Channels**:
- Payment channels: 2 participants, mutual consent for all changes
- App sessions: Multiple participants, flexible governance
- App sessions source funds from Unified Balance
- App sessions support intents for mid-session modifications

**Session Parameters**:
- Protocol Version: NitroRPC/0.4 (current standard)
- Participants: Wallet addresses with voting weights
- Quorum Threshold: Minimum voting weight required for decisions
- Challenge Window: Dispute resolution timeframe
- Nonce: Unique session identifier

**Intent Types** (NitroRPC/0.4):
- OPERATE: Reallocate existing funds
- DEPOSIT: Add funds from Unified Balance
- WITHDRAW: Remove funds to Unified Balance

**Governance Models**:
- Unanimous: Both participants must sign (2-of-2)
- Trusted Judge: Judge + any participant (1-of-2 judge, 1-of-1 judge)
- Multi-sig: N-of-M participants
- Weighted Voting: Participants with voting weights

**Example - Weighted Governance**:
Participants: Alice (40), Bob (40), Judge (50)
Quorum: 80

Valid combinations:
- Alice + Bob (80) ✓
- Alice + Judge (90) ✓
- Bob + Judge (90) ✓
- Any single participant (40-50) ✗

### 8. Session Keys

**Definition**: Delegated credentials allowing gasless operations with predefined limits and expiration.

**Purpose**:
- Eliminate repeated wallet signature requests
- Enable high-frequency operations (gaming, trading)
- Provide controlled spending authority
- Reduce user friction

**Key Properties**:
- One active key per wallet-application pair
- Associated with specific application
- Must have future-dated expiration timestamp
- Cannot be reactivated after expiration
- Requires new key generation for new session

**Configuration Options**:
```json
{
  "wallet": "0xUser",
  "sessionKey": "0xKey",
  "appName": "myapp",
  "expiresAt": 1735689600,
  "allowances": [
    { "asset": "usdc", "amount": "100.0" },
    { "asset": "eth", "amount": "0.5" }
  ]
}
```

**Special Application: "clearnode"**:
- Bypasses spending restrictions
- Ignores allowance enforcement
- Provides root access
- Still respects expiration timestamps
- Only for trusted operations

**Security Recommendations**:
- Set reasonable spending limits
- Use 24-hour expiration windows
- Isolate keys per application
- Monitor spending regularly
- Revoke unused sessions
- Encrypt stored keys
- Never transmit private keys
- Handle expiration gracefully

### 9. Challenge-Response & Disputes

**Core Principle**: "Anyone can submit a state to the blockchain. Counterparties have time to respond with a newer state. The newest valid state always wins."

**Trust Model Guarantees**:
1. Smart contracts hold funds directly (not intermediaries)
2. Only cryptographically signed states accepted
3. Disagreements resolve via blockchain fallback
4. Users can always retrieve funds based on latest mutually-signed state

**Dispute Resolution Process**:

**Trigger**: Clearing node becomes unresponsive or dishonest

**Steps**:
1. Initiator submits latest signed state on-chain via `challenge()` call
2. Challenge timer activates (minimum 1 hour, typically 24 hours)
3. Counterparty can submit newer state with higher version number
4. Smart contract compares state versions
5. After timeout expires, latest submitted state becomes final
6. Funds distributed according to final state allocations

**Operations**:
- `checkpoint()`: Record state safely without triggering disputes
- `challenge()`: Force on-chain settlement when needed

**Why This Works**:
- State Ordering: Version numbers prevent replaying old states
- Cryptographic Signing: Both parties must sign, preventing later denial
- Challenge Period: Fair response time regardless of network delays
- Neutral Arbitration: Smart contracts apply rules uniformly

### 10. Message Envelope (Nitro RPC)

**Definition**: Lightweight protocol for state channel communication (~30% more compact than JSON-RPC).

**Request Format**:
```json
{
  "req": [requestId, method, params, timestamp],
  "sig": "0x65byteECDSASignature"
}
```

**Response Format**:
```json
{
  "res": [requestId, method, result, timestamp],
  "sig": "0x65byteECDSASignature"
}
```

**Error Response Format**:
```json
{
  "res": [requestId, method, errorDescription, timestamp],
  "sig": "0x65byteECDSASignature"
}
```

**Authentication**:
- ECDSA signatures (65 bytes: r + s + v)
- Represented as 0x-prefixed hex strings
- Requests signed by session key or main wallet
- Responses signed by Clearnode

**Method Categories**:
1. Auth: Session key management, authentication challenges
2. Channels: Create, update, close payment channels
3. Transfers: Send tokens between participants
4. App Sessions: Create, manage multi-party sessions
5. Queries: Get config, balances, session state

**Real-Time Notifications**:
- `bu`: Balance update
- `cu`: Channel change
- `tr`: Transfer
- `asu`: App session update

**Current Standard**: Always use NitroRPC/0.4 for new implementations

---

## GETTING STARTED

### Prerequisites & Environment

**System Requirements**:
- Node.js: 18.x minimum, 20.x+ recommended
- Package Manager: npm, yarn, or pnpm (latest stable)
- OS: macOS/Linux recommended, Windows supported
- Knowledge: JavaScript/TypeScript, async programming, basic Web3 concepts, ERC-20

**Installation Steps**:

1. **Install Node.js** (if not already installed)
   ```bash
   # macOS with Homebrew
   brew install node@20

   # Linux (Ubuntu/Debian)
   sudo apt-get install nodejs npm

   # Windows
   # Download from nodejs.org
   ```

2. **Install Dependencies**
   ```bash
   npm install @erc7824/nitrolite viem typescript tsx
   ```

3. **Configure TypeScript** (`tsconfig.json`)
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "lib": ["ES2022"],
       "moduleResolution": "node"
     }
   }
   ```

4. **Create `.env` File**
   ```bash
   PRIVATE_KEY=0x...         # Development wallet private key
   SEPOLIA_RPC=https://...   # Sepolia testnet RPC
   BASE_SEPOLIA_RPC=https://... # Base Sepolia RPC
   CLEARNODE_WS=wss://...    # Clearnode WebSocket URL
   ```

5. **Set Up Development Wallet**
   ```typescript
   import { privateKeyToAccount } from 'viem/accounts';
   const account = privateKeyToAccount('0x...');
   ```

6. **Verify Setup**
   ```bash
   # Run verification script to confirm:
   # - Wallet loads successfully
   # - Network connection works
   # - Balance retrieval functions
   ```

### Getting Funds

**For Sandbox Testing**:
1. Use Yellow Network Sandbox Faucet (recommended)
2. Submit POST request to clearing network endpoint
3. Include wallet address in request body
4. Receive `ytest.usd` tokens in off-chain Unified Balance

**For Testnet Testing**:
- Sepolia faucet (for on-chain testing)
- Base Sepolia faucet (for multi-chain scenarios)

### Quick Start Flow

1. **Initialize Client**
   ```
   Create Viem clients for network interactions
   Instantiate NitroliteClient with contract addresses
   Connect to Clearnode WebSocket endpoint
   ```

2. **Authentication**
   ```
   Generate temporary session key (EIP-712 signed)
   Respond to auth challenge from Node
   Verify signature with main wallet
   Establish secure session
   ```

3. **Create Channel**
   ```
   Request channel creation via Clearnode
   Receive unsigned state + server signature
   Submit on-chain for channel establishment
   Wait for confirmation
   ```

4. **Fund Channel**
   ```
   IMPORTANT: Use allocate_amount (NOT resize_amount)
   Common error: Using wrong funding method causes "InsufficientBalance"
   Verify balance updates after allocation
   ```

5. **Exchange States**
   ```
   Send signed state updates off-chain
   Receive updates from counterparty
   Verify cryptographic signatures
   Process state changes (payments, data)
   ```

6. **Close Channel**
   ```
   Cooperatively sign final state
   Both parties agree on final allocations
   Submit final state on-chain
   Wait for settlement
   Withdraw funds to main wallet
   ```

### Common Errors & Solutions

**InsufficientBalance Error**:
- Cause: Using `resize_amount` instead of `allocate_amount`
- Solution: Use correct funding method for channel

**Double-Submission**:
- Cause: Submitting same request multiple times
- Solution: Implement idempotency checks

**State Mismatch**:
- Cause: Versions getting out of sync
- Solution: Verify version numbers match expected sequence

**Channel Accumulation**:
- Cause: Creating many channels without closing
- Solution: Implement cleanup script to close old channels

### Project Structure

```
project/
├── src/
│   ├── index.ts           # Main application logic
│   └── types.ts           # TypeScript interfaces
├── scripts/
│   ├── close_all.ts       # Channel cleanup utility
│   └── verify.ts          # Setup verification
├── .env                   # Environment variables (git-ignored)
├── tsconfig.json          # TypeScript configuration
└── package.json           # Dependencies
```

---

## PROTOCOL COMPONENTS

### Nitrolite (On-Chain)

**Version**: 0.5.0

**Core Contracts**:

1. **Custody Contract**
   - Main entry point for channel operations
   - Fund locking and unlocking
   - Channel state management
   - Dispute resolution triggering
   - Final settlement and fund distribution

2. **Adjudicator Contracts**
   - Validate state transitions
   - Types:
     - SimpleConsensus: Both participants must sign
     - Remittance: Only sender signature required
     - Custom: Application-defined logic

**Supported Networks**:
- Sepolia (primary testnet)
- Base Sepolia (multi-chain scenario)
- Mainnet support: Query via `get_config` endpoint

**Key Operations**:
- Channel creation: On-chain registration of participants
- Channel resizing: Adjust locked amounts
- State disputes: Submit challenge, wait challenge period
- Settlement: Distribute funds per final state

### Nitro RPC (Off-Chain)

**Version**: 0.4

**Protocol Characteristics**:
- Message Format: Compact JSON arrays (30% smaller than JSON-RPC)
- Transport: WebSocket (bidirectional, real-time)
- Security: ECDSA signatures on all messages
- Latency: Sub-second message delivery

**Message Structure**:
- Array-based format: `[requestId, method, params, timestamp]`
- Cryptographic signatures: 65-byte ECDSA (r + s + v)
- Request/Response pairs: Matched by requestId

**Method Categories**:

**1. Auth Methods**:
- `auth_request`: Register session key with configuration
- `auth_challenge`: Respond to authentication challenge
- Session key management and validation

**2. Channel Methods**:
- `propose_channel`: Initiate channel creation
- `update_state`: Exchange state updates
- `close_channel`: Cooperatively close channel
- `resign`: Resign from channel state

**3. Transfer Methods**:
- `propose_transfer`: Initiate payment
- `accept_transfer`: Accept incoming payment
- Multi-recipient support

**4. App Session Methods**:
- `create_app_session`: Initiate multi-party session
- `propose_intent`: Propose state change (OPERATE/DEPOSIT/WITHDRAW)
- `join_session`: Participant joins session
- `leave_session`: Participant leaves session

**5. Query Methods**:
- `get_config`: Retrieve network configuration (supported chains, contracts)
- `get_balance`: Query unified balance
- `get_channel_state`: Get current channel state
- `get_session_keys`: List active session keys

**Notification Format**:
- Abbreviated codes for real-time updates
- `bu`: Balance update notification
- `cu`: Channel update notification
- `tr`: Transfer notification
- `asu`: App session update notification

**Configuration Query** (`get_config`):
- Returns supported chains
- Lists custody contract addresses per chain
- Provides adjudicator contract addresses
- Includes Clearnode service endpoints

---

## SECURITY MODEL

### Fund Safety Guarantees

**1. Smart Contract Custody**:
- Funds locked in Custody Contract (not Clearnode)
- Only smart contract can release funds
- No intermediary access to private keys

**2. Cryptographic Signatures**:
- All state updates require participant signatures
- ECDSA signatures (industry standard)
- Signature verification on-chain and off-chain
- Prevents tampering and impersonation

**3. Deterministic Channel IDs**:
- Channel ID computed from: participants, adjudicator, challenge window, nonce
- Cannot be spoofed or replayed
- Same parameters always produce same channel ID

**4. Challenge-Response Disputes**:
- Anyone can force on-chain settlement
- Challenge period provides response time (min 1 hour, typical 24 hours)
- Newest state (highest version) always wins
- No disputes can override cryptographically signed states

**5. Always-On Monitoring**:
- Clearnode monitors for disputes
- Counterparties can submit newer states
- If Clearnode goes offline: Users can submit states directly
- Challenge window ensures fair resolution time

### Session Key Security

**Threat Model**:
- Session key is stolen: Limited to spending cap and application
- Clearnode operator is dishonest: Users can exit via challenge
- Network is compromised: Signatures prevent tampering

**Mitigation**:
- Spending caps limit loss from key compromise
- Application isolation restricts where key works
- Expiration windows limit key lifetime
- Users can always challenge and recover funds on-chain

### No Single Points of Failure

**Clearnode Offline**:
- Users can still challenge with latest state
- Users can still close channels cooperatively (with both signatures)
- Dispute period ensures fair response time

**Counterparty Offline**:
- User can unilaterally submit state for challenge
- Challenge period waits for response
- After timeout, user's state becomes final

**Clearnode Dishonest**:
- Cannot steal funds (locked in smart contract)
- Challenge mechanism protects users
- Latest signed state always wins

---

## ADVANCED TOPICS

### Managing Session Keys

**Create Session Key**:
```
Method: auth_request
Required: wallet, sessionKey, expiresAt
Optional: appName, allowances, permissions
```

**Key Validation Rules**:
- Expiration must be future-dated
- Only one key active per wallet-application pair
- Cannot reactivate expired key (must create new)
- All fields must be filled even for already-registered keys

**List Active Session Keys**:
```
Method: get_session_keys
Response:
  - Unique session key identifier
  - Application authorization name
  - Allowance details with usage tracking
  - Creation and expiration timestamps (ISO 8601)
```

**Revoke Session Key**:
```
Method: revoke_session_key
Permission Rules:
  - Wallets can revoke their own keys
  - Session keys can revoke themselves
  - "clearnode" keys can revoke other wallet keys
  - Non-clearnode keys cannot revoke others
```

**Important Note**:
- Post-v0.5.0 channels use wallet addresses directly
- Backward compatibility maintained for older channels
- Session keys optional for payment channels
- Required for app sessions with spending limits

### Comparison: State Channels vs L1/L2

| Metric | L1 | L2 | State Channels |
|--------|----|----|----------------|
| **Throughput** | 15-65K TPS | 2,000-4,000 TPS | Unlimited* |
| **Latency** | 1-15 sec | 1-10 sec | < 1 sec |
| **Cost** | $0.001-$50 | $0.01-$0.50 | $0 |
| **Settlement** | Consensus-based | Batched rollups | Immediate |
| **Participants** | Any | Any | Known/predetermined |
| **Liquidity Required** | None | None | Upfront lock |
| **Best Use Case** | Settlement, contracts | General dApps | High-frequency interactions |

*Theoretical limit: depends on signature generation speed and network latency

**Trade-offs by Solution**:

**L1**:
- Pros: Permissionless, no participant requirements, universal settlement
- Cons: High latency, high cost, limited throughput

**L2 (Rollups)**:
- Pros: Better throughput than L1, lower cost, permissionless
- Cons: Still subject to L1 confirmation, higher than state channels

**State Channels**:
- Pros: Unlimited throughput, instant finality, zero cost
- Cons: Requires known participants, upfront liquidity, liveness requirements

**Yellow Network Advantages**:
- Addresses participant requirement via Clearnode coordination
- Solves liquidity via Unified Balance across chains
- Always-on Clearnode monitoring ensures liveness

### Use Cases

**Ideal for State Channels**:
1. **High-Frequency Trading**: Thousands of trades with low latency
2. **Streaming Payments**: Continuous micropayments or salary disbursement
3. **Gaming with Wagers**: Real-time multiplayer with financial stakes
4. **Prediction Markets**: High-volume trading with fast settlement
5. **NFT Marketplaces**: Rapid trading between known parties

**Not Ideal**:
- Public, permissionless operations (users must be pre-registered)
- Large payments that exceed locked channel capacity
- Operations requiring immediate on-chain finality for regulatory reasons

---

## PROTOCOL COMPARISON

### State Channels vs Traditional Payment Channels

**Payment Channels** (e.g., Lightning):
- 2 participants only
- Mutual consent for all changes
- Limited to payment operations
- Requires recipient online for payments

**Yellow App Sessions**:
- Multiple participants (2+)
- Flexible governance via quorum
- Supports custom application logic
- Participants can be online or offline (quorum decides)

### Nitrolite vs Other Protocols

**Nitrolite v0.5.0 Features**:
- Post-v0.5.0 uses wallet addresses (not session keys) for direct channel access
- SimpleConsensus adjudicator for standard 2-party channels
- Remittance adjudicator for asymmetric operations
- Extensible adjudicator system for custom logic

**Nitro RPC v0.4 Features**:
- Intent-based system (OPERATE, DEPOSIT, WITHDRAW)
- Compact message format (~30% smaller)
- Bidirectional WebSocket support
- Cryptographically signed requests and responses

---

## API REFERENCE SUMMARY

### Core Methods

**Channel Operations**:
- `propose_channel(params)`: Create new channel
- `update_state(state)`: Exchange state update
- `close_channel(finalState)`: Close channel cooperatively
- `challenge(state)`: Force on-chain settlement

**Balance Management**:
- `get_balance()`: Query unified balance
- `allocate_amount(amount)`: Move funds to channel
- `transfer(recipient, amount)`: Send to another user

**Session Management**:
- `auth_request(config)`: Register session key
- `get_session_keys()`: List active keys
- `revoke_session_key(keyId)`: Invalidate key

**App Sessions**:
- `create_app_session(params)`: Start multi-party session
- `propose_intent(intent)`: Request state change
- `join_session(sessionId)`: Participant joins
- `leave_session(sessionId)`: Participant leaves

**Queries**:
- `get_config()`: Retrieve network configuration
- `get_channel_state(channelId)`: Get current state
- `get_session_keys()`: List session keys

---

## KEY TAKEAWAYS

1. **State Channels Enable Sub-Second Finality**: Off-chain operations with on-chain security guarantees

2. **Clearnode Solves Coordination**: Unified balances across chains, always-on monitoring, dispute prevention

3. **Cryptography Ensures Trustlessness**: ECDSA signatures, challenge-response disputes, no intermediaries

4. **Flexible Governance**: From 2-party payment channels to multi-party app sessions with custom quorum

5. **Session Keys Enable UX**: Gasless operations with spending limits and expiration

6. **Challenge-Response Protects Users**: Anyone can force settlement, newest state always wins, funds locked in contracts

7. **Zero Gas for Off-Chain Operations**: Only channel open/close/disputes require on-chain transactions

8. **Security Model**: Smart contracts hold funds, signatures prevent tampering, disputes resolve fairly

---

## RESOURCES & DOCUMENTATION LINKS

### Official Documentation

**Learn Section** (Core Concepts):
- [Learn Overview](https://docs.yellow.org/docs/learn/)
- [What Yellow Solves](https://docs.yellow.org/docs/learn/introduction/what-yellow-solves)
- [Architecture at a Glance](https://docs.yellow.org/docs/learn/introduction/architecture-at-a-glance)

**Getting Started**:
- [Quickstart Guide](https://docs.yellow.org/docs/learn/getting-started/quickstart)
- [Prerequisites & Environment](https://docs.yellow.org/docs/learn/getting-started/prerequisites)
- [Key Terms & Mental Models](https://docs.yellow.org/docs/learn/getting-started/key-terms)

**Core Concepts**:
- [State Channels vs L1/L2](https://docs.yellow.org/docs/learn/core-concepts/state-channels-vs-l1-l2)
- [App Sessions](https://docs.yellow.org/docs/learn/core-concepts/app-sessions)
- [Session Keys](https://docs.yellow.org/docs/learn/core-concepts/session-keys)
- [Challenge-Response & Disputes](https://docs.yellow.org/docs/learn/core-concepts/challenge-response)
- [Message Envelope (RPC Protocol)](https://docs.yellow.org/docs/learn/core-concepts/message-envelope)

**Advanced Topics**:
- [Managing Session Keys](https://docs.yellow.org/docs/learn/advanced/managing-session-keys)

**Additional Resources**:
- [Build Documentation](https://docs.yellow.org/docs/build/quick-start/)
- [Protocol Documentation](https://docs.yellow.org/docs/protocol/introduction)
- [Manuals](https://docs.yellow.org/docs/manuals/)
- [Guides](https://docs.yellow.org/docs/guides/)
- [Whitepaper](https://docs.yellow.org/whitepaper)

### Community & Development

- **GitHub Repository**: https://github.com/layer-3
- **Discord Community**: https://discord.com/invite/yellownetwork
- **Twitter/X**: https://x.com/YellowCom_News

---

## VERSION HISTORY

- **February 2026**: Initial LLM-optimized documentation created
- **Based on**: Yellow Network Learn Docs (https://docs.yellow.org/docs/learn/)
- **Protocol Versions**: Nitrolite 0.5.0, Nitro RPC 0.4
