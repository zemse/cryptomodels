# Relay Service

A relay service enabling two parties to communicate without direct IP exposure via inbox-based key exchange and WebSocket forwarding.

## Features

- **Inbox System**: Create inboxes identified by Ethereum addresses
- **Signature-Based Auth**: EIP-191 personal_sign with time-based OTP
- **WebSocket Relay**: Connect via shared ECDH hash for secure communication
- **Zero IP Exposure**: Parties never connect directly

## Quick Start

```bash
# Install dependencies
bun install

# Start server
bun run dev

# Run tests
bun test
```

Server runs on `http://localhost:4000` by default.

## How It Works

### 1. Key Exchange Flow

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ Party A │                    │  Relay  │                    │ Party B │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │  POST /inbox (create)        │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │  (share inbox address)       │                              │
     │──────────────────────────────┼─────────────────────────────>│
     │                              │                              │
     │                              │    GET /inbox/:addr          │
     │                              │<─────────────────────────────│
     │                              │  (A's pubkey)                │
     │                              │─────────────────────────────>│
     │                              │                              │
     │                              │   POST /inbox/:addr          │
     │                              │<─────────────────────────────│
     │                              │  (B's pubkey)                │
     │                              │                              │
     │  GET /inbox/:addr/messages   │                              │
     │─────────────────────────────>│                              │
     │  (B's pubkey)                │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

### 2. WebSocket Connection

Both parties compute: `dhHash = keccak256(ECDH(myPrivKey, theirPubKey))`

Since ECDH is symmetric, both get the same hash. They connect to `/socket/:dhHash`.

```
┌─────────┐              ┌─────────┐              ┌─────────┐
│ Party A │              │  Relay  │              │ Party B │
└────┬────┘              └────┬────┘              └────┬────┘
     │                        │                        │
     │  WS /socket/:dhHash    │                        │
     │───────────────────────>│                        │
     │                        │                        │
     │                        │   WS /socket/:dhHash   │
     │                        │<───────────────────────│
     │                        │                        │
     │<──────────────────────>│<──────────────────────>│
     │      bidirectional     │      message relay     │
     │                        │                        │
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | No | Health check |
| `/otp` | GET | No | Get time-based challenge |
| `/inbox` | POST | Yes | Create inbox |
| `/inbox/:address` | GET | No | Get inbox pubkey |
| `/inbox/:address` | POST | No | Post to inbox |
| `/inbox/:address/messages` | GET | Yes | Read inbox messages |
| `/socket/:dhHash` | WS | No | WebSocket relay |

See [docs/API.md](docs/API.md) for detailed documentation.

## Authentication

Authenticated requests require two headers:

```
X-Signature: 0x...  # EIP-191 signature of OTP message
X-Message: relay-auth-...  # The OTP message that was signed
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `DATABASE_PATH` | `relay.db` | SQLite database file path |

## Project Structure

```
relay/
├── src/
│   ├── index.ts           # Entry point
│   ├── routes/
│   │   ├── inbox.ts       # Inbox CRUD endpoints
│   │   └── otp.ts         # GET /otp endpoint
│   ├── websocket/
│   │   └── socket.ts      # WebSocket relay handler
│   ├── db/
│   │   ├── schema.ts      # SQLite schema
│   │   └── queries.ts     # CRUD operations
│   ├── auth/
│   │   ├── otp.ts         # OTP generation
│   │   └── verify.ts      # Signature verification
│   └── types.ts           # TypeScript interfaces
├── tests/
│   ├── auth.test.ts       # OTP and signature verification
│   ├── inbox.test.ts      # Database CRUD operations
│   ├── websocket.test.ts  # WebSocket room management
│   ├── routes.test.ts     # HTTP API error handling
│   └── e2e.test.ts        # Full flow integration
└── docs/
    └── API.md
```

## Dependencies

- **hono**: Lightweight web framework
- **@noble/secp256k1**: Audited secp256k1 library
- **@noble/hashes**: Audited hash functions
- **bun:sqlite**: Built-in SQLite database

## Security Notes

1. **No IP Exposure**: Parties communicate through the relay
2. **Address Ownership**: Only private key holder can create/read inbox
3. **Time-Limited OTP**: Signatures valid for ~20 seconds
4. **Client-Side ECDH**: Server cannot compute shared secrets

## License

MIT
