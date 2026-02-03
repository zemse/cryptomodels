import {
  createAuthRequestMessage,
  createGetLedgerBalancesMessage,
  createTransferMessage,
  createCreateChannelMessage,
  createCloseChannelMessage,
  createResizeChannelMessage,
  createGetChannelsMessageV2,
  NitroliteRPC,
  generateRequestId,
  getCurrentTimestamp,
  EIP712AuthTypes,
  createECDSAMessageSigner
} from '@erc7824/nitrolite';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Supported chains with their token addresses
const CHAIN_CONFIG = {
  11155111: { name: 'Ethereum Sepolia', token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb' },
  84532: { name: 'Base Sepolia', token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb' },
  80002: { name: 'Polygon Amoy', token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb' },
  59141: { name: 'Linea Sepolia', token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb' }
};

// Yellow Network WebSocket endpoints
const WS_ENDPOINTS = {
  production: 'wss://clearnet.yellow.com/ws',
  sandbox: 'wss://clearnet-sandbox.yellow.com/ws'
};

// Use sandbox endpoint for development
const WS_URL = WS_ENDPOINTS.sandbox;

// EIP-712 domain - name is the application from auth_request (docs.yellow.org)
// Only the 'name' field is used in the domain

class YellowPaymentApp {
  constructor() {
    this.ws = null;
    this.messageSigner = null;
    this.userAddress = null;
    this.sessionId = null;
    this.balance = 0;
    this.ledgerBalance = 0;  // Actual balance from Clearnode
    this.isAuthenticated = false;
    this.pendingAuthResolve = null;
    this.pendingRequests = new Map();
    // Store auth params for EIP-712 signing
    this.authParams = null;
    // Session key for signing requests (raw ECDSA without prefix)
    this.sessionKeyPrivate = null;
    this.sessionKeyAddress = null;
    // Channels list
    this.channels = [];
    // Pending channel to fund after creation
    this.pendingChannelFund = null;

    this.initUI();
  }

  initUI() {
    // DOM elements
    this.elements = {
      wsStatus: document.getElementById('wsStatus'),
      wsStatusText: document.getElementById('wsStatusText'),
      walletStatus: document.getElementById('walletStatus'),
      walletStatusText: document.getElementById('walletStatusText'),
      userAddress: document.getElementById('userAddress'),
      balance: document.getElementById('balance'),
      connectBtn: document.getElementById('connectBtn'),
      createSessionBtn: document.getElementById('createSessionBtn'),
      sendPaymentBtn: document.getElementById('sendPaymentBtn'),
      partnerAddress: document.getElementById('partnerAddress'),
      initialAmount: document.getElementById('initialAmount'),
      recipientAddress: document.getElementById('recipientAddress'),
      paymentAmount: document.getElementById('paymentAmount'),
      activityLog: document.getElementById('activityLog'),
      // Channel management
      chainSelect: document.getElementById('chainSelect'),
      channelAmount: document.getElementById('channelAmount'),
      createChannelBtn: document.getElementById('createChannelBtn'),
      refreshChannelsBtn: document.getElementById('refreshChannelsBtn'),
      channelsList: document.getElementById('channelsList')
    };

    // Event listeners
    this.elements.connectBtn.addEventListener('click', () => this.connectWallet());
    this.elements.createSessionBtn.addEventListener('click', () => this.createSession());
    this.elements.sendPaymentBtn.addEventListener('click', () => this.sendPayment());
    this.elements.createChannelBtn.addEventListener('click', () => this.createChannel());
    this.elements.refreshChannelsBtn.addEventListener('click', () => this.getChannels());

    // Initialize WebSocket connection
    this.connectWebSocket();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span style="color: #888">[${timestamp}]</span> ${message}`;
    this.elements.activityLog.prepend(entry);
    console.log(`[${type.toUpperCase()}]`, message);
  }

  connectWebSocket() {
    this.log('Connecting to Yellow Network...');

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.elements.wsStatus.classList.add('connected');
      this.elements.wsStatus.classList.remove('disconnected');
      this.elements.wsStatusText.textContent = 'Connected to Yellow Network';
      this.log('Connected to Yellow Network!');
    };

    this.ws.onclose = () => {
      this.elements.wsStatus.classList.remove('connected');
      this.elements.wsStatus.classList.add('disconnected');
      this.elements.wsStatusText.textContent = 'Disconnected';
      this.isAuthenticated = false;
      this.log('Disconnected from Yellow Network');

      // Attempt to reconnect after 3 seconds
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      this.log(`Connection error: ${error.message || 'Unknown error'}`, 'error');
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  handleMessage(data) {
    console.log('Raw WebSocket message:', data);

    let parsed;
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      this.log(`Non-JSON message: ${data.toString().slice(0, 100)}`);
      return;
    }

    console.log('Parsed JSON:', parsed);

    if (parsed.res) {
      const [requestId, method, responseData, timestamp] = parsed.res;
      console.log(`Response - Method: ${method}, RequestId: ${requestId}`);

      if (method === 'error') {
        const errorMsg = responseData?.error || JSON.stringify(responseData);
        this.log(`Error: ${errorMsg}`, 'error');
        return;
      }

      switch (method) {
        case 'auth_challenge':
          this.handleAuthChallenge(responseData, requestId);
          break;

        case 'auth_verify':
          this.log('Authentication successful!');
          this.isAuthenticated = true;
          if (this.pendingAuthResolve) {
            this.pendingAuthResolve();
            this.pendingAuthResolve = null;
          }
          break;

        case 'get_config':
          this.log(`Config received: ${JSON.stringify(responseData).slice(0, 200)}`);
          break;

        case 'get_ledger_balances':
          this.handleBalanceResponse(responseData);
          break;

        case 'create_app_session':
          this.handleSessionCreated(responseData);
          break;

        case 'close_app_session':
          this.log('Session closed');
          break;

        case 'transfer':
          this.handleTransferResponse(responseData);
          break;

        case 'create_channel':
          this.handleCreateChannelResponse(responseData);
          break;

        case 'get_channels':
          this.handleGetChannelsResponse(responseData);
          break;

        case 'close_channel':
          this.handleCloseChannelResponse(responseData);
          break;

        case 'resize_channel':
          this.handleResizeChannelResponse(responseData);
          break;

        case 'bu':  // Balance update notification from server
          this.handleBalanceUpdate(responseData);
          break;

        default:
          this.log(`Response [${method}]: ${JSON.stringify(responseData).slice(0, 100)}`);
      }
    } else if (parsed.req) {
      const [requestId, method, params, timestamp] = parsed.req;
      this.log(`Server request [${method}]: ${JSON.stringify(params).slice(0, 100)}`);
    } else {
      this.log(`Message: ${JSON.stringify(parsed).slice(0, 100)}`);
    }
  }

  async handleAuthChallenge(responseData, requestId) {
    try {
      this.log('Received auth challenge, verifying...');
      console.log('Auth challenge data:', responseData);

      // Extract challenge from response
      let challengeMessage;
      if (responseData?.challenge_message) {
        challengeMessage = responseData.challenge_message;
      } else if (Array.isArray(responseData) && responseData[0]?.challenge_message) {
        challengeMessage = responseData[0].challenge_message;
      } else {
        challengeMessage = JSON.stringify(responseData);
      }

      console.log('Challenge message:', challengeMessage);

      // Create EIP-712 typed data message for signing (per Yellow Network docs)
      // The domain name is the 'application' value from auth_request
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' }
          ],
          ...EIP712AuthTypes
        },
        primaryType: 'Policy',
        domain: {
          name: this.authParams.application  // 'clearnode' from auth_request
        },
        message: {
          challenge: challengeMessage,
          scope: this.authParams.scope || '',
          wallet: this.authParams.address,  // Already checksummed from auth_request
          session_key: this.authParams.session_key,  // Already checksummed
          expires_at: this.authParams.expires_at,  // uint64 in SECONDS (not ms)
          allowances: this.authParams.allowances || []
        }
      };

      console.log('EIP-712 typed data:', JSON.stringify(typedData, null, 2));

      // Sign using eth_signTypedData_v4 with main wallet
      const signature = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [this.userAddress, JSON.stringify(typedData)]
      });

      console.log('EIP-712 signature:', signature);

      // Build auth_verify message manually
      const verifyRequestId = generateRequestId();
      const timestamp = getCurrentTimestamp();
      const verifyMessage = {
        req: [verifyRequestId, 'auth_verify', { challenge: challengeMessage }, timestamp],
        sig: [signature]
      };

      console.log('Sending auth_verify:', JSON.stringify(verifyMessage));
      this.ws.send(JSON.stringify(verifyMessage));

    } catch (error) {
      this.log(`Auth verification failed: ${error.message}`, 'error');
      console.error('Auth error:', error);
    }
  }

  handleBalanceResponse(data) {
    console.log('Balance response:', data);
    if (data && typeof data === 'object') {
      const balances = data.ledger_balances || [];
      if (balances.length > 0) {
        // Sum up all balances (or show the first one)
        let totalBalance = 0;
        balances.forEach(b => {
          const amount = parseInt(b.amount || '0', 10);
          totalBalance += amount;
          this.log(`Balance: ${(amount / 1_000_000).toFixed(2)} ${b.asset}`);
        });
        this.ledgerBalance = totalBalance;
        this.balance = totalBalance;
        this.updateBalanceDisplay();
      } else {
        this.log('No balance found. Deposit funds to get started.');
        this.ledgerBalance = 0;
      }
    }
  }

  // Handle balance update notifications (method: 'bu')
  handleBalanceUpdate(data) {
    console.log('Balance update notification:', data);
    if (data && typeof data === 'object') {
      const updates = data.balance_updates || [];
      if (updates.length > 0) {
        let totalBalance = 0;
        updates.forEach(b => {
          const amount = parseInt(b.amount || '0', 10);
          totalBalance += amount;
          this.log(`Balance updated: ${(amount / 1_000_000).toFixed(2)} ${b.asset}`);
        });
        this.ledgerBalance = totalBalance;
        this.balance = totalBalance;
        this.updateBalanceDisplay();
      }
    }
  }

  handleSessionCreated(data) {
    console.log('Session created data:', data);
    if (data?.app_session_id) {
      this.sessionId = data.app_session_id;
      this.log(`Session created: ${this.sessionId}`);
      this.elements.sendPaymentBtn.disabled = false;
    }
  }

  handleTransferResponse(data) {
    console.log('Transfer response:', data);
    if (data?.transactions && data.transactions.length > 0) {
      const tx = data.transactions[0];
      const amount = (parseInt(tx.amount) / 1_000_000).toFixed(2);
      this.log(`Transfer successful! ${amount} ${tx.asset} to ${tx.to_account.slice(0, 6)}...${tx.to_account.slice(-4)} (TX #${tx.id})`);
      // Refresh balances after transfer
      this.getBalances();
    } else if (data?.success || data?.tx_id) {
      this.log(`Transfer successful! TX: ${data.tx_id || 'completed'}`);
      this.getBalances();
    } else {
      this.log(`Transfer response: ${JSON.stringify(data)}`);
    }
  }

  async connectWallet() {
    if (!window.ethereum) {
      this.log('Please install MetaMask!', 'error');
      alert('Please install MetaMask to use this application');
      return;
    }

    try {
      this.log('Requesting wallet connection...');

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      this.userAddress = accounts[0];

      this.elements.walletStatus.classList.add('connected');
      this.elements.walletStatusText.textContent = 'Wallet connected';
      this.elements.userAddress.textContent = this.userAddress;
      this.elements.connectBtn.textContent = 'Authenticating...';

      this.log(`Wallet connected: ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);

      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          this.log('Wallet disconnected');
          location.reload();
        } else {
          // Account changed - need to re-authenticate
          this.log('Account changed - please reconnect');
          location.reload();
        }
      });

      await this.authenticate();

      this.elements.connectBtn.textContent = 'Connected';
      this.elements.connectBtn.disabled = true;
      this.elements.createSessionBtn.disabled = false;
      this.elements.createChannelBtn.disabled = false;
      this.elements.refreshChannelsBtn.disabled = false;

      await this.getBalances();
      await this.getChannels();

    } catch (error) {
      this.log(`Failed to connect wallet: ${error.message}`, 'error');
      this.elements.connectBtn.textContent = 'Connect Wallet';
    }
  }

  async authenticate() {
    return new Promise(async (resolve, reject) => {
      try {
        this.log('Authenticating with Clearnode...');
        this.pendingAuthResolve = resolve;

        // Generate a session key for signing requests (raw ECDSA)
        // This allows browser wallets to work with the SDK's signature requirements
        this.sessionKeyPrivate = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(this.sessionKeyPrivate);
        this.sessionKeyAddress = sessionAccount.address;

        // Create ECDSA signer with session key for all subsequent requests
        this.messageSigner = createECDSAMessageSigner(this.sessionKeyPrivate);

        this.log(`Session key generated: ${this.sessionKeyAddress.slice(0, 6)}...${this.sessionKeyAddress.slice(-4)}`);

        // 24 hours from now in SECONDS (Go server uses time.Unix which expects seconds)
        const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

        // Store auth params for use in EIP-712 signing during auth_verify
        // Use checksummed addresses for consistency
        const checksummedAddress = getAddress(this.userAddress);
        const checksummedSessionKey = getAddress(this.sessionKeyAddress);
        this.authParams = {
          address: checksummedAddress,
          session_key: checksummedSessionKey,  // Use session key, not main wallet
          application: 'clearnode',
          allowances: [],
          expires_at: expiresAt,
          scope: ''
        };

        // Use SDK's createAuthRequestMessage
        const authMessage = await createAuthRequestMessage({
          ...this.authParams,
          expires_at: BigInt(expiresAt)  // SDK expects BigInt
        });
        console.log('Auth request message:', authMessage);

        this.ws.send(authMessage);

        setTimeout(() => {
          if (!this.isAuthenticated) {
            this.pendingAuthResolve = null;
            reject(new Error('Authentication timeout'));
          }
        }, 15000);  // 15 second timeout
      } catch (error) {
        reject(error);
      }
    });
  }

  async getBalances() {
    try {
      const balanceMessage = await createGetLedgerBalancesMessage(
        this.messageSigner,
        this.userAddress
      );
      console.log('Balance request:', balanceMessage);
      this.ws.send(balanceMessage);
    } catch (error) {
      this.log(`Failed to get balances: ${error.message}`, 'error');
    }
  }

  async createSession() {
    const partnerAddress = this.elements.partnerAddress.value.trim();
    const initialAmount = parseFloat(this.elements.initialAmount.value);

    if (!partnerAddress || !partnerAddress.startsWith('0x')) {
      this.log('Please enter a valid partner address', 'error');
      return;
    }

    if (isNaN(initialAmount) || initialAmount <= 0) {
      this.log('Please enter a valid initial amount', 'error');
      return;
    }

    if (!this.isAuthenticated) {
      this.log('Please wait for authentication to complete', 'error');
      return;
    }

    // Check if we have a balance first
    if (this.ledgerBalance <= 0) {
      this.log('No balance available. Please deposit funds first.', 'error');
      this.log('To deposit: send ytest.usd tokens to the custody contract on testnet.', 'info');
      return;
    }

    try {
      this.log('Creating transfer...');

      const amountInMicrounits = Math.floor(initialAmount * 1_000_000).toString();

      // Use transfer API - allocations is an array of {asset, amount}
      const transferParams = {
        destination: partnerAddress,
        allocations: [{
          asset: 'ytest.usd',  // Sandbox testnet token
          amount: amountInMicrounits
        }]
      };

      const transferMessage = await createTransferMessage(
        this.messageSigner,
        transferParams
      );

      console.log('Transfer message:', transferMessage);
      this.ws.send(transferMessage);

      this.log(`Transfer request sent: ${initialAmount} to ${partnerAddress.slice(0, 6)}...${partnerAddress.slice(-4)}`);
      this.elements.recipientAddress.value = partnerAddress;

    } catch (error) {
      this.log(`Failed to create transfer: ${error.message}`, 'error');
    }
  }

  async sendPayment() {
    const recipient = this.elements.recipientAddress.value.trim();
    const amount = parseFloat(this.elements.paymentAmount.value);

    if (!recipient || !recipient.startsWith('0x')) {
      this.log('Please enter a valid recipient address', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);

    if (amountInMicrounits > this.balance) {
      this.log('Insufficient balance', 'error');
      return;
    }

    try {
      this.log(`Sending ${amount} USDC to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`);

      const paymentData = {
        type: 'payment',
        amount: amountInMicrounits.toString(),
        recipient,
        timestamp: Date.now()
      };

      const requestId = generateRequestId();
      const timestamp = getCurrentTimestamp();
      const payload = [requestId, 'payment', paymentData, timestamp];

      const signature = await this.messageSigner(payload);

      const signedPayment = {
        req: payload,
        sig: [signature]
      };

      this.ws.send(JSON.stringify(signedPayment));

      this.balance -= amountInMicrounits;
      this.updateBalanceDisplay();

      this.log(`Payment sent: ${amount} USDC`);
      this.elements.paymentAmount.value = '';

    } catch (error) {
      this.log(`Failed to send payment: ${error.message}`, 'error');
    }
  }

  updateBalance(amount) {
    this.balance += amount;
    this.updateBalanceDisplay();
  }

  updateBalanceDisplay() {
    const displayAmount = (this.balance / 1_000_000).toFixed(2);
    this.elements.balance.textContent = `${displayAmount} USDC`;
  }

  // ============ Channel Management ============

  async createChannel() {
    const chainId = parseInt(this.elements.chainSelect.value);
    const amount = parseFloat(this.elements.channelAmount.value);

    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      this.log('Insufficient balance', 'error');
      return;
    }

    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) {
      this.log('Invalid chain selected', 'error');
      return;
    }

    try {
      this.log(`Creating channel on ${chainConfig.name} with ${amount} USDC...`);

      // Store the amount to allocate after channel is created
      this.pendingChannelFund = {
        amount: amountInMicrounits,
        chainId: chainId
      };

      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: chainId,
          token: chainConfig.token
        }
      );

      console.log('Create channel message:', channelMessage);
      this.ws.send(channelMessage);

    } catch (error) {
      this.log(`Failed to create channel: ${error.message}`, 'error');
      this.pendingChannelFund = null;
    }
  }

  async resizeChannel(channelId, allocateAmount) {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      this.log(`Allocating ${(allocateAmount / 1_000_000).toFixed(2)} USDC to channel...`);

      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          allocate_amount: BigInt(allocateAmount),
          funds_destination: this.userAddress
        }
      );

      console.log('Resize channel message:', resizeMessage);
      this.ws.send(resizeMessage);

    } catch (error) {
      this.log(`Failed to resize channel: ${error.message}`, 'error');
    }
  }

  async getChannels() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      this.log('Fetching channels...');

      // Use V2 which doesn't require signing
      const channelsMessage = createGetChannelsMessageV2(this.userAddress);
      console.log('Get channels message:', channelsMessage);
      this.ws.send(channelsMessage);

    } catch (error) {
      this.log(`Failed to get channels: ${error.message}`, 'error');
    }
  }

  async closeChannel(channelId) {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      this.log(`Closing channel ${channelId.slice(0, 10)}...`);

      const closeMessage = await createCloseChannelMessage(
        this.messageSigner,
        channelId,
        this.userAddress  // funds_destination - send to our wallet
      );

      console.log('Close channel message:', closeMessage);
      this.ws.send(closeMessage);

    } catch (error) {
      this.log(`Failed to close channel: ${error.message}`, 'error');
    }
  }

  handleCreateChannelResponse(data) {
    console.log('Create channel response:', data);
    if (data?.channel_id) {
      const channelIdShort = data.channel_id.slice(0, 10);
      this.log(`Channel created: ${channelIdShort}...`);

      // Check if channel needs on-chain deposit first
      const state = data.state;
      if (state?.intent === 1 && state?.allocations?.[0]?.amount === "0") {
        this.log('Channel pending - needs on-chain deposit to custody contract.');
        this.log(`Chain: Sepolia | Custody: 0x019B65A265EB3363822f2752141b3dF16131b262`);
        this.log('After depositing on-chain, the channel will be ready for use.');
        this.pendingChannelFund = null;
        // Store channel for later use
        this.pendingChannelId = data.channel_id;
        this.getChannels();
      } else if (this.pendingChannelFund) {
        // Channel is open, can resize
        const { amount } = this.pendingChannelFund;
        this.pendingChannelFund = null;
        this.resizeChannel(data.channel_id, amount);
      } else {
        this.log('Channel created. Use resize to add funds.');
        this.getChannels();
      }
    } else {
      this.log(`Channel response: ${JSON.stringify(data)}`);
      this.pendingChannelFund = null;
    }
  }

  handleGetChannelsResponse(data) {
    console.log('Get channels response:', data);
    this.channels = data?.channels || [];
    this.renderChannelsList();
  }

  handleResizeChannelResponse(data) {
    console.log('Resize channel response:', data);
    if (data?.channel_id || data?.success) {
      this.log('Channel funded! Funds allocated to channel.');
      this.log('Close the channel to withdraw funds on-chain.');
      // Refresh channels and balances
      this.getChannels();
      this.getBalances();
    } else {
      this.log(`Resize response: ${JSON.stringify(data)}`);
    }
  }

  handleCloseChannelResponse(data) {
    console.log('Close channel response:', data);
    if (data?.success || data?.channel_id) {
      this.log('Channel closed! Funds will be sent to your wallet on-chain.');
      this.log('Check your wallet on the testnet for the withdrawn tokens.');
      // Refresh channels and balances
      this.getChannels();
      this.getBalances();
    } else {
      this.log(`Close channel response: ${JSON.stringify(data)}`);
    }
  }

  renderChannelsList() {
    const container = this.elements.channelsList;

    if (this.channels.length === 0) {
      container.innerHTML = '<p style="color: #888;">No channels found. Create one to withdraw funds on-chain.</p>';
      return;
    }

    const html = this.channels.map(ch => {
      const chainName = CHAIN_CONFIG[ch.chain_id]?.name || `Chain ${ch.chain_id}`;
      const amount = ch.amount ? (parseInt(ch.amount) / 1_000_000).toFixed(2) : '0.00';
      const status = ch.status || 'unknown';
      const channelIdShort = ch.channel_id ? ch.channel_id.slice(0, 10) + '...' : 'N/A';

      return `
        <div style="background: rgba(0,0,0,0.2); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${chainName}</strong><br>
              <span style="color: #888; font-size: 0.8rem;">${channelIdShort}</span><br>
              <span style="color: #4caf50;">${amount} USDC</span>
              <span style="color: #888;"> (${status})</span>
            </div>
            ${status === 'open' ? `
              <button onclick="window.app.closeChannel('${ch.channel_id}')"
                style="background: #f44336; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                Close & Withdraw
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }
}

// Initialize app only once
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new YellowPaymentApp();
  });
} else {
  window.app = new YellowPaymentApp();
}
