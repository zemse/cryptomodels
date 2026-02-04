import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ServerWebSocket } from "bun";
import { otpRouter } from "./routes/otp";
import { inboxRouter } from "./routes/inbox";
import { handleOpen, handleMessage, handleClose } from "./websocket/socket";
import type { WebSocketData } from "./types";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", service: "relay" });
});

// Routes
app.route("/otp", otpRouter);
app.route("/inbox", inboxRouter);

// Extract dhHash from WebSocket upgrade path
function extractDhHash(url: string): string | null {
  const match = url.match(/\/socket\/([a-fA-F0-9]{64})/);
  return match ? match[1].toLowerCase() : null;
}

const port = parseInt(process.env.PORT ?? "4000");

const server = Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade for /socket/:dhHash
    if (url.pathname.startsWith("/socket/")) {
      const dhHash = extractDhHash(url.pathname);

      if (!dhHash) {
        return new Response("Invalid dhHash - must be 64 hex characters", {
          status: 400,
        });
      }

      const upgraded = server.upgrade(req, {
        data: { dhHash } as WebSocketData,
      });

      if (upgraded) {
        return undefined;
      }

      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Handle regular HTTP requests with Hono
    return app.fetch(req);
  },
  websocket: {
    open(ws: ServerWebSocket<WebSocketData>) {
      handleOpen(ws);
    },
    message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
      handleMessage(ws, message);
    },
    close(ws: ServerWebSocket<WebSocketData>) {
      handleClose(ws);
    },
  },
});

console.log(`Relay server running on http://localhost:${port}`);

export { app, server };
