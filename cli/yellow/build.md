# Build: Yellow Network Development Guide

## Quick Start: Build Your First Yellow App in 5 Minutes

Create a simple payment application using state channels in just 5 minutes.

### Step 1: Installation

Install the Yellow SDK using your preferred package manager:

```bash
# Using npm
npm install @erc7824/nitrolite

# Using yarn
yarn add @erc7824/nitrolite

# Using pnpm
pnpm add @erc7824/nitrolite
```

### Step 2: Network Connection

Connect to ClearNode using WebSocket endpoints:

**Production:**
```
wss://clearnet.yellow.com/ws
```

**Sandbox (Testing):**
```
wss://clearnet-sandbox.yellow.com/ws
```

### Step 3: Wallet Setup

Integrate MetaMask or compatible wallet to:
- Sign messages
- Manage user accounts
- Control transaction authorization

### Step 4: Define Application Sessions

Configure your app parameters:
- **Participants**: Who can interact in the session
- **Weights**: Voting/approval weights for each participant
- **Quorum**: Minimum agreements required for decisions
- **Assets**: Initial fund allocations

### Step 5: Implement Payments

Send instant payments through:
- Signed messages created by your app
- WebSocket transmission via ClearNode
- Real-time confirmation and settlement

### Step 6: Handle Messages

Process incoming events:
- Transaction confirmations
- State synchronization messages
- Application-level events
- Error and timeout conditions

## Core Features

### Deposits & Withdrawals

- Users deposit funds to create state channels
- Funds managed by smart contracts on-chain
- Instant transfers within channels
- Withdrawal to original wallet

### Instant Transfers

Between channel participants:
- Signed by both parties
- Off-chain processing
- Immediate settlement
- No blockchain confirmation needed

### Cross-Chain Settlements

Yellow enables:
- Multi-chain interactions
- Asset bridging
- Atomic settlements
- Interoperable applications

## Requirements

- **Node.js**: Version 16 or higher
- **Crypto Wallet**: MetaMask or EVM-compatible wallet
- **Proficiency**: Basic JavaScript/TypeScript knowledge
- **Development Environment**: Any code editor (VS Code recommended)

## What You Build

A complete payment application with:
- User authentication via wallet
- Deposit functionality
- Instant peer-to-peer transfers
- Withdrawal mechanisms
- Real-time transaction status

## Project Structure

Typical Yellow app structure:

```
your-app/
├── src/
│   ├── index.ts              # Application entry point
│   ├── channels.ts           # State channel management
│   ├── payments.ts           # Payment logic
│   └── wallet.ts             # Wallet integration
├── package.json
└── tsconfig.json
```

## Development Workflow

1. **Initialize Project**: Set up Node.js and install dependencies
2. **Connect to Network**: Establish WebSocket connection to ClearNode
3. **Create Session**: Define application session with participants
4. **Implement Logic**: Build payment flows with signed messages
5. **Test Locally**: Use sandbox endpoints for testing
6. **Deploy**: Move to production endpoints when ready

## Best Practices

- Always use sandbox environment for testing
- Implement proper error handling for network failures
- Store private keys securely
- Validate message signatures
- Handle timeout scenarios gracefully
- Test multi-party interactions thoroughly

## Advanced Topics

- **Session Key Management**: For gasless user interactions
- **Multi-Party Applications**: Complex governance structures
- **Performance Optimization**: Scaling to thousands of participants
- **Security Considerations**: Private key management and message validation

## Next Steps

- Explore advanced build guides in [Guides](./guides.md)
- Review protocol details in [Protocol](./protocol.md)
- Check out migrations and version updates in [Guides](./guides.md#migration-guide)
- Join community on Discord for support
