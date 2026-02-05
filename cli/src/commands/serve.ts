import { privateKeyToPublicKey, privateKeyToAddress } from "../crypto/keys";
import { computeDhHash } from "../crypto/ecdh";
import { RelayClient } from "../relay/client";
import { RelayWebSocket } from "../relay/websocket";
import { saveSession } from "../storage/sessions";
import { streamOllamaGenerate, checkOllamaModel } from "../ollama/client";
import type {
  PromptRequestMessage,
  ReadyMessage,
  StreamChunkMessage,
  CompleteMessage,
  ErrorMessage,
  QueueStatusMessage,
  AnyMessage,
} from "../types";

interface ConsumerConnection {
  address: string;
  pubkey: string;
  dhHash: string;
  ws: RelayWebSocket;
}

interface QueuedRequest {
  consumer: ConsumerConnection;
  request: PromptRequestMessage;
}

export interface ServeOptions {
  model: string;
  privateKey: string;
  relayUrl: string;
  ollamaUrl: string;
}

export async function serve(options: ServeOptions): Promise<void> {
  const { model, privateKey, relayUrl, ollamaUrl } = options;

  // Verify Ollama is running and model is available
  console.log(`Checking Ollama model: ${model}...`);
  const modelAvailable = await checkOllamaModel(model, ollamaUrl);
  if (!modelAvailable) {
    console.error(
      `Error: Model '${model}' not found. Make sure Ollama is running and the model is pulled.`
    );
    console.error(`Try: ollama pull ${model}`);
    process.exit(1);
  }
  console.log(`Model '${model}' is available.`);

  // Derive keys and address
  const pubkey = privateKeyToPublicKey(privateKey);
  const address = privateKeyToAddress(privateKey);
  console.log(`\nServer address: ${address}`);

  // Create inbox
  const relay = new RelayClient(relayUrl);
  try {
    await relay.createInbox(pubkey, privateKey);
    console.log(`Inbox created at ${relayUrl}/inbox/${address}`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Inbox already exists")
    ) {
      console.log(`Using existing inbox at ${relayUrl}/inbox/${address}`);
    } else {
      throw error;
    }
  }

  // Track consumers and request queue
  const consumers = new Map<string, ConsumerConnection>();
  const requestQueue: QueuedRequest[] = [];
  let isProcessing = false;
  const seenPubkeys = new Set<string>();

  // Process request queue sequentially
  async function processQueue(): Promise<void> {
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;
    const { consumer, request } = requestQueue.shift()!;

    console.log(
      `\n[${consumer.address.slice(0, 10)}...] Processing prompt: "${request.prompt.slice(0, 50)}${request.prompt.length > 50 ? "..." : ""}"`
    );

    try {
      let fullResponse = "";
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of streamOllamaGenerate(
        model,
        request.prompt,
        ollamaUrl
      )) {
        if (chunk.response) {
          fullResponse += chunk.response;

          const streamMsg: StreamChunkMessage = {
            type: "stream_chunk",
            requestId: request.id,
            content: chunk.response,
            done: chunk.done,
          };
          consumer.ws.send(streamMsg);
        }

        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count ?? 0;
          completionTokens = chunk.eval_count ?? 0;
        }
      }

      const completeMsg: CompleteMessage = {
        type: "complete",
        requestId: request.id,
        promptTokens,
        completionTokens,
      };
      consumer.ws.send(completeMsg);

      console.log(
        `[${consumer.address.slice(0, 10)}...] Completed [tokens: ${promptTokens} in / ${completionTokens} out]`
      );
    } catch (error) {
      const errorMsg: ErrorMessage = {
        type: "error",
        requestId: request.id,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      consumer.ws.send(errorMsg);
      console.error(
        `[${consumer.address.slice(0, 10)}...] Error: ${errorMsg.error}`
      );
    }

    isProcessing = false;
    processQueue();
  }

  // Handle new consumer connection
  async function handleNewConsumer(consumerPubkey: string): Promise<void> {
    if (seenPubkeys.has(consumerPubkey)) return;
    seenPubkeys.add(consumerPubkey);

    const dhHash = computeDhHash(privateKey, consumerPubkey);

    // Derive consumer address for display
    const { publicKeyToAddress } = await import("../crypto/keys");
    const consumerAddress = publicKeyToAddress(consumerPubkey);

    console.log(`\nNew consumer connecting: ${consumerAddress}`);

    // Save session for potential reconnection
    saveSession(consumerAddress, dhHash);

    // Connect WebSocket
    const ws = new RelayWebSocket(relayUrl, dhHash);

    const consumer: ConsumerConnection = {
      address: consumerAddress,
      pubkey: consumerPubkey,
      dhHash,
      ws,
    };

    ws.onMessage((data: unknown) => {
      const msg = data as AnyMessage;

      if (msg.type === "connected" || msg.type === "peer_joined") {
        // Send ready message when peer joins
        const readyMsg: ReadyMessage = { type: "ready", model };
        ws.send(readyMsg);
        console.log(`[${consumerAddress.slice(0, 10)}...] Sent ready message`);
      } else if (msg.type === "prompt_request") {
        const request = msg as PromptRequestMessage;
        requestQueue.push({ consumer, request });
        const position = requestQueue.length;
        console.log(
          `[${consumerAddress.slice(0, 10)}...] Queued request (queue size: ${position})`
        );

        // Send queue position to consumer
        const queueStatus: QueueStatusMessage = {
          type: "queue_status",
          position: isProcessing ? position : 0,
          queueLength: position,
        };
        ws.send(queueStatus);

        processQueue();
      } else if (msg.type === "queue_status_request") {
        // Find consumer's position in queue
        const position = requestQueue.findIndex(
          (r) => r.consumer.address === consumerAddress
        );
        const queueStatus: QueueStatusMessage = {
          type: "queue_status",
          position: position === -1 ? 0 : position + 1,
          queueLength: requestQueue.length,
        };
        ws.send(queueStatus);
      } else if (msg.type === "peer_left") {
        console.log(`[${consumerAddress.slice(0, 10)}...] Peer disconnected`);
      }
    });

    ws.onClose(() => {
      consumers.delete(consumerAddress);
      console.log(`[${consumerAddress.slice(0, 10)}...] Connection closed`);
    });

    try {
      await ws.connect();
      consumers.set(consumerAddress, consumer);
      console.log(`[${consumerAddress.slice(0, 10)}...] WebSocket connected`);
    } catch (error) {
      console.error(
        `[${consumerAddress.slice(0, 10)}...] Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      seenPubkeys.delete(consumerPubkey);
    }
  }

  // Poll for new consumers
  console.log("\nWaiting for consumers...");
  console.log("Press Ctrl+C to stop the server.\n");

  const pollInterval = setInterval(async () => {
    try {
      const { messages } = await relay.getMessages(address, privateKey);
      for (const msg of messages) {
        await handleNewConsumer(msg.pubkey);
      }
    } catch (error) {
      // Silently handle polling errors
    }
  }, 2000);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\n\nShutting down server...");
    clearInterval(pollInterval);
    for (const consumer of consumers.values()) {
      consumer.ws.close();
    }
    process.exit(0);
  });
}
