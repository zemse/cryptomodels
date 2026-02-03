# x402 Payment Protocol - LLM Optimized

**Last Updated**: February 2026
**Protocol Version**: V2
**License**: Open Standard (Apache 2.0)

---

## EXECUTIVE SUMMARY

x402 is an open HTTP-native payment protocol that enables instant stablecoin payments using HTTP 402 (Payment Required) status codes. Developed by Coinbase and Cloudflare.

**Key Stats** (Feb 2026):
- 100M+ transactions processed
- $24M+ in volume
- Zero protocol fees
- Sub-second settlement

**Core Principle**: Payments embedded directly in HTTP requests - no accounts, sessions, or complex auth required.

---

## TABLE OF CONTENTS

1. [Protocol Overview](#protocol-overview)
2. [Payment Flow](#payment-flow)
3. [Implementation Guide](#implementation-guide)
4. [Supported Networks](#supported-networks)
5. [Common Mistakes & Gotchas](#common-mistakes--gotchas)
6. [Code Examples](#code-examples)
7. [Best Practices](#best-practices)

---

## PROTOCOL OVERVIEW

### What Problem Does x402 Solve?

Traditional payment integration requires:
- Payment processor accounts
- Complex authentication flows
- Session management
- KYC/AML overhead
- High fees (2-3%)

x402 enables:
- Pay-per-request without accounts
- AI agent autonomous payments
- Micropayments ($0.001+)
- Instant settlement
- Zero protocol fees

### Five Zero Principles

1. **Zero Fees**: No charges to customers or merchants
2. **Zero Wait**: Internet-speed transactions
3. **Zero Friction**: No accounts or personal info needed
4. **Zero Centralization**: Anyone can build on the standard
5. **Zero Restrictions**: Not tied to specific blockchains

### Three-Actor Architecture

```
┌──────────┐      ┌────────────────┐      ┌─────────────┐
│  Client  │◄────►│ Resource Server│◄────►│ Facilitator │
│          │      │    (Your API)  │      │  (Payment)  │
└──────────┘      └────────────────┘      └─────────────┘
```

**Client**: Pays for resources (browser, agent, API consumer)
**Resource Server**: Your HTTP endpoint/API
**Facilitator**: Handles payment verification and blockchain settlement

---

## PAYMENT FLOW

### Standard 12-Step Flow

**Discovery & Negotiation (Steps 1-2):**
```
1. Client → Server: GET /resource
2. Server → Client: 402 Payment Required
   Headers: PAYMENT-REQUIRED: <base64_payment_terms>
```

**Payment Creation (Steps 3-4):**
```
3. Client creates PaymentPayload (selects scheme/network)
4. Client → Server: GET /resource
   Headers: PAYMENT-SIGNATURE: <base64_signed_payload>
```

**Verification (Steps 5-7):**
```
5. Server → Facilitator: POST /verify
   Body: { payload, requirements }
6. Facilitator validates signature + amount
7. Facilitator → Server: { valid: true }
```

**Settlement & Response (Steps 8-12):**
```
8. Server → Facilitator: POST /settle
9. Facilitator submits transaction to blockchain
10. Awaits confirmation
11. Facilitator → Server: { txHash, status }
12. Server → Client: 200 OK + Resource
    Headers: PAYMENT-RESPONSE: <base64_receipt>
```

### Simplified Flow (Pre-Known Requirements)

Steps 1-2 optional if client knows payment terms in advance:

```javascript
// Client directly includes payment
fetch('/api/weather', {
  headers: {
    'PAYMENT-SIGNATURE': signedPayload
  }
})
```

### V2 Header Changes

**Old (V1)**: `X-Payment-Required`, `X-Payment-Signature`
**New (V2)**: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`

V1 headers deprecated but backward-compatible in reference SDKs.

---

## IMPLEMENTATION GUIDE

### Installation

**TypeScript/JavaScript:**
```bash
npm install @x402/core @x402/evm @x402/svm @x402/fetch
```

**Python:**
```bash
pip install x402
```

**Go:**
```bash
go get github.com/coinbase/x402/go
```

### Server Implementation (Express.js)

```javascript
import { paymentMiddleware } from '@x402/core';

app.use(
  paymentMiddleware({
    "GET /weather": {
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453", // Base
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
          amount: "1000000", // 1 USDC (6 decimals)
        }
      ],
      description: "Get weather data",
    },
    "GET /premium": {
      accepts: [
        { scheme: "exact", network: "eip155:8453", asset: "...", amount: "5000000" }
      ]
    }
  })
);

app.get('/weather', (req, res) => {
  // Payment automatically verified by middleware
  res.json({ temp: 72, condition: 'sunny' });
});
```

### Client Implementation

```javascript
import { createX402Client } from '@x402/fetch';

const client = createX402Client({
  privateKey: process.env.PRIVATE_KEY,
  facilitatorUrl: 'https://facilitator.coinbase.com'
});

// Automatic payment handling
const response = await client.fetch('https://api.example.com/weather');
const data = await response.json();
```

### Manual Payment Flow

```javascript
// 1. Request resource
const response1 = await fetch('/weather');

if (response1.status === 402) {
  // 2. Parse payment requirements
  const paymentRequired = parseHeader(response1.headers.get('PAYMENT-REQUIRED'));

  // 3. Create and sign payment
  const payload = createPaymentPayload({
    scheme: paymentRequired.accepts[0].scheme,
    network: paymentRequired.accepts[0].network,
    asset: paymentRequired.accepts[0].asset,
    amount: paymentRequired.accepts[0].amount,
    to: paymentRequired.payTo,
  });

  const signature = signPayload(payload, privateKey);

  // 4. Retry with payment
  const response2 = await fetch('/weather', {
    headers: {
      'PAYMENT-SIGNATURE': encodeBase64({ payload, signature })
    }
  });

  const data = await response2.json();
}
```

---

## SUPPORTED NETWORKS

### Network Identification (CAIP-2)

Format: `<namespace>:<chain_id>`

**EVM Networks (eip155):**
- Base: `eip155:8453`
- Ethereum Mainnet: `eip155:1`
- Optimism: `eip155:10`
- Arbitrum: `eip155:42161`
- Polygon: `eip155:137`

**Solana (solana):**
- Mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`

### Payment Schemes

**exact** (Current Implementation):
- Fixed amount per request
- Predictable pricing
- Example: $1.00 per API call

**upto** (Proposed):
- Dynamic pricing based on resource consumption
- Example: $0.01 per KB of data
- Not yet widely supported

### Recommended Networks

**Development/Testing:**
- Base (low fees, fast)
- Optimism (widely supported)

**Production:**
- Base (optimized for stablecoins)
- Ethereum mainnet (maximum security)

---

## COMMON MISTAKES & GOTCHAS

### 1. Decimal Precision Errors

❌ **WRONG:**
```javascript
amount: 1 // Sends 0.000001 USDC
```

✅ **CORRECT:**
```javascript
// USDC has 6 decimals
amount: "1000000" // 1 USDC
```

**GOTCHA**: Always use token decimals
- USDC/USDT: 6 decimals
- DAI: 18 decimals
- Check token contract for decimals

### 2. Network Mismatch

❌ **WRONG:**
```javascript
network: "base" // Invalid format
```

✅ **CORRECT:**
```javascript
network: "eip155:8453" // CAIP-2 format
```

**GOTCHA**: Must use CAIP-2 identifiers, not human names

### 3. Header Case Sensitivity

❌ **WRONG:**
```javascript
headers: {
  'payment-signature': payload // lowercase
}
```

✅ **CORRECT:**
```javascript
headers: {
  'PAYMENT-SIGNATURE': payload // uppercase
}
```

**GOTCHA**: V2 headers are uppercase (no X- prefix)

### 4. V1 vs V2 Confusion

❌ **WRONG (mixing versions):**
```javascript
headers: {
  'X-Payment-Signature': v2Payload // V1 header, V2 format
}
```

✅ **CORRECT:**
```javascript
// Use V2 exclusively for new implementations
headers: {
  'PAYMENT-SIGNATURE': v2Payload
}
```

**GOTCHA**: SDKs are backward-compatible, but prefer V2 for new code

### 5. Missing Facilitator Configuration

❌ **WRONG:**
```javascript
// Server doesn't configure facilitator
app.use(paymentMiddleware({...})); // Verification fails
```

✅ **CORRECT:**
```javascript
app.use(paymentMiddleware({
  facilitatorUrl: 'https://facilitator.coinbase.com',
  routes: {...}
}));
```

**GOTCHA**: Server must have facilitator endpoint for verification

### 6. Gas Fee Surprises

❌ **WRONG:**
```javascript
// User pays $1 but gets charged $1 + $0.50 gas
amount: "1000000"
```

✅ **CORRECT:**
```javascript
// Use L2s (Base, Optimism) for low gas
network: "eip155:8453" // ~$0.001 gas
```

**GOTCHA**: Ethereum mainnet gas can exceed payment amount

### 7. Unsigned Amounts in Payload

❌ **WRONG:**
```javascript
amount: -1000000 // Negative amount
```

✅ **CORRECT:**
```javascript
amount: "1000000" // Always positive string
```

**GOTCHA**: Amounts must be positive integers as strings

### 8. Missing Asset Address

❌ **WRONG:**
```javascript
asset: "USDC" // Token symbol not valid
```

✅ **CORRECT:**
```javascript
asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Contract address
```

**GOTCHA**: Must use full token contract address (ERC-20)

### 9. Signature Replay Attacks

❌ **WRONG:**
```javascript
// No nonce or timestamp
const payload = { to, amount, asset }
```

✅ **CORRECT:**
```javascript
const payload = {
  to,
  amount,
  asset,
  nonce: randomBytes(32),
  timestamp: Date.now()
}
```

**GOTCHA**: Include nonce/timestamp to prevent replay

### 10. Testing on Mainnet First

❌ **WRONG:**
```bash
# Deploy directly to mainnet
NETWORK=mainnet npm run deploy
```

✅ **CORRECT:**
```bash
# Test on Base Sepolia first
NETWORK=base-sepolia npm run test
```

**GOTCHA**: Always test on testnet (Base Sepolia, Sepolia)

---

## CODE EXAMPLES

### Complete Server Example (Express + TypeScript)

```typescript
import express from 'express';
import { paymentMiddleware, createFacilitator } from '@x402/core';

const app = express();

// Configure facilitator
const facilitator = createFacilitator({
  url: 'https://facilitator.coinbase.com',
  apiKey: process.env.FACILITATOR_API_KEY,
});

// Define payment routes
app.use(
  paymentMiddleware({
    facilitator,
    routes: {
      "GET /api/weather/:city": {
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453", // Base
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
            amount: "1000000", // 1 USDC
          }
        ],
        description: "City weather data",
      },
      "POST /api/generate": {
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount: "10000000", // 10 USDC for AI generation
          }
        ],
        description: "AI content generation",
      }
    },
  })
);

// Protected endpoints
app.get('/api/weather/:city', (req, res) => {
  // Payment verified by middleware
  const { city } = req.params;
  res.json({
    city,
    temperature: 72,
    condition: 'sunny',
    timestamp: Date.now(),
  });
});

app.post('/api/generate', async (req, res) => {
  // Expensive AI operation
  const result = await generateContent(req.body.prompt);
  res.json({ result });
});

app.listen(3000, () => {
  console.log('x402 API running on port 3000');
});
```

### Complete Client Example (Node.js)

```typescript
import { createX402Client } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';

// Initialize wallet
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

// Create x402-enabled client
const client = createX402Client({
  account,
  facilitatorUrl: 'https://facilitator.coinbase.com',
});

async function main() {
  try {
    // Call paid endpoint
    const response = await client.fetch('https://api.example.com/api/weather/london');

    if (response.ok) {
      const data = await response.json();
      console.log('Weather:', data);

      // Check payment receipt
      const receipt = response.headers.get('PAYMENT-RESPONSE');
      if (receipt) {
        const decoded = JSON.parse(atob(receipt));
        console.log('Transaction:', decoded.txHash);
      }
    } else {
      console.error('Request failed:', response.status);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

### Python Client Example

```python
from x402 import X402Client
import os

# Initialize client
client = X402Client(
    private_key=os.getenv('PRIVATE_KEY'),
    facilitator_url='https://facilitator.coinbase.com'
)

# Make paid request
response = client.get('https://api.example.com/api/weather/london')

if response.status_code == 200:
    data = response.json()
    print(f"Weather: {data['temperature']}°F")

    # Check payment receipt
    receipt = response.headers.get('PAYMENT-RESPONSE')
    print(f"Transaction: {receipt['txHash']}")
else:
    print(f"Error: {response.status_code}")
```

### AI Agent Example (Autonomous Payment)

```typescript
import { createX402Client } from '@x402/fetch';
import { ChatOpenAI } from 'langchain/chat_models/openai';

class PayingAgent {
  private x402Client;
  private llm;

  constructor(privateKey: string) {
    this.x402Client = createX402Client({
      account: privateKeyToAccount(privateKey),
      facilitatorUrl: 'https://facilitator.coinbase.com',
    });

    this.llm = new ChatOpenAI({ temperature: 0 });
  }

  async run(prompt: string) {
    // Agent decides to fetch weather data
    const weatherResponse = await this.x402Client.fetch(
      'https://api.example.com/api/weather/london'
    );
    const weather = await weatherResponse.json();

    // Agent uses data to generate response
    const answer = await this.llm.call([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: `${prompt}\n\nWeather: ${JSON.stringify(weather)}` }
    ]);

    return answer.content;
  }
}

// Usage
const agent = new PayingAgent(process.env.AGENT_KEY);
const response = await agent.run("What's the weather like in London?");
console.log(response);
```

---

## BEST PRACTICES

### 1. Use L2 Networks for Low Fees

**Recommended**: Base, Optimism, Arbitrum
- Base: ~$0.001 per tx
- Optimism: ~$0.002 per tx
- Mainnet: ~$1-5 per tx (avoid for micropayments)

### 2. Implement Rate Limiting

```javascript
import rateLimit from 'express-rate-limit';

// Prevent payment spam
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 paid requests per minute
  message: 'Too many requests'
});

app.use('/api', paymentLimiter);
```

### 3. Cache Payment Verifications

```javascript
const verificationCache = new Map();

async function verifyPayment(signature) {
  // Check cache first
  if (verificationCache.has(signature)) {
    return verificationCache.get(signature);
  }

  // Verify with facilitator
  const result = await facilitator.verify(signature);

  // Cache result (with expiry)
  verificationCache.set(signature, result);
  setTimeout(() => verificationCache.delete(signature), 60000);

  return result;
}
```

### 4. Implement Graceful Fallbacks

```javascript
app.get('/api/weather/:city', async (req, res) => {
  const paymentValid = req.payment?.verified;

  if (paymentValid) {
    // Full paid response
    res.json({
      city: req.params.city,
      temperature: 72,
      condition: 'sunny',
      hourlyForecast: [...],
      extended: [...]
    });
  } else {
    // Free tier with limited data
    res.json({
      city: req.params.city,
      temperature: 72,
      condition: 'sunny'
    });
  }
});
```

### 5. Monitor Payment Metrics

```javascript
import { Counter, Histogram } from 'prom-client';

const paymentsReceived = new Counter({
  name: 'x402_payments_received_total',
  help: 'Total payments received'
});

const paymentAmount = Histogram({
  name: 'x402_payment_amount_usd',
  help: 'Payment amounts in USD'
});

// Track metrics
paymentsReceived.inc();
paymentAmount.observe(amountInUSD);
```

### 6. Handle Settlement Delays

```javascript
// Don't block on settlement
async function handlePayment(req, res) {
  // Verify signature (fast)
  const verified = await facilitator.verify(req.payment);

  if (verified) {
    // Return resource immediately
    res.json({ data: 'result' });

    // Settle asynchronously (blockchain confirmation)
    facilitator.settle(req.payment).catch(err => {
      console.error('Settlement failed:', err);
      // Implement retry logic
    });
  }
}
```

### 7. Implement Refund Logic

```javascript
async function refundPayment(paymentId: string, reason: string) {
  // Issue refund on-chain
  const tx = await facilitator.refund({
    paymentId,
    reason,
    amount: originalAmount,
  });

  // Log refund
  await db.refunds.create({
    paymentId,
    txHash: tx.hash,
    reason,
    timestamp: Date.now(),
  });
}
```

### 8. Use Webhook for Settlement Updates

```javascript
app.post('/webhooks/x402', express.json(), (req, res) => {
  const { paymentId, status, txHash } = req.body;

  if (status === 'confirmed') {
    console.log(`Payment ${paymentId} confirmed: ${txHash}`);
    // Update database
  } else if (status === 'failed') {
    console.error(`Payment ${paymentId} failed`);
    // Handle failure
  }

  res.sendStatus(200);
});
```

### 9. Secure Private Keys

```javascript
// ❌ WRONG: Hardcoded keys
const client = createX402Client({
  privateKey: '0x1234...'
});

// ✅ CORRECT: Environment variables
const client = createX402Client({
  privateKey: process.env.PRIVATE_KEY
});

// ✅ BETTER: Key management service
import { getSecret } from './kms';
const privateKey = await getSecret('x402-payment-key');
```

### 10. Test End-to-End on Testnet

```bash
# Use testnet tokens
NETWORK=base-sepolia \
PRIVATE_KEY=$TEST_KEY \
npm run test:e2e
```

**Test scenarios**:
- Valid payment succeeds
- Invalid signature rejected
- Insufficient amount rejected
- Replay attack prevented
- Network failure handling

---

## COINBASE FACILITATOR

### Pricing

- **Free Tier**: 1,000 transactions/month
- **Paid**: $0.001 per transaction (after free tier)

### API Endpoints

**Production**: `https://facilitator.coinbase.com`

**Endpoints**:
- `POST /verify` - Verify payment signature
- `POST /settle` - Submit transaction to blockchain
- `GET /status/:paymentId` - Check payment status

### Authentication

```javascript
const facilitator = createFacilitator({
  url: 'https://facilitator.coinbase.com',
  apiKey: process.env.COINBASE_API_KEY, // Get from Coinbase Developer Portal
});
```

---

## RESOURCES

### Official Documentation

- **Main Site**: https://www.x402.org/
- **Coinbase Docs**: https://docs.cdp.coinbase.com/x402/welcome
- **GitHub Repository**: https://github.com/coinbase/x402
- **V2 Announcement**: https://www.x402.org/writing/x402-v2-launch
- **Whitepaper**: https://www.x402.org/x402-whitepaper.pdf

### Community & Development

- **GitHub**: https://github.com/coinbase/x402 (5.4k stars)
- **Discord**: [Join x402 Discord]
- **Twitter**: [@x402protocol]

### Related Standards

- **CAIP-2**: Chain Agnostic Improvement Proposals (Chain IDs)
- **SLIP-0044**: Coin type indices for HD wallets
- **EIP-155**: Simple replay attack protection

### Libraries & Tools

- **TypeScript**: `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/fetch`
- **Python**: `x402`
- **Go**: `github.com/coinbase/x402/go`
- **Java**: Available in x402 repository

### Example Applications

- **Weather API**: https://github.com/coinbase/x402/examples/weather
- **AI Agent**: https://github.com/coinbase/x402/examples/agent
- **MCP Server**: https://zuplo.com/blog/mcp-api-payments-with-x402

---

## VERSION HISTORY

- **February 2026**: Documentation created
- **January 2026**: x402 V2 launched (major upgrade)
- **May 2025**: x402 V1 launched
- **Current Protocol**: V2 with backward compatibility to V1

---

## QUICK REFERENCE

### Header Names

| Version | Request Header | Response Header |
|---------|---------------|-----------------|
| V2 (current) | `PAYMENT-SIGNATURE` | `PAYMENT-RESPONSE` |
| V2 (required) | - | `PAYMENT-REQUIRED` |
| V1 (deprecated) | `X-Payment-Signature` | `X-Payment-Response` |

### Network IDs

| Network | CAIP-2 ID |
|---------|-----------|
| Ethereum | `eip155:1` |
| Base | `eip155:8453` |
| Optimism | `eip155:10` |
| Arbitrum | `eip155:42161` |
| Polygon | `eip155:137` |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

### Token Decimals

| Token | Decimals | 1 Token = |
|-------|----------|-----------|
| USDC | 6 | 1000000 |
| USDT | 6 | 1000000 |
| DAI | 18 | 1000000000000000000 |
| ETH | 18 | 1000000000000000000 |

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Payment successful, resource returned |
| 402 | Payment required (with PAYMENT-REQUIRED header) |
| 400 | Invalid payment payload |
| 401 | Payment verification failed |
| 402 | Insufficient payment amount |
