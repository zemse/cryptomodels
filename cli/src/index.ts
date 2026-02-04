#!/usr/bin/env bun
import { serve } from "./commands/serve";
import { hire } from "./commands/hire";

const USAGE = `
cryptomodels - Peer-to-peer LLM access via relay

Usage:
  cryptomodels serve <model> --private-key <pk> [--relay-url <url>] [--ollama-url <url>]
  cryptomodels hire <address> --private-key <pk> [--relay-url <url>]

Commands:
  serve    Serve an Ollama model to consumers
  hire     Connect to a server and use its model

Options:
  --private-key, -k   Your Ethereum private key (required)
  --relay-url, -r     Relay server URL (default: http://127.0.0.1:4000)
  --ollama-url, -o    Ollama server URL (default: http://127.0.0.1:11434)

Examples:
  # Start serving llama3.2 model
  cryptomodels serve llama3.2 --private-key 0xabc123...

  # Connect to a server
  cryptomodels hire 0x1234...abcd --private-key 0xdef456...
`;

function parseArgs(args: string[]): {
  command: string;
  positional: string;
  flags: Record<string, string>;
} {
  const flags: Record<string, string> = {};
  let command = "";
  let positional = "";
  let i = 0;

  // First arg is command
  if (args.length > 0 && !args[0].startsWith("-")) {
    command = args[0];
    i = 1;
  }

  // Second arg is positional (model or address)
  if (args.length > 1 && !args[1].startsWith("-")) {
    positional = args[1];
    i = 2;
  }

  // Parse flags
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--private-key" || arg === "-k") {
      flags.privateKey = args[++i];
    } else if (arg === "--relay-url" || arg === "-r") {
      flags.relayUrl = args[++i];
    } else if (arg === "--ollama-url" || arg === "-o") {
      flags.ollamaUrl = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      flags.help = "true";
    }

    i++;
  }

  return { command, positional, flags };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, positional, flags } = parseArgs(args);

  if (flags.help || !command) {
    console.log(USAGE);
    process.exit(flags.help ? 0 : 1);
  }

  // Validate private key
  if (!flags.privateKey) {
    console.error("Error: --private-key is required");
    console.log(USAGE);
    process.exit(1);
  }

  // Normalize private key
  let privateKey = flags.privateKey;
  if (!privateKey.startsWith("0x")) {
    privateKey = "0x" + privateKey;
  }

  // Validate private key format
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    console.error("Error: Invalid private key format (must be 64 hex characters)");
    process.exit(1);
  }

  const relayUrl = flags.relayUrl ?? "http://127.0.0.1:4000";
  const ollamaUrl = flags.ollamaUrl ?? "http://127.0.0.1:11434";

  if (command === "serve") {
    if (!positional) {
      console.error("Error: Model name is required");
      console.error("Usage: cryptomodels serve <model> --private-key <pk>");
      process.exit(1);
    }

    await serve({
      model: positional,
      privateKey,
      relayUrl,
      ollamaUrl,
    });
  } else if (command === "hire") {
    if (!positional) {
      console.error("Error: Server address is required");
      console.error("Usage: cryptomodels hire <address> --private-key <pk>");
      process.exit(1);
    }

    // Normalize address
    let serverAddress = positional;
    if (!serverAddress.startsWith("0x")) {
      serverAddress = "0x" + serverAddress;
    }

    await hire({
      serverAddress,
      privateKey,
      relayUrl,
    });
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
