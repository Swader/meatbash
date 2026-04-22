import type { ClientMessage, ServerMessage } from './protocol';

export interface WsClientHooks {
  onMessage?: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export class WsClient {
  private socket: WebSocket | null = null;

  constructor(private readonly hooks: WsClientHooks = {}) {}

  async connect(url: string): Promise<void> {
    await this.disconnect();
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.hooks.onOpen?.();
        resolve();
      }, { once: true });
      socket.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as ServerMessage;
          this.hooks.onMessage?.(parsed);
        } catch (err) {
          console.warn('Failed to parse websocket payload:', err);
        }
      });
      socket.addEventListener('close', () => {
        this.hooks.onClose?.();
        this.socket = null;
      });
      socket.addEventListener('error', (event) => {
        this.hooks.onError?.(event);
        reject(new Error('WebSocket connection failed'));
      }, { once: true });
    });
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close();
    });
  }
}
