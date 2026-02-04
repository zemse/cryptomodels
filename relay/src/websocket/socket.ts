import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "../types";

// Map: dhHash -> Set of connected sockets
const rooms = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

export function handleOpen(ws: ServerWebSocket<WebSocketData>): void {
  const { dhHash } = ws.data;

  if (!rooms.has(dhHash)) {
    rooms.set(dhHash, new Set());
  }

  const room = rooms.get(dhHash)!;
  room.add(ws);

  // Notify the new client about room status
  const peerCount = room.size - 1;
  ws.send(JSON.stringify({
    type: "connected",
    peers: peerCount,
    message: peerCount > 0 ? "Peer connected, ready to communicate" : "Waiting for peer...",
  }));

  // Notify existing peers about new connection
  if (peerCount > 0) {
    for (const peer of room) {
      if (peer !== ws) {
        peer.send(JSON.stringify({
          type: "peer_joined",
          peers: room.size - 1,
        }));
      }
    }
  }
}

export function handleMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: string | Buffer
): void {
  const { dhHash } = ws.data;
  const room = rooms.get(dhHash);

  if (!room) {
    return;
  }

  // Forward message to all peers in the room
  for (const peer of room) {
    if (peer !== ws) {
      peer.send(message);
    }
  }
}

export function handleClose(ws: ServerWebSocket<WebSocketData>): void {
  const { dhHash } = ws.data;
  const room = rooms.get(dhHash);

  if (!room) {
    return;
  }

  room.delete(ws);

  // Notify remaining peers
  for (const peer of room) {
    peer.send(JSON.stringify({
      type: "peer_left",
      peers: room.size - 1,
    }));
  }

  // Clean up empty rooms
  if (room.size === 0) {
    rooms.delete(dhHash);
  }
}

export function getRoomCount(): number {
  return rooms.size;
}

export function getRoomPeerCount(dhHash: string): number {
  return rooms.get(dhHash)?.size ?? 0;
}
