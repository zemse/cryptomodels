import { sepolia, baseSepolia, mainnet, base } from 'viem/chains';

// ============ TESTNET CONFIGURATION ============
export const TESTNET_CONFIG = {
  name: 'testnet',
  displayName: 'Testnet',
  emoji: '🧪',
  wsUrl: 'wss://clearnet-sandbox.yellow.com/ws',
  asset: 'ytest.usd',

  chains: {
    // Ethereum Sepolia
    11155111: {
      name: 'Ethereum Sepolia',
      token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
      custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
      adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
      chain: sepolia
    },
    // Base Sepolia
    84532: {
      name: 'Base Sepolia',
      token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
      custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
      adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
      chain: baseSepolia
    },
    // Polygon Amoy
    80002: {
      name: 'Polygon Amoy',
      token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
      custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
      adjudicator: null,
      chain: null
    },
    // Linea Sepolia
    59141: {
      name: 'Linea Sepolia',
      token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
      custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
      adjudicator: null,
      chain: null
    }
  },

  // Session key expiry: 24 hours for testnet
  sessionExpiryHours: 24,

  // UI colors
  primaryColor: '#4a90d9',
  warningBanner: false
};

// ============ MAINNET CONFIGURATION ============
export const MAINNET_CONFIG = {
  name: 'mainnet',
  displayName: 'Mainnet',
  emoji: '🚀',
  wsUrl: 'wss://clearnet.yellow.com/ws',
  asset: 'usdc',

  chains: {
    // Ethereum Mainnet
    1: {
      name: 'Ethereum',
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Circle USDC
      custody: '0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f',
      adjudicator: '0x14980dF216722f14c42CA7357b06dEa7eB408b10',
      chain: mainnet,
      rpcUrl: import.meta.env.VITE_ETHEREUM_MAINNET_RPC_URL
    },
    // Base Mainnet
    8453: {
      name: 'Base',
      token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      custody: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6',
      adjudicator: '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C',
      chain: base,
      rpcUrl: import.meta.env.VITE_BASE_MAINNET_RPC_URL
    }
  },

  // Session key expiry: 1 hour for mainnet (more secure)
  sessionExpiryHours: 1,

  // UI colors
  primaryColor: '#4caf50',
  warningBanner: true
};

// Helper to get config by environment name
export function getConfig(environment) {
  return environment === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;
}

// Get available chain IDs for an environment
export function getChainIds(environment) {
  const config = getConfig(environment);
  return Object.keys(config.chains).map(id => parseInt(id));
}

// Default chain for each environment
export const DEFAULT_CHAINS = {
  testnet: 11155111,  // Sepolia
  mainnet: 1          // Ethereum
};
