export interface Inbox {
  address: string;
  owner_pubkey: string;
  created_at: number;
}

export interface InboxMessage {
  id: number;
  inbox_address: string;
  sender_pubkey: string;
  created_at: number;
}

export interface OtpResponse {
  message: string;
  validUntil: number;
}

export interface CreateInboxRequest {
  pubkey: string;
}

export interface PostToInboxRequest {
  pubkey: string;
}

export interface InboxResponse {
  address: string;
  pubkey: string;
}

export interface MessagesResponse {
  messages: Array<{
    pubkey: string;
    createdAt: number;
  }>;
}

export interface WebSocketData {
  dhHash: string;
}
