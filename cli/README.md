# CryptoModels CLI

Peer-to-peer LLM access via Yellow payment channels.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Relay server running (default: `http://127.0.0.1:4000`)
- [Ollama](https://ollama.ai) running locally (for serving)

## Installation

```bash
cd cli
bun install
```

## Usage

You need two terminals - one for the server (provider) and one for the client (consumer).

### Generate Test Keys

```bash
echo "Server key: 0x$(openssl rand -hex 32)"
echo "Client key: 0x$(openssl rand -hex 32)"
```

### Terminal 1 - Start Server (Provider)

```bash
bun run serve <model> --private-key <server_private_key>
```

Example:
```bash
bun run serve llama3.2 --private-key 0xabc123...
```

The server will print its Ethereum address on startup - you'll need this for the client.

### Terminal 2 - Start Client (Consumer)

```bash
bun run hire <server_address> --private-key <client_private_key>
```

Example:
```bash
bun run hire 0x1234...abcd --private-key 0xdef456...
```

## Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--private-key` | `-k` | Ethereum private key (required) | - |
| `--relay-url` | `-r` | Relay server URL | `http://127.0.0.1:4000` |
| `--ollama-url` | `-o` | Ollama server URL (serve only) | `http://127.0.0.1:11434` |

## How It Works

1. **Server** registers with the relay and waits for client connections
2. **Client** opens a payment channel with the server via the relay
3. Client sends prompts, server responds with LLM completions
4. Payments are streamed per-token through Yellow payment channels
