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

  test("room supports more than 2 peers", () => {
    const dhHash = "1".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws3 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);
    handleOpen(ws3);

    expect(getRoomPeerCount(dhHash)).toBe(3);

    // ws3 should see 2 peers
    const ws3Msg = (ws3 as unknown as MockWebSocket).getLastMessage();
    expect(ws3Msg.type).toBe("connected");
    expect(ws3Msg.peers).toBe(2);

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
    handleClose(ws3);
  });

  test("message is broadcast to all peers in multi-peer room", () => {
    const dhHash = "2".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws3 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);
    handleOpen(ws3);

    // Clear previous messages
    (ws1 as unknown as MockWebSocket).messages = [];
    (ws2 as unknown as MockWebSocket).messages = [];
    (ws3 as unknown as MockWebSocket).messages = [];

    // ws1 sends a message
    handleMessage(ws1, "broadcast message");

    // ws2 and ws3 should receive it
    expect((ws2 as unknown as MockWebSocket).messages).toContain("broadcast message");
    expect((ws3 as unknown as MockWebSocket).messages).toContain("broadcast message");

    // ws1 should not receive its own message
    expect((ws1 as unknown as MockWebSocket).messages.length).toBe(0);

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
    handleClose(ws3);
  });

  test("handles binary message (Buffer)", () => {
    const dhHash = "3".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);

    // Clear messages
    (ws1 as unknown as MockWebSocket).messages = [];
    (ws2 as unknown as MockWebSocket).messages = [];

    // Send binary message
    const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    handleMessage(ws1, binaryData);

    // ws2 should receive the binary data
    const ws2Messages = (ws2 as unknown as MockWebSocket).messages;
    expect(ws2Messages.length).toBe(1);
    expect(ws2Messages[0]).toEqual(binaryData);

    // Cleanup
    handleClose(ws1);
    handleClose(ws2);
  });

  test("message to non-existent room is silently dropped", () => {
    const dhHash = "4".repeat(64);
    const ws = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    // Don't call handleOpen, just try to send message
    // This shouldn't throw
    expect(() => handleMessage(ws, "orphan message")).not.toThrow();
  });

  test("close on non-existent room doesn't throw", () => {
    const dhHash = "5".repeat(64);
    const ws = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    // Don't call handleOpen, just try to close
    // This shouldn't throw
    expect(() => handleClose(ws)).not.toThrow();
  });

  test("peer_left message shows correct peer count after partial disconnect", () => {
    const dhHash = "6".repeat(64);
    const ws1 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws2 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;
    const ws3 = new MockWebSocket(dhHash) as unknown as ServerWebSocket<WebSocketData>;

    handleOpen(ws1);
    handleOpen(ws2);
    handleOpen(ws3);

    // Clear messages
    (ws1 as unknown as MockWebSocket).messages = [];
    (ws2 as unknown as MockWebSocket).messages = [];
    (ws3 as unknown as MockWebSocket).messages = [];

    // ws1 disconnects
    handleClose(ws1);

    // ws2 and ws3 should receive peer_left with 1 peer remaining (each other)
    const ws2Msg = (ws2 as unknown as MockWebSocket).getLastMessage();
    const ws3Msg = (ws3 as unknown as MockWebSocket).getLastMessage();

    expect(ws2Msg.type).toBe("peer_left");
    expect(ws2Msg.peers).toBe(1);
    expect(ws3Msg.type).toBe("peer_left");
    expect(ws3Msg.peers).toBe(1);

    // Cleanup
    handleClose(ws2);
    handleClose(ws3);
  });
});
