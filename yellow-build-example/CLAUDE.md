# Yellow Network Payment App

## Project Overview
A proof-of-concept payment application using Yellow Network's state channels for off-chain USDC transactions. Built following the [Yellow Network Quick Start Guide](https://docs.yellow.org/docs/build/quick-start/).

## Tech Stack
- **Build Tool:** Vite 5.0.0
- **Language:** JavaScript (ES6+ modules)
- **SDK:** @erc7824/nitrolite (v0.5.3) - Yellow Network SDK
- **Wallet:** MetaMask integration via `window.ethereum`

## Key Files
- `src/app.js` - Main application class (`YellowPaymentApp`)
- `index.html` - UI with embedded styles
- `vite.config.js` - Dev server on port 3000

## Running the Project
```bash
npm install
npm run dev
```

## Yellow Network Integration
- **WebSocket:** `wss://clearnet-sandbox.yellow.com/ws` (sandbox)
- **Protocol:** Nitro RPC 0.4
- **Auth Flow:** auth_request → auth_challenge → auth_verify

## Known Issues
See `BUGS.md` for documented issues and solutions around:
- Message signing format (must JSON.stringify payload)
- Auth parameters (address, session_key, expires_at in ms)
- auth_request is public (no signature required)

## Important Notes
- Balances are in microunits (1 USDC = 1,000,000 microunits)
- Sessions require a partner address to create payment channels
