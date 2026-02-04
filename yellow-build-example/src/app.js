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
  createECDSAMessageSigner,
  NitroliteService,
  getChannelId,
  getPackedState
} from '@erc7824/nitrolite';
import { getAddress, createPublicClient, createWalletClient, custom, http, toHex, keccak256 } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount, signMessage } from 'viem/accounts';

// Supported chains with their token and custody addresses
const CHAIN_CONFIG = {
  11155111: {
    name: 'Ethereum Sepolia',
    token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
    custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
    chain: sepolia
  },
  84532: {
    name: 'Base Sepolia',
    token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
    custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
    chain: baseSepolia
  },
  80002: {
    name: 'Polygon Amoy',
    token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
    custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
    chain: null
  },
  59141: {
    name: 'Linea Sepolia',
    token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
    custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
    chain: null
  }
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
    // Viem clients for on-chain operations
    this.publicClient = null;
    this.walletClient = null;
    this.nitroliteService = null;
    // Track on-chain channels for closing
    this.onChainChannels = new Map(); // channelId -> { channel, chainId }
    // Store server broadcast channel data (for recovering stuck channels)
    this.serverChannels = new Map(); // channelId -> channel data from server

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
      checkCustodyBtn: document.getElementById('checkCustodyBtn'),
      withdrawToWalletBtn: document.getElementById('withdrawToWalletBtn'),
      channelsList: document.getElementById('channelsList')
    };

    // Event listeners
    this.elements.connectBtn.addEventListener('click', () => this.connectWallet());
    this.elements.createSessionBtn.addEventListener('click', () => this.createSession());
    this.elements.sendPaymentBtn.addEventListener('click', () => this.sendPayment());
    this.elements.createChannelBtn.addEventListener('click', () => this.createChannel());
    this.elements.refreshChannelsBtn.addEventListener('click', () => this.getChannels());
    this.elements.checkCustodyBtn.addEventListener('click', () => this.checkCustodyBalance());
    this.elements.withdrawToWalletBtn.addEventListener('click', () => this.withdrawToWallet());

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

    this.ws.onopen = async () => {
      this.elements.wsStatus.classList.add('connected');
      this.elements.wsStatus.classList.remove('disconnected');
      this.elements.wsStatusText.textContent = 'Connected to Yellow Network';
      this.log('Connected to Yellow Network!');

      // Auto re-authenticate if wallet was previously connected
      if (this.userAddress && !this.isAuthenticated) {
        this.log('Re-authenticating...');
        this.elements.connectBtn.textContent = 'Authenticating...';
        try {
          await this.authenticate();
          this.log('Re-authenticated successfully!');
          // Restore UI state
          this.elements.connectBtn.textContent = 'Connected';
          this.elements.connectBtn.disabled = true;
          this.elements.createSessionBtn.disabled = false;
          this.elements.createChannelBtn.disabled = false;
          this.elements.refreshChannelsBtn.disabled = false;
          this.elements.checkCustodyBtn.disabled = false;
          this.elements.withdrawToWalletBtn.disabled = false;
          // Refresh data after re-authentication
          await this.getBalances();
          await this.getChannels();
        } catch (error) {
          this.log(`Re-authentication failed: ${error.message}`, 'error');
          // Update UI to show need to reconnect
          this.elements.connectBtn.textContent = 'Reconnect';
          this.elements.connectBtn.disabled = false;
        }
      }
    };

    this.ws.onclose = () => {
      this.elements.wsStatus.classList.remove('connected');
      this.elements.wsStatus.classList.add('disconnected');
      this.elements.wsStatusText.textContent = 'Disconnected';
      this.isAuthenticated = false;
      this.log('Disconnected from Yellow Network');

      // Update button to show reconnecting state
      if (this.userAddress) {
        this.elements.connectBtn.textContent = 'Reconnecting...';
        this.elements.connectBtn.disabled = true;
      }

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

        // Handle "channel already exists" error - extract channel ID and use it
        if (errorMsg.includes('an open channel with broker already exists:') && this.pendingWithdrawal) {
          const match = errorMsg.match(/already exists: (0x[a-fA-F0-9]+)/);
          if (match) {
            const existingChannelId = match[1];
            this.log(`Using existing channel: ${existingChannelId.slice(0, 10)}...`);
            const { amount } = this.pendingWithdrawal;
            this.pendingWithdrawal = null;
            // Use the existing channel for resize
            this.requestWithdrawalResize(existingChannelId, amount);
          }
        }
        return;
      }

      switch (method) {
        case 'auth_challenge':
          this.handleAuthChallenge(responseData, requestId);
          break;

        case 'auth_verify':
          this.log('Authentication successful!');
          this.isAuthenticated = true;
          // Clear the auth timeout
          if (this.authTimeoutId) {
            clearTimeout(this.authTimeoutId);
            this.authTimeoutId = null;
          }
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

        case 'channels':  // Server broadcast of all channels (includes stuck ones)
          this.handleChannelsBroadcast(responseData);
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

      // Setup viem clients for on-chain operations
      this.publicClient = createPublicClient({
        chain: sepolia,
        transport: http()
      });
      this.walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
        account: this.userAddress
      });

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
      this.elements.checkCustodyBtn.disabled = false;
      this.elements.withdrawToWalletBtn.disabled = false;

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

        // Store timeout ID so we can clear it on success
        this.authTimeoutId = setTimeout(() => {
          if (!this.isAuthenticated) {
            this.pendingAuthResolve = null;
            reject(new Error('Authentication timeout'));
          }
        }, 60000);  // 60 second timeout (MetaMask signing can take time)
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

  // DEPRECATED: These methods were part of the complex 5-step withdrawal flow
  // Now using 4-step flow: create → allocate → submit on-chain → close
  // Kept for reference but no longer used

  /*
  // Allocate funds from off-chain ledger to channel (OLD step 2 of 5-step withdrawal flow)
  async allocateFundsToChannel(channelId, amount) {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          allocate_amount: BigInt(amount),  // Allocate to channel from ledger
          funds_destination: this.userAddress
        }
      );

      console.log('Allocate funds message:', resizeMessage);
      this.ws.send(resizeMessage);

    } catch (error) {
      this.log(`Failed to allocate funds: ${error.message}`, 'error');
      this.pendingWithdrawal = null;
    }
  }

  // Resize negatively to move funds from channel to custody (OLD step 3 of 5-step withdrawal flow)
  async resizeNegativeForWithdrawal(channelId, amount) {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      this.log(`Step 3/5: Resizing negatively to move ${(amount / 1_000_000).toFixed(2)} USDC to custody...`);

      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          resize_amount: BigInt(-amount),  // NEGATIVE to reduce channel, move to custody
          funds_destination: this.userAddress
        }
      );

      // Mark that we're expecting a signed state for custody submission
      this.pendingWithdrawal.step = 'resize_negative';
      this.pendingWithdrawal.expectStateUpdate = true;

      console.log('Negative resize message:', resizeMessage);
      this.ws.send(resizeMessage);

    } catch (error) {
      this.log(`Failed to resize negatively: ${error.message}`, 'error');
      this.pendingWithdrawal = null;
    }
  }
  */

  async withdrawToWallet() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    const amount = parseFloat(this.elements.channelAmount.value);
    if (!amount || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      this.log(`Insufficient balance. Available: ${(this.ledgerBalance / 1_000_000).toFixed(2)} USDC`, 'error');
      return;
    }

    const chainId = parseInt(this.elements.chainSelect.value);
    const chainConfig = CHAIN_CONFIG[chainId];

    if (!chainConfig) {
      this.log('Invalid chain selected', 'error');
      return;
    }

    try {
      this.log(`Starting withdrawal: ${amount} USDC to ${chainConfig.name}`);
      this.log('Step 1/4: Creating off-chain channel...');

      // Store withdrawal context - 4-step flow:
      // 1. create_channel (off-chain) → get channel config
      // 2. resize with allocate_amount (off-chain) → get state with allocations
      // 3. submit on-chain with allocated state → lock funds in custody
      // 4. close + withdraw (on-chain) → funds to wallet
      this.pendingWithdrawal = {
        step: 'create_channel',
        amount: amountInMicrounits,
        chainId,
        chainConfig
      };

      // Step 1: Create channel (no initial deposit needed)
      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: chainId,
          token: chainConfig.token
        }
      );

      this.ws.send(channelMessage);
      // Flow continues in handleCreateChannelResponse

    } catch (error) {
      this.log(`Withdrawal failed: ${error.message}`, 'error');
      console.error('Withdrawal error:', error);
      this.pendingWithdrawal = null;
    }
  }

  /*
  // DEPRECATED: Part of old complex withdrawal flow
  async requestWithdrawalResize(channelId, amount) {
    try {
      this.log(`Requesting withdrawal resize: +${(amount / 1_000_000).toFixed(2)} USDC to on-chain...`);

      // Use POSITIVE resize_amount to move funds FROM off-chain ledger TO on-chain custody
      // Then we can close the channel and withdraw
      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          resize_amount: BigInt(amount), // Positive = move from ledger to on-chain custody
          funds_destination: this.userAddress
        }
      );

      console.log('Withdrawal resize message:', resizeMessage);

      // Store pending withdrawal for handling the response
      this.pendingWithdrawalChannelId = channelId;
      this.pendingWithdrawalAmount = amount;

      this.ws.send(resizeMessage);

    } catch (error) {
      this.log(`Withdrawal resize failed: ${error.message}`, 'error');
      console.error('Withdrawal resize error:', error);
    }
  }
  */

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

  async checkCustodyBalance() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      const chainId = parseInt(this.elements.chainSelect.value);
      const chainConfig = CHAIN_CONFIG[chainId];
      if (!chainConfig) {
        this.log('Invalid chain selected', 'error');
        return;
      }

      this.log(`Checking custody balance on ${chainConfig.name}...`);

      // Ensure we're on the right chain
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId, 16);
      if (currentChainIdDecimal !== chainId) {
        this.log(`Please switch to ${chainConfig.name} in your wallet first`, 'error');
        return;
      }

      // Create public client for read operations
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      // Initialize NitroliteService
      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        null,
        this.userAddress
      );

      // Check balance in custody contract
      const balance = await nitroliteService.getAccountBalance(this.userAddress, chainConfig.token);
      const balanceFormatted = (Number(balance) / 1_000_000).toFixed(6);

      this.log(`Custody balance: ${balanceFormatted} USDC`);

      if (balance > 0n) {
        this.log('You have funds in custody! Click withdraw to get them.');
        // Add withdraw option
        const container = this.elements.channelsList;
        container.innerHTML = `
          <div style="background: rgba(76,175,80,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(76,175,80,0.5);">
            <p style="color: #4caf50; margin-bottom: 0.5rem;"><strong>Custody Balance: ${balanceFormatted} USDC</strong></p>
            <p style="font-size: 0.8rem; color: #aaa; margin-bottom: 0.5rem;">on ${chainConfig.name}</p>
            <button onclick="window.app.withdrawFromCustody(${chainId}, '${chainConfig.token}', '${balance}')"
              style="background: #4caf50; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
              Withdraw to Wallet
            </button>
          </div>
        ` + container.innerHTML;
      } else {
        this.log('No funds in custody on this chain.');
      }

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Failed to check custody: ${errorMsg}`, 'error');
      console.error('Check custody error:', error);
    }
  }

  async withdrawFromCustody(chainId, tokenAddress, amount) {
    try {
      const chainConfig = CHAIN_CONFIG[chainId];
      this.log(`Withdrawing ${(Number(amount) / 1_000_000).toFixed(6)} USDC from custody...`);

      // Create wallet client
      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      // Initialize NitroliteService with wallet
      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      // Withdraw
      const txHash = await nitroliteService.withdraw(tokenAddress, BigInt(amount));
      this.log(`Withdraw tx: ${txHash.slice(0, 10)}...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'success') {
        this.log('Withdrawal complete! Tokens sent to your wallet.');
      } else {
        this.log('Withdrawal failed', 'error');
      }

      // Refresh
      this.checkCustodyBalance();

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Withdraw failed: ${errorMsg}`, 'error');
      console.error('Withdraw error:', error);
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

  async handleCreateChannelResponse(data) {
    console.log('Create channel response:', data);
    if (data?.channel_id) {
      const channelIdShort = data.channel_id.slice(0, 10);
      this.log(`Channel created off-chain: ${channelIdShort}...`);

      // Store channel data for on-chain submission
      this.pendingChannelId = data.channel_id;
      this.pendingChannelData = data;

      // Check if this is for SIMPLIFIED withdrawal flow (3 steps)
      if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'create_channel') {
        if (!data?.channel_id) {
          this.log('Channel creation failed', 'error');
          this.pendingWithdrawal = null;
          return;
        }

        const { amount, chainConfig } = this.pendingWithdrawal;
        const channelId = data.channel_id;

        this.log('Step 2/4: Allocating funds to channel (off-chain)...');
        this.log(`Moving ${(amount / 1_000_000).toFixed(2)} USDC from ledger to channel`);

        // Add delay to avoid race condition with server persistence (Bug #12)
        this.log('Waiting for server to persist channel...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

        try {
          // Step 2: Resize with allocate_amount = move from ledger TO channel (OFF-CHAIN)
          // This gives us a new state with non-zero allocations
          const resizeMessage = await createResizeChannelMessage(
            this.messageSigner,
            {
              channel_id: channelId,
              allocate_amount: BigInt(amount),  // allocate = ledger → channel (off-chain)
              funds_destination: this.userAddress
            }
          );

          // Update tracking
          this.pendingWithdrawal.step = 'allocate_to_channel';
          this.pendingWithdrawal.channelId = channelId;
          this.pendingWithdrawal.channelData = data; // Store original channel config

          this.ws.send(resizeMessage);
          return; // Don't continue with other flows

        } catch (error) {
          this.log(`Allocate failed: ${error.message}`, 'error');
          this.pendingWithdrawal = null;
        }
      }
      // Check if this is for regular channel funding
      else if (this.pendingChannelFund) {
        this.log('Channel created for funding...');
      }

      // Submit channel on-chain (for non-withdrawal flows)
      if (data.channel && data.state && data.server_signature) {
        this.log('Submitting channel to blockchain...');
        await this.submitChannelOnChain(data);
      } else {
        this.log('Channel created but missing on-chain data. Refresh channels.');
        this.getChannels();
      }
    } else {
      this.log(`Channel response: ${JSON.stringify(data)}`);
      this.pendingChannelFund = null;
      this.pendingWithdrawal = null;
    }
  }

  async submitChannelOnChain(channelData) {
    try {
      const chainId = parseInt(this.elements.chainSelect.value);
      const chainConfig = CHAIN_CONFIG[chainId];

      if (!chainConfig?.custody) {
        this.log('No custody address configured for this chain', 'error');
        return;
      }

      // Switch to the correct network if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId, 16);
      if (currentChainIdDecimal !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${chainId.toString(16)}` }]
          });
          // Recreate wallet client after network switch
          this.walletClient = createWalletClient({
            chain: chainConfig.chain,
            transport: custom(window.ethereum),
            account: this.userAddress
          });
          this.publicClient = createPublicClient({
            chain: chainConfig.chain,
            transport: http()
          });
        } catch (switchError) {
          // If the chain is not added, we could add it here
          this.log(`Please switch to ${chainConfig.name} in your wallet`, 'error');
          return;
        }
      }

      // Initialize NitroliteService for on-chain operations
      const nitroliteService = new NitroliteService(
        this.publicClient,
        { custody: chainConfig.custody },
        this.walletClient,
        this.userAddress
      );

      // Prepare the channel for on-chain submission
      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      // Prepare the unsigned state
      const unsignedState = {
        intent: channelData.state.intent,
        version: BigInt(channelData.state.version),
        data: channelData.state.state_data || '0x',
        allocations: channelData.state.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      // Calculate channel ID and sign the state with our session key
      const channelIdCalculated = getChannelId(channel, chainId);
      this.log(`Channel ID: ${channelIdCalculated.slice(0, 10)}...`);

      // Get the packed state to sign
      const packedState = getPackedState(channelIdCalculated, unsignedState);

      // Sign with main wallet (the first participant) via MetaMask
      // The contract expects signature from the participant who created the channel
      this.log('Requesting wallet signature for state...');
      const userSignature = await this.walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      // State needs sigs in order: [userSignature, serverSignature]
      const signedState = {
        ...unsignedState,
        sigs: [userSignature, channelData.server_signature]
      };

      this.log('Creating channel on-chain (requires wallet approval)...');
      console.log('On-chain channel data:', { channel, signedState, channelIdCalculated });
      console.log('Server signature:', channelData.server_signature);
      console.log('User signature:', userSignature);
      console.log('Packed state (hex):', packedState);

      // Submit to blockchain (create channel only - deposits happen via resize)
      const txHash = await nitroliteService.createChannel(channel, signedState);
      this.log(`On-chain tx submitted: ${txHash.slice(0, 10)}...`);

      // Wait for confirmation
      this.log('Waiting for confirmation...');
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel created on-chain!');

        // Store on-chain channel data for later operations
        this.onChainChannels.set(channelData.channel_id, {
          channel,
          channelId: channelIdCalculated,
          chainId,
          chainConfig,
          tokenAddress: chainConfig.token
        });

        // Update the channels list UI to show on-chain channel
        this.renderChannelsList();

        // Check if this is part of the withdrawal flow
        if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'submit_on_chain') {
          const { amount, channelId } = this.pendingWithdrawal;
          this.pendingWithdrawal.step = 'allocate_funds';
          this.log(`Step 2/5: Channel on-chain, allocating ${(amount / 1_000_000).toFixed(2)} USDC...`);

          // Allocate funds to the channel from off-chain ledger
          await this.allocateFundsToChannel(channelId, amount);
        }
        // Check if this was for regular funding
        else if (this.pendingChannelFund) {
          const { amount } = this.pendingChannelFund;
          this.pendingChannelFund = null;
          this.log(`Requesting resize to allocate ${(amount / 1_000_000).toFixed(2)} USDC...`);
          await this.resizeChannel(channelData.channel_id, amount);
        } else {
          this.getChannels();
        }
      } else {
        this.log('On-chain transaction failed', 'error');
        this.pendingWithdrawal = null;
      }
    } catch (error) {
      // Extract detailed error info
      const errorDetails = error.cause?.message || error.cause?.shortMessage || error.shortMessage || error.message;
      const errorReason = error.cause?.reason || error.reason || '';
      this.log(`On-chain submission failed: ${errorDetails}`, 'error');
      if (errorReason) {
        this.log(`Reason: ${errorReason}`, 'error');
      }
      console.error('On-chain error:', error);
      console.error('Error cause:', error.cause);
      console.error('Error details:', {
        message: error.message,
        shortMessage: error.shortMessage,
        cause: error.cause,
        reason: error.reason,
        details: error.details
      });
      this.pendingChannelFund = null;
    }
  }

  handleGetChannelsResponse(data) {
    console.log('Get channels response:', data);
    this.channels = data?.channels || [];
    this.renderChannelsList();
  }

  // Handle server broadcast of channels (includes stuck/orphaned channels)
  handleChannelsBroadcast(data) {
    console.log('Channels broadcast:', data);
    const channels = data?.channels || [];

    // Store each channel's data for potential recovery
    channels.forEach(ch => {
      if (ch.channel_id) {
        this.serverChannels.set(ch.channel_id, ch);
        console.log(`Stored server channel: ${ch.channel_id.slice(0, 10)}...`);
      }
    });

    // Also update the channels list for UI
    if (channels.length > 0) {
      this.channels = channels;
      this.renderChannelsList();
    }
  }

  async handleResizeChannelResponse(data) {
    console.log('Resize channel response:', data);

    // Check if this is for 4-step withdrawal flow (allocate → submit on-chain → close)
    if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'allocate_to_channel') {
      if (!data?.channel_id || !data?.state || !data?.server_signature) {
        this.log('Allocate failed - missing state data', 'error');
        console.error('Expected state in resize response:', data);
        this.pendingWithdrawal = null;
        return;
      }

      const { amount, channelId, channelData, chainId, chainConfig } = this.pendingWithdrawal;

      // Log the new state with allocations
      console.log('New state with allocations:', data.state);
      const userAllocation = data.state.allocations?.find(a =>
        a.destination.toLowerCase() === this.userAddress.toLowerCase()
      );
      if (userAllocation) {
        this.log(`Channel now has ${(parseInt(userAllocation.amount) / 1_000_000).toFixed(2)} USDC allocated`);
      }

      this.log('Step 3/4: Submitting channel on-chain with allocated funds...');

      try {
        // Step 3: Submit on-chain using the NEW state (with allocations) from resize response
        await this.submitChannelOnChainWithState(channelData, data, chainId, chainConfig);
        // Flow continues in submitChannelOnChainWithState

      } catch (error) {
        this.log(`On-chain submission failed: ${error.message}`, 'error');
        this.pendingWithdrawal = null;
      }
      return;
    }

    // Regular resize (not withdrawal flow)
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

  // Step 3 of 4-step withdrawal: Submit channel on-chain with the allocated state
  async submitChannelOnChainWithState(channelData, resizeData, chainId, chainConfig) {
    try {
      // Ensure correct network
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

      // Create clients
      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      // Initialize NitroliteService
      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      // Build channel object from original channel data
      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      // Calculate channel ID
      const channelIdHash = getChannelId(channel, chainId);
      this.log(`Channel ID: ${channelIdHash.slice(0, 10)}...`);

      // Build state from resize response (this has the allocations!)
      const stateWithAllocations = {
        intent: resizeData.state.intent,
        version: BigInt(resizeData.state.version),
        data: resizeData.state.state_data || '0x',
        allocations: resizeData.state.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      // Log allocations to verify they're non-zero
      console.log('State allocations for on-chain submission:', stateWithAllocations.allocations);

      // Sign the state with user's wallet
      const packedState = getPackedState(channelIdHash, stateWithAllocations);
      this.log('Requesting wallet signature...');
      const userSignature = await walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      // Add both signatures
      const signedState = {
        ...stateWithAllocations,
        sigs: [userSignature, resizeData.server_signature]
      };

      // Submit to blockchain using createChannel
      this.log('Creating channel on-chain (requires gas)...');
      const txHash = await nitroliteService.createChannel(channel, signedState);
      this.log(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      // Wait for confirmation
      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel created on-chain with funds!');

        // Update tracking for next step
        this.pendingWithdrawal.step = 'close_channel';
        this.pendingWithdrawal.onChainChannelId = channelIdHash;
        this.pendingWithdrawal.signedState = signedState;

        // Step 4: Close channel to withdraw
        this.log('Step 4/4: Closing channel to withdraw to wallet...');

        const closeMessage = await createCloseChannelMessage(
          this.messageSigner,
          this.pendingWithdrawal.channelId,
          this.userAddress  // funds_destination
        );

        this.ws.send(closeMessage);
        // Flow continues in handleCloseChannelResponse

      } else {
        this.log('On-chain transaction failed', 'error');
        this.pendingWithdrawal = null;
      }

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`On-chain submission failed: ${errorMsg}`, 'error');
      console.error('On-chain error:', error);
      this.pendingWithdrawal = null;
    }
  }

  // Submit signed state to custody contract (step 4 of withdrawal flow)
  // DEPRECATED: This method was part of the complex 5-step withdrawal flow.
  // Now using 4-step flow: create → allocate → submit on-chain → close
  // See BUGS.md for details on the fix
  /*
  async submitStateToCustody(resizeData, amount) {
    try {
      const chainId = parseInt(this.elements.chainSelect.value);
      const chainConfig = CHAIN_CONFIG[chainId];

      if (!chainConfig?.custody) {
        this.log('No custody address configured for this chain', 'error');
        this.pendingWithdrawal = null;
        return;
      }

      // Ensure correct network
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${chainId.toString(16)}` }]
          });
        } catch (switchError) {
          this.log(`Please switch to ${chainConfig.name} in your wallet`, 'error');
          this.pendingWithdrawal = null;
          return;
        }
      }

      // Create clients
      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      // Get channel data
      const channelData = this.pendingChannelData;
      if (!channelData?.channel) {
        this.log('Missing channel data for custody submission', 'error');
        this.pendingWithdrawal = null;
        return;
      }

      const channel = {
        participants: channelData.channel.participants.map(p => getAddress(p)),
        adjudicator: getAddress(channelData.channel.adjudicator),
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      const channelIdHash = getChannelId(channel, chainId);

      // Build the state from resize response
      const state = {
        intent: resizeData.state.intent,
        version: BigInt(resizeData.state.version),
        data: resizeData.state.state_data || '0x',
        allocations: resizeData.state.allocations.map(a => ({
          destination: getAddress(a.destination),
          token: getAddress(a.token),
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      // Sign the state with user's wallet
      const packedState = getPackedState(channelIdHash, state);
      this.log('Signing state update...');
      const userSignature = await walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      const signedState = {
        ...state,
        sigs: [userSignature, resizeData.server_signature]
      };

      this.log('Submitting state to custody contract...');

      // Submit to custody contract using resize function
      const txHash = await nitroliteService.resize(channelIdHash, signedState, []);
      this.log(`Tx submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Step 4/5: State submitted to custody! Funds should be in custody now.');

        // Step 5: Withdraw from custody
        this.pendingWithdrawal.step = 'withdraw';
        await this.withdrawFromCustodyFinal(chainConfig, amount);
      } else {
        this.log('Custody submission failed', 'error');
        this.pendingWithdrawal = null;
      }

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Failed to submit to custody: ${errorMsg}`, 'error');
      console.error('Submit to custody error:', error);
      this.pendingWithdrawal = null;
    }
  }
  */

  // DEPRECATED: This method was part of the complex 5-step withdrawal flow.
  // Now using 4-step flow: create → allocate → submit on-chain → close
  // See BUGS.md for details on the fix
  /*
  // Final step: Withdraw from custody to wallet (step 5 of withdrawal flow)
  async withdrawFromCustodyFinal(chainConfig, amount) {
    try {
      this.log(`Step 5/5: Withdrawing ${(amount / 1_000_000).toFixed(2)} USDC from custody to wallet...`);

      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      // Withdraw from custody
      const withdrawTxHash = await nitroliteService.withdraw(chainConfig.token, BigInt(amount));
      this.log(`Withdraw tx: ${withdrawTxHash.slice(0, 10)}...`);

      const withdrawReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTxHash });

      if (withdrawReceipt.status === 'success') {
        this.log(`✓ Withdrawal complete! ${(amount / 1_000_000).toFixed(2)} USDC sent to your wallet on ${chainConfig.name}!`);
        this.pendingWithdrawal = null;

        // Refresh balances
        this.getBalances();
        this.getChannels();
      } else {
        this.log('Withdraw transaction failed', 'error');
        this.pendingWithdrawal = null;
      }

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Withdraw from custody failed: ${errorMsg}`, 'error');
      console.error('Withdraw from custody error:', error);
      this.pendingWithdrawal = null;
    }
  }
  */

  async handleCloseChannelResponse(data) {
    console.log('Close channel response:', data);

    // Check if this is for SIMPLIFIED withdrawal flow (3 steps)
    if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'close_channel') {
      if (!data?.state || !data?.server_signature) {
        this.log('Close response missing signed state', 'error');
        this.pendingWithdrawal = null;
        return;
      }

      const { channelData, chainId, chainConfig } = this.pendingWithdrawal;

      this.log('Submitting close transaction on-chain...');
      await this.submitCloseOnChainSimple(channelData, data, chainId, chainConfig);

      this.pendingWithdrawal = null;
      return;
    }

    // Original close flow for other cases
    // If server returns final state for on-chain close, submit it
    if (data?.channel_id && data?.state && data?.server_signature) {
      this.log('Received final state, closing channel on-chain...');
      await this.submitCloseChannelOnChain(data);
    } else if (data?.success || data?.channel_id) {
      // Channel closed off-chain only
      this.log('Channel closed! Funds returned to off-chain balance.');
      this.getChannels();
      this.getBalances();
    } else {
      this.log(`Close channel response: ${JSON.stringify(data)}`);
    }
  }

  async submitCloseChannelOnChain(closeData) {
    try {
      const channelId = closeData.channel_id;
      let onChainData = this.onChainChannels.get(channelId);

      // If not in our local registry, try to reconstruct from server broadcast data
      if (!onChainData) {
        const serverChannel = this.serverChannels.get(channelId);
        if (serverChannel) {
          this.log('Reconstructing channel from server data...');

          // Extract the broker address from close_channel response allocations
          // The second allocation destination is the broker
          const brokerAddress = closeData.state?.allocations?.[1]?.destination;
          if (!brokerAddress) {
            this.log('Cannot determine broker address from close response', 'error');
            return;
          }

          const chainId = serverChannel.chain_id;
          const chainConfig = CHAIN_CONFIG[chainId];
          if (!chainConfig) {
            this.log(`Unsupported chain: ${chainId}`, 'error');
            return;
          }

          // Reconstruct channel parameters
          const channel = {
            participants: [getAddress(serverChannel.participant), getAddress(brokerAddress)],
            adjudicator: getAddress(serverChannel.adjudicator),
            challenge: BigInt(serverChannel.challenge),
            nonce: BigInt(serverChannel.nonce)
          };

          // Calculate channel ID to verify
          const calculatedChannelId = getChannelId(channel, chainId);
          this.log(`Calculated channel ID: ${calculatedChannelId.slice(0, 10)}...`);

          onChainData = {
            channel,
            channelId: calculatedChannelId,
            chainId,
            chainConfig
          };
        } else {
          this.log('Channel not found in registry or server data. It may have been closed already.');
          this.getChannels();
          this.getBalances();
          return;
        }
      }

      const { channel, channelId: channelIdHash, chainId, chainConfig } = onChainData;

      // Switch network if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId, 16);

      if (currentChainIdDecimal !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${chainId.toString(16)}` }]
          });
          this.walletClient = createWalletClient({
            chain: chainConfig.chain,
            transport: custom(window.ethereum),
            account: this.userAddress
          });
          this.publicClient = createPublicClient({
            chain: chainConfig.chain,
            transport: http()
          });
        } catch (switchError) {
          this.log(`Please switch to ${chainConfig.name} in your wallet`, 'error');
          return;
        }
      }

      // Initialize NitroliteService
      const nitroliteService = new NitroliteService(
        this.publicClient,
        { custody: chainConfig.custody },
        this.walletClient,
        this.userAddress
      );

      // Prepare the final state (intent should be FINALIZE = 2)
      const finalState = {
        intent: closeData.state.intent || 2, // StateIntent.FINALIZE
        version: BigInt(closeData.state.version),
        data: closeData.state.state_data || '0x',
        allocations: closeData.state.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      // Get packed state for signing
      const packedState = getPackedState(channelIdHash, finalState);

      // Sign with main wallet
      this.log('Requesting wallet signature for close...');
      const userSignature = await this.walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      // Add both signatures
      const signedFinalState = {
        ...finalState,
        sigs: [userSignature, closeData.server_signature]
      };

      this.log('Closing channel on-chain (requires wallet approval)...');
      console.log('Close channel on-chain data:', { channelIdHash, signedFinalState });

      // Submit close transaction
      const txHash = await nitroliteService.close(channelIdHash, signedFinalState, []);
      this.log(`Close tx submitted: ${txHash.slice(0, 10)}...`);

      // Wait for confirmation
      this.log('Waiting for confirmation...');
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel closed on-chain! Funds released to custody.');

        // Now withdraw from custody to wallet
        // Use the stored deposited amount (more reliable than close allocation which may be 0)
        const depositedAmount = onChainData.depositedAmount || 0;
        const tokenAddress = onChainData.tokenAddress || closeData.state.allocations[0]?.token;

        if (depositedAmount > 0 && tokenAddress) {
          const withdrawAmount = BigInt(depositedAmount);

          this.log(`Withdrawing ${Number(withdrawAmount) / 1_000_000} USDC from custody...`);

          try {
            const withdrawTxHash = await nitroliteService.withdraw(tokenAddress, withdrawAmount);
            this.log(`Withdraw tx submitted: ${withdrawTxHash.slice(0, 10)}...`);

            const withdrawReceipt = await this.publicClient.waitForTransactionReceipt({ hash: withdrawTxHash });

            if (withdrawReceipt.status === 'success') {
              this.log('Withdrawal complete! Tokens sent to your wallet.');
              this.log(`Check ${chainConfig.name} for your USDC.`);
            } else {
              this.log('Withdraw transaction failed', 'error');
            }
          } catch (withdrawError) {
            const withdrawErrorMsg = withdrawError.cause?.message || withdrawError.shortMessage || withdrawError.message;
            this.log(`Withdraw failed: ${withdrawErrorMsg}`, 'error');
            console.error('Withdraw error:', withdrawError);
          }
        } else {
          this.log('No funds to withdraw (no deposit recorded).');
        }

        this.onChainChannels.delete(channelId);
        this.getChannels();
        this.getBalances();
      } else {
        this.log('On-chain close transaction failed', 'error');
      }
    } catch (error) {
      const errorDetails = error.cause?.message || error.cause?.shortMessage || error.shortMessage || error.message;
      this.log(`On-chain close failed: ${errorDetails}`, 'error');
      console.error('Close channel on-chain error:', error);
    }
  }

  async submitCloseOnChainSimple(channelData, closeData, chainId, chainConfig) {
    try {
      // Switch to correct network
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

      // Create clients
      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      // Initialize NitroliteService
      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      // Build channel object
      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      // Calculate channel ID
      const channelIdHash = getChannelId(channel, chainId);

      // Build final state
      const finalState = {
        intent: closeData.state.intent,
        version: BigInt(closeData.state.version),
        data: closeData.state.state_data || '0x',
        allocations: closeData.state.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      // Sign with user's wallet
      const packedState = getPackedState(channelIdHash, finalState);
      this.log('Requesting wallet signature...');
      const userSignature = await walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      // Add both signatures
      const signedFinalState = {
        ...finalState,
        sigs: [userSignature, closeData.server_signature]
      };

      // Submit close transaction
      this.log('Submitting close transaction (requires gas)...');
      const txHash = await nitroliteService.close(channelIdHash, signedFinalState, []);
      this.log(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      // Wait for confirmation
      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('✓ Withdrawal complete!');
        this.log(`Check your wallet on ${chainConfig.name} for the USDC tokens.`);

        // Refresh balances and channels
        await this.getBalances();
        await this.getChannels();
      } else {
        this.log('Transaction failed', 'error');
      }

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`On-chain close failed: ${errorMsg}`, 'error');
      console.error('Close on-chain error:', error);
    }
  }

  renderChannelsList() {
    const container = this.elements.channelsList;
    let html = '';

    // Show on-chain channels (tracked locally)
    if (this.onChainChannels.size > 0) {
      html += '<p style="color: #ffd700; font-size: 0.85rem; margin-bottom: 0.5rem;">On-Chain Channels:</p>';
      this.onChainChannels.forEach((data, channelId) => {
        const chainName = data.chainConfig?.name || `Chain ${data.chainId}`;
        const channelIdShort = channelId.slice(0, 10) + '...';

        html += `
          <div style="background: rgba(255,215,0,0.1); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(255,215,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>${chainName}</strong><br>
                <span style="color: #888; font-size: 0.8rem;">${channelIdShort}</span><br>
                <span style="color: #4caf50;">On-Chain</span>
              </div>
              <button onclick="window.app.closeChannel('${channelId}')"
                style="background: #f44336; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                Close & Withdraw
              </button>
            </div>
          </div>
        `;
      });
    }

    // Show off-chain channels from server
    if (this.channels.length > 0) {
      html += '<p style="color: #aaa; font-size: 0.85rem; margin-bottom: 0.5rem; margin-top: 0.5rem;">Off-Chain Channels:</p>';
      html += this.channels.map(ch => {
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
    }

    if (html === '') {
      html = '<p style="color: #888;">No channels found. Create one to withdraw funds on-chain.</p>';
    }

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
