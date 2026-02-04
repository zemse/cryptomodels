import { describe, test, expect } from "bun:test";
import {
  handleOpen,
  handleClose,
  handleMessage,
  getRoomCount,
  getRoomPeerCount,
} from "../src/websocket/socket";
import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../src/types";

// Mock WebSocket implementation
class MockWebSocket {
  data: WebSocketData;
  messages: (string | Buffer)[] = [];
  closed = false;

  constructor(dhHash: string) {
    this.data = { dhHash };
  }

  send(message: string | Buffer) {
    this.messages.push(message);
  }

  close() {
    this.closed = true;
  }

  getLastMessage(): any {
    const last = this.messages[this.messages.length - 1];
    return typeof last === "string" ? JSON.parse(last) : last;
  }
}

describe("WebSocket Room Management", () => {
  test("first connection creates room and waits", () => {
    const dhHash = "a".repeat(64);
    const ws = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws);

    expect(getRoomPeerCount(dhHash)).toBe(1);
    const msg = (ws as unknown as MockWebSocket).getLastMessage();
    expect(msg.type).toBe("connected");
    expect(msg.peers).toBe(0);

    // Cleanup
    handleClose(ws);
  });

  test("second connection pairs with first", () => {
    const dhHash = "b".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);

    expect(getRoomPeerCount(dhHash)).toBe(2);

    // ws2 should see 1 peer
    const ws2Msg = (ws2 as unknown as MockWebSocket).getLastMessage();
    expect(ws2Msg.type).toBe("connected");
    expect(ws2Msg.peers).toBe(1);

    // ws1 should receive peer_joined
    const ws1Msg = (ws1 as unknown as MockWebSocket).getLastMessage();
    expect(ws1Msg.type).toBe("peer_joined");

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
  });

  test("message is forwarded to peer", () => {
    const dhHash = "c".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);

    // Clear previous messages
    (ws1 as unknown as MockWebSocket).messages = [];
    (ws2 as unknown as MockWebSocket).messages = [];

    // ws1 sends a message
    handleMessage(ws1, "hello from ws1");

    // ws2 should receive it
    const ws2Messages = (ws2 as unknown as MockWebSocket).messages;
    expect(ws2Messages.length).toBe(1);
    expect(ws2Messages[0]).toBe("hello from ws1");

    // ws1 should not receive its own message
    const ws1Messages = (ws1 as unknown as MockWebSocket).messages;
    expect(ws1Messages.length).toBe(0);

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
  });

  test("disconnection notifies peer", () => {
    const dhHash = "d".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);

    // Clear messages
    (ws1 as unknown as MockWebSocket).messages = [];
    (ws2 as unknown as MockWebSocket).messages = [];

    // ws1 disconnects
    handleClose(ws1);

    // ws2 should receive peer_left
    const ws2Msg = (ws2 as unknown as MockWebSocket).getLastMessage();
    expect(ws2Msg.type).toBe("peer_left");
    expect(ws2Msg.peers).toBe(0);

    // Cleanup
    handleClose(ws2);
  });

  test("empty room is cleaned up", () => {
    const dhHash = "e".repeat(64);
    const ws = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws);
    expect(getRoomPeerCount(dhHash)).toBe(1);

    handleClose(ws);
    expect(getRoomPeerCount(dhHash)).toBe(0);
  });

  test("different dhHash creates different rooms", () => {
    const dhHash1 = "f".repeat(64);
    const dhHash2 = "0".repeat(64);
    const ws1 = new MockWebSocket(dhHash1) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash2) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);

    expect(getRoomPeerCount(dhHash1)).toBe(1);
    expect(getRoomPeerCount(dhHash2)).toBe(1);

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
  });
});
