import { Hono } from "hono";
import { createInbox, getInbox, postMessage, getMessages } from "../db/queries";
import { isValidOtp } from "../auth/otp";
import { recoverAddress, pubkeyToAddress, isValidPubkey } from "../auth/verify";
import type { CreateInboxRequest, PostToInboxRequest } from "../types";

const inboxRouter = new Hono();

// Middleware to verify signature
function verifyAuth(
  signature: string | undefined,
  message: string | undefined,
  expectedAddress?: string
): { valid: boolean; address: string | null; error?: string } {
  if (!signature || !message) {
    return { valid: false, address: null, error: "Missing X-Signature or X-Message header" };
  }

  if (!isValidOtp(message)) {
    return { valid: false, address: null, error: "OTP message expired or invalid" };
  }

  const recoveredAddress = recoverAddress(message, signature);
  if (!recoveredAddress) {
    return { valid: false, address: null, error: "Invalid signature" };
  }

  if (expectedAddress && recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { valid: false, address: recoveredAddress, error: "Address mismatch" };
  }

  return { valid: true, address: recoveredAddress };
}

// Create inbox (authenticated)
inboxRouter.post("/", async (c) => {
  const signature = c.req.header("X-Signature");
  const message = c.req.header("X-Message");

  const body = await c.req.json<CreateInboxRequest>();
  if (!body.pubkey || !isValidPubkey(body.pubkey)) {
    return c.json({ error: "Invalid or missing pubkey" }, 400);
  }

  const derivedAddress = pubkeyToAddress(body.pubkey);
  if (!derivedAddress) {
    return c.json({ error: "Could not derive address from pubkey" }, 400);
  }

  const auth = verifyAuth(signature, message, derivedAddress);
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  const inbox = createInbox(derivedAddress, body.pubkey);
  if (!inbox) {
    return c.json({ error: "Inbox already exists" }, 409);
  }

  return c.json({
    success: true,
    address: inbox.address,
    inbox: `/inbox/${inbox.address}`,
  });
});

// Get inbox public key (public)
inboxRouter.get("/:address", (c) => {
  const address = c.req.param("address");
  const inbox = getInbox(address);

  if (!inbox) {
    return c.json({ error: "Inbox not found" }, 404);
  }

  return c.json({
    address: inbox.address,
    pubkey: inbox.owner_pubkey,
  });
});

// Post to inbox (public)
inboxRouter.post("/:address", async (c) => {
  const address = c.req.param("address");
  const body = await c.req.json<PostToInboxRequest>();

  if (!body.pubkey || !isValidPubkey(body.pubkey)) {
    return c.json({ error: "Invalid or missing pubkey" }, 400);
  }

  const inbox = getInbox(address);
  if (!inbox) {
    return c.json({ error: "Inbox not found" }, 404);
  }

  const msg = postMessage(address, body.pubkey);
  if (!msg) {
    return c.json({ error: "Failed to post message" }, 500);
  }

  return c.json({ success: true });
});

// Get inbox messages (authenticated - owner only)
inboxRouter.get("/:address/messages", (c) => {
  const address = c.req.param("address");
  const signature = c.req.header("X-Signature");
  const message = c.req.header("X-Message");

  const inbox = getInbox(address);
  if (!inbox) {
    return c.json({ error: "Inbox not found" }, 404);
  }

  const auth = verifyAuth(signature, message, inbox.address);
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  const messages = getMessages(address);
  return c.json({
    messages: messages.map((m) => ({
      pubkey: m.sender_pubkey,
      createdAt: m.created_at,
    })),
  });
});

export { inboxRouter };
