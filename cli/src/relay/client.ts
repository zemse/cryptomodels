import { signMessage } from "../crypto/signing";

export interface OtpResponse {
  message: string;
  validUntil: number;
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

export class RelayClient {
  constructor(private baseUrl: string) {}

  /**
   * Get OTP message for signing
   */
  async getOtp(): Promise<OtpResponse> {
    const res = await fetch(`${this.baseUrl}/otp`);
    if (!res.ok) {
      throw new Error(`Failed to get OTP: ${res.status}`);
    }
    return res.json();
  }

  /**
   * Create an inbox for a public key (authenticated)
   */
  async createInbox(
    pubkey: string,
    privateKey: string
  ): Promise<{ success: boolean; address: string; inbox: string }> {
    const { message } = await this.getOtp();
    const signature = await signMessage(message, privateKey);

    const res = await fetch(`${this.baseUrl}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Message": message,
      },
      body: JSON.stringify({ pubkey }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Failed to create inbox: ${error.error}`);
    }
    return res.json();
  }

  /**
   * Get inbox public key (public)
   */
  async getInbox(address: string): Promise<InboxResponse | null> {
    const res = await fetch(`${this.baseUrl}/inbox/${address}`);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to get inbox: ${res.status}`);
    }
    return res.json();
  }

  /**
   * Post public key to someone's inbox (public)
   */
  async postToInbox(
    address: string,
    pubkey: string
  ): Promise<{ success: boolean }> {
    const res = await fetch(`${this.baseUrl}/inbox/${address}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pubkey }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Failed to post to inbox: ${error.error}`);
    }
    return res.json();
  }

  /**
   * Get inbox messages (authenticated - owner only)
   */
  async getMessages(
    address: string,
    privateKey: string
  ): Promise<MessagesResponse> {
    const { message } = await this.getOtp();
    const signature = await signMessage(message, privateKey);

    const res = await fetch(`${this.baseUrl}/inbox/${address}/messages`, {
      headers: {
        "X-Signature": signature,
        "X-Message": message,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Failed to get messages: ${error.error}`);
    }
    return res.json();
  }
}
