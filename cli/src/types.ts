// Server → Consumer messages
export interface ReadyMessage {
  type: "ready";
  model: string;
}

export interface StreamChunkMessage {
  type: "stream_chunk";
  requestId: string;
  content: string;
  done: boolean;
}

export interface CompleteMessage {
  type: "complete";
  requestId: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ErrorMessage {
  type: "error";
  requestId: string;
  error: string;
}

// Consumer → Server messages
export interface PromptRequestMessage {
  type: "prompt_request";
  id: string;
  prompt: string;
}

// Relay system messages
export interface ConnectedMessage {
  type: "connected";
  peers: number;
  message: string;
}

export interface PeerJoinedMessage {
  type: "peer_joined";
  peers: number;
}

export interface PeerLeftMessage {
  type: "peer_left";
  peers: number;
}

export type ServerMessage =
  | ReadyMessage
  | StreamChunkMessage
  | CompleteMessage
  | ErrorMessage;

export type ConsumerMessage = PromptRequestMessage;

export type RelaySystemMessage =
  | ConnectedMessage
  | PeerJoinedMessage
  | PeerLeftMessage;

export type AnyMessage = ServerMessage | ConsumerMessage | RelaySystemMessage;
