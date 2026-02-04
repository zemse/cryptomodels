export type MessageHandler = (data: unknown) => void;
export type ConnectionHandler = () => void;

export class RelayWebSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private openHandlers: ConnectionHandler[] = [];
  private closeHandlers: ConnectionHandler[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(
    private baseUrl: string,
    private dhHash: string
  ) {}

  /**
   * Connect to WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace(/^http/, "ws");
      this.ws = new WebSocket(`${wsUrl}/socket/${this.dhHash}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.openHandlers.forEach((h) => h());
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.messageHandlers.forEach((h) => h(data));
        } catch {
          // Ignore non-JSON messages
        }
      };

      this.ws.onclose = () => {
        this.closeHandlers.forEach((h) => h());
      };

      this.ws.onerror = () => {
        const error = new Error("WebSocket error");
        this.errorHandlers.forEach((h) => h(error));
        reject(error);
      };
    });
  }

  /**
   * Reconnect with exponential backoff
   */
  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error("Max reconnection attempts reached");
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    await new Promise((resolve) => setTimeout(resolve, delay));
    return this.connect();
  }

  /**
   * Send data through WebSocket
   */
  send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(data));
  }

  /**
   * Register message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register open handler
   */
  onOpen(handler: ConnectionHandler): void {
    this.openHandlers.push(handler);
  }

  /**
   * Register close handler
   */
  onClose(handler: ConnectionHandler): void {
    this.closeHandlers.push(handler);
  }

  /**
   * Register error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
