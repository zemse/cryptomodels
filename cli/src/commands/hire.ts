import { privateKeyToPublicKey, privateKeyToAddress } from "../crypto/keys";
import { computeDhHash } from "../crypto/ecdh";
import { RelayClient } from "../relay/client";
import { RelayWebSocket } from "../relay/websocket";
import { saveSession, getSession } from "../storage/sessions";
import { startRepl } from "../repl/interactive";
import type {
  AnyMessage,
  PromptRequestMessage,
  StreamChunkMessage,
  CompleteMessage,
  ErrorMessage,
  ReadyMessage,
} from "../types";

export interface HireOptions {
  serverAddress: string;
  privateKey: string;
  relayUrl: string;
}

export async function hire(options: HireOptions): Promise<void> {
  const { serverAddress, privateKey, relayUrl } = options;

  // Derive our keys
  const myPubkey = privateKeyToPublicKey(privateKey);
  const myAddress = privateKeyToAddress(privateKey);

  console.log(`Your address: ${myAddress}`);
  console.log(`Connecting to server: ${serverAddress}`);

  const relay = new RelayClient(relayUrl);
  let dhHash: string;
  let serverPubkey: string;

  // Check for existing session
  const existingSession = getSession(serverAddress);
  if (existingSession) {
    console.log("Found existing session, attempting reconnection...");
    dhHash = existingSession;

    // Still need server pubkey to validate
    const inbox = await relay.getInbox(serverAddress);
    if (!inbox) {
      console.error(`Server inbox not found at ${serverAddress}`);
      console.log("Clearing stale session...");
      const { deleteSession } = await import("../storage/sessions");
      deleteSession(serverAddress);
      process.exit(1);
    }
    serverPubkey = inbox.pubkey;
  } else {
    console.log("No existing session, performing key exchange...");

    // Get server's public key
    const inbox = await relay.getInbox(serverAddress);
    if (!inbox) {
      console.error(`Server inbox not found at ${serverAddress}`);
      console.error("Make sure the server is running and has created an inbox.");
      process.exit(1);
    }
    serverPubkey = inbox.pubkey;
    console.log(`Found server pubkey: ${serverPubkey.slice(0, 20)}...`);

    // Post our public key to server's inbox
    await relay.postToInbox(serverAddress, myPubkey);
    console.log("Posted our pubkey to server inbox");

    // Compute dhHash
    dhHash = computeDhHash(privateKey, serverPubkey);

    // Save session for reconnection
    saveSession(serverAddress, dhHash);
    console.log("Session saved for future reconnection");
  }

  // Connect WebSocket
  const ws = new RelayWebSocket(relayUrl, dhHash);

  let modelName = "unknown";
  let pendingRequestId: string | null = null;
  let responseResolver: (() => void) | null = null;

  ws.onMessage((data: unknown) => {
    const msg = data as AnyMessage;

    if (msg.type === "connected") {
      console.log(`WebSocket connected: ${msg.message}`);
    } else if (msg.type === "ready") {
      const readyMsg = msg as ReadyMessage;
      modelName = readyMsg.model;
      console.log(`Server ready with model: ${modelName}`);
    } else if (msg.type === "stream_chunk") {
      const chunk = msg as StreamChunkMessage;
      if (chunk.requestId === pendingRequestId) {
        process.stdout.write(chunk.content);
      }
    } else if (msg.type === "complete") {
      const complete = msg as CompleteMessage;
      if (complete.requestId === pendingRequestId) {
        console.log(
          `\n[tokens: ${complete.promptTokens} in / ${complete.completionTokens} out]\n`
        );
        pendingRequestId = null;
        if (responseResolver) {
          responseResolver();
          responseResolver = null;
        }
      }
    } else if (msg.type === "error") {
      const error = msg as ErrorMessage;
      if (error.requestId === pendingRequestId) {
        console.error(`\nError: ${error.error}\n`);
        pendingRequestId = null;
        if (responseResolver) {
          responseResolver();
          responseResolver = null;
        }
      }
    } else if (msg.type === "peer_joined") {
      // Server joined the room
    } else if (msg.type === "peer_left") {
      console.log("\nServer disconnected.");
    }
  });

  ws.onClose(() => {
    console.log("\nConnection closed.");
    process.exit(0);
  });

  ws.onError((error) => {
    console.error(`WebSocket error: ${error.message}`);
  });

  try {
    await ws.connect();
  } catch (error) {
    console.error(
      `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exit(1);
  }

  // Wait a moment for ready message
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start REPL
  startRepl({
    modelName,
    onPrompt: async (prompt: string) => {
      const requestId = crypto.randomUUID();
      pendingRequestId = requestId;

      const request: PromptRequestMessage = {
        type: "prompt_request",
        id: requestId,
        prompt,
      };

      ws.send(request);

      // Wait for response to complete
      await new Promise<void>((resolve) => {
        responseResolver = resolve;
      });
    },
    onQuit: () => {
      ws.close();
      process.exit(0);
    },
  });
}
