# Learn: Yellow Network Fundamentals

## Introduction

### What Yellow Solves

Yellow Network addresses three critical blockchain challenges:

1. **Scaling** - Handles high-frequency applications through off-chain interactions
2. **Cost** - Reduces transaction fees by minimizing on-chain operations
3. **Speed** - Enables instant cross-chain settlements

### Architecture at a Glance

Yellow's architecture operates across three protocol layers:

- **On-Chain Layer**: Blockchain smart contracts managing custody and dispute resolution
- **Off-Chain Layer**: Nitrolite RPC protocol for rapid state synchronization
- **Application Layer**: Custom business logic built by developers

## Getting Started

### Prerequisites & Environment Setup

Required tools and dependencies:
- **Node.js 16+**
- **TypeScript** support
- **Nitrolite SDK** (`@erc7824/nitrolite` package)
- **Compatible Wallet**: MetaMask or similar EVM wallet

### Quickstart: Your First Channel

The quickstart guides you through:
1. Creating a state channel
2. Performing off-chain transfers
3. Managing channel state
4. Settling to blockchain

### Key Terms & Mental Models

Essential vocabulary for Yellow development:

- **State Channel**: Off-chain mechanism enabling instant transactions between participants
- **Application Session**: Multi-party channels with custom governance and rules
- **Session Keys**: Delegated keys for gasless interactions
- **Message Envelope**: Nitro RPC protocol format for peer-to-peer communication
- **Challenge-Response**: Dispute resolution mechanism for fund recovery

## Core Concepts

### State Channels vs L1/L2

**State Channels:**
- Off-chain, bilateral/multi-party
- Instant settlement
- Custom business logic
- Lower security risk per transaction

**Layer 1:**
- On-chain, fully verified
- Global state
- Higher cost and latency

**Layer 2:**
- Rollup/sidechain based
- Faster than L1, slower than state channels
- General-purpose computation

### App Sessions

Multi-party application channels supporting:
- Custom participant structures
- Configurable governance rules
- Asset allocation and quorum settings
- Flexible business logic implementation

### Session Keys

Session keys enable:
- Delegated signing authority
- Gasless interactions
- User-friendly applications
- Secure key management practices

### Challenge-Response & Disputes

Dispute handling mechanisms:
- Participants can challenge invalid states
- On-chain verification of off-chain states
- Fund recovery guarantees
- Blockchain finality for settlement

## Advanced Topics

### Managing Session Keys

Specialized techniques for:
- Generating and storing session keys securely
- Key rotation strategies
- Access control and delegation
- Recovery procedures

### Message Envelope (RPC Protocol)

Nitrolite RPC message format specifications:
- Message structure and encoding
- Peer-to-peer communication
- State synchronization protocol
- Error handling and retries

## Learning Path

Topics range from 5-12 minutes each:

| Topic | Difficulty | Duration |
|-------|-----------|----------|
| What Yellow Solves | Beginner | 5 min |
| Architecture at a Glance | Beginner | 7 min |
| State Channels vs L1/L2 | Intermediate | 10 min |
| App Sessions | Intermediate | 8 min |
| Session Keys | Intermediate | 9 min |
| Challenge-Response | Advanced | 12 min |
| Managing Session Keys | Advanced | 10 min |

## Key Takeaways

- State channels enable instant, low-cost transactions
- Yellow provides three-layer architecture for scalability
- Application sessions support multi-party scenarios
- Security is maintained through on-chain dispute resolution
- Session keys enable better user experience with gasless interactions
