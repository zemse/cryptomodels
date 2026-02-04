import {
  createAuthRequestMessage,
  createGetLedgerBalancesMessage,
  createTransferMessage,
  createCreateChannelMessage,
  createCloseChannelMessage,
  createResizeChannelMessage,
  createGetChannelsMessageV2,
  createAppSessionMessage,
  createGetAppSessionsMessageV2,
  createSubmitAppStateMessage,
  createCloseAppSessionMessage,
  NitroliteRPC,
  generateRequestId,
  getCurrentTimestamp,
  EIP712AuthTypes,
  createECDSAMessageSigner,
  NitroliteService,
  getChannelId,
  getPackedState
} from '@erc7824/nitrolite';
import { getAddress, createPublicClient, createWalletClient, custom, http, parseUnits, formatUnits, erc20Abi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TESTNET_CONFIG, MAINNET_CONFIG, getConfig } from './config.js';

class YellowPaymentApp {
  constructor(environment = 'testnet', elementIdPrefix = '') {
    this.environment = environment;
    this.prefix = elementIdPrefix;
    this.config = getConfig(environment);

    this.ws = null;
    this.messageSigner = null;
    this.userAddress = null;
    this.sessionId = null;
    this.balance = 0;
    this.ledgerBalance = 0;
    this.isAuthenticated = false;
    this.pendingAuthResolve = null;
    this.pendingRequests = new Map();
    this.authParams = null;
    this.sessionKeyPrivate = null;
    this.sessionKeyAddress = null;
    this.channels = [];
    this.pendingChannelFund = null;
    this.publicClient = null;
    this.walletClient = null;
    this.nitroliteService = null;
    this.onChainChannels = new Map();
    this.serverChannels = new Map();

    // App Sessions state
    this.appSessions = [];

    // On-chain balances by chainId
    this.onChainBalances = new Map();

    this.initUI();
  }

  // Get prefixed element ID
  getElement(id) {
    return document.getElementById(this.prefix + id);
  }

  initUI() {
    // DOM elements with prefix
    this.elements = {
      wsStatus: this.getElement('wsStatus'),
      wsStatusText: this.getElement('wsStatusText'),
      walletStatus: this.getElement('walletStatus'),
      walletStatusText: this.getElement('walletStatusText'),
      userAddress: this.getElement('userAddress'),
      balance: this.getElement('balance'),
      connectBtn: this.getElement('connectBtn'),
      createSessionBtn: this.getElement('createSessionBtn'),
      partnerAddress: this.getElement('partnerAddress'),
      initialAmount: this.getElement('initialAmount'),
      activityLog: this.getElement('activityLog'),
      // Channel management
      chainSelect: this.getElement('chainSelect'),
      channelAmount: this.getElement('channelAmount'),
      createChannelBtn: this.getElement('createChannelBtn'),
      refreshChannelsBtn: this.getElement('refreshChannelsBtn'),
      checkCustodyBtn: this.getElement('checkCustodyBtn'),
      withdrawToWalletBtn: this.getElement('withdrawToWalletBtn'),
      channelsList: this.getElement('channelsList'),
      // App Sessions
      sessionRecipient: this.getElement('sessionRecipient'),
      sessionAmount: this.getElement('sessionAmount'),
      createAppSessionBtn: this.getElement('createAppSessionBtn'),
      refreshAppSessionsBtn: this.getElement('refreshAppSessionsBtn'),
      appSessionsList: this.getElement('appSessionsList'),
      // Deposit (mainnet only)
      depositChainSelect: this.getElement('depositChainSelect'),
      depositAmount: this.getElement('depositAmount'),
      depositBtn: this.getElement('depositBtn'),
      // On-chain balance
      onChainBalanceContainer: this.getElement('onChainBalanceContainer'),
      refreshOnChainBtn: this.getElement('refreshOnChainBtn'),
      // Direct deposit to custody
      depositCreateChainSelect: this.getElement('depositCreateChainSelect'),
      depositCreateAmount: this.getElement('depositCreateAmount'),
      depositAndCreateBtn: this.getElement('depositAndCreateBtn'),
      // On-chain channel creation
      onChainChannelChainSelect: this.getElement('onChainChannelChainSelect'),
      onChainChannelPartnerKey: this.getElement('onChainChannelPartnerKey'),
      onChainChannelAmount: this.getElement('onChainChannelAmount'),
      createOnChainChannelBtn: this.getElement('createOnChainChannelBtn'),
      // Wallet connection options
      walletType: this.getElement('walletType'),
      pkInput: this.getElement('pkInput'),
      pkInputWrapper: this.getElement('pkInputWrapper')
    };

    // Wallet type state
    this.walletConnectionType = 'metamask';
    this.privateKeyAccount = null;
    this.walletConnectProvider = null;

    // Event listeners
    this.elements.connectBtn?.addEventListener('click', () => this.connectWallet());

    // Wallet type selection handler
    this.elements.walletType?.addEventListener('change', (e) => {
      this.walletConnectionType = e.target.value;
      const showPk = e.target.value === 'privatekey';
      if (this.elements.pkInputWrapper) {
        this.elements.pkInputWrapper.style.display = showPk ? 'block' : 'none';
      }
    });
    this.elements.createSessionBtn?.addEventListener('click', () => this.createSession());
    this.elements.createChannelBtn?.addEventListener('click', () => this.createChannel());
    this.elements.refreshChannelsBtn?.addEventListener('click', () => this.getChannels());
    this.elements.checkCustodyBtn?.addEventListener('click', () => this.checkCustodyBalance());
    this.elements.withdrawToWalletBtn?.addEventListener('click', () => this.withdrawToWallet());

    // App Sessions event listeners
    this.elements.createAppSessionBtn?.addEventListener('click', () => this.createAppSession());
    this.elements.refreshAppSessionsBtn?.addEventListener('click', () => this.getAppSessions());

    // Deposit event listener (mainnet only)
    this.elements.depositBtn?.addEventListener('click', () => this.depositUSDC());

    // On-chain balance event listener
    this.elements.refreshOnChainBtn?.addEventListener('click', () => this.refreshOnChainBalances());

    // Deposit & Create Channel event listener
    this.elements.depositAndCreateBtn?.addEventListener('click', () => this.depositAndCreateChannel());

    // On-chain channel creation event listener
    this.elements.createOnChainChannelBtn?.addEventListener('click', () => this.createOnChainChannel());

    // Initialize WebSocket connection
    this.connectWebSocket();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const envEmoji = this.config.emoji;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span style="color: #888">[${timestamp}]</span> ${envEmoji} ${message}`;
    this.elements.activityLog?.prepend(entry);
    console.log(`[${this.environment.toUpperCase()}][${type.toUpperCase()}]`, message);
  }

  // Mainnet safety confirmation
  async confirmMainnetAction(action, amount) {
    if (this.environment !== 'mainnet') return true;

    const amountNum = parseFloat(amount) || 0;
    let message = `⚠️ MAINNET OPERATION ⚠️\n\nYou are about to use REAL MONEY.\nAction: ${action}\nAmount: ${amountNum.toFixed(2)} USDC\n\nAre you sure you want to continue?`;

    // Double confirmation for large amounts
    if (amountNum > 100) {
      message = `🚨 LARGE MAINNET OPERATION 🚨\n\nYou are about to move ${amountNum.toFixed(2)} USDC (>$100).\nAction: ${action}\n\nThis is a significant amount. Are you ABSOLUTELY sure?`;
    }

    return confirm(message);
  }

  connectWebSocket() {
    this.log('Connecting to Yellow Network...');

    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.onopen = async () => {
      this.elements.wsStatus?.classList.add('connected');
      this.elements.wsStatus?.classList.remove('disconnected');
      if (this.elements.wsStatusText) {
        this.elements.wsStatusText.textContent = `Connected to ${this.config.displayName}`;
      }
      this.log('Connected to Yellow Network!');

      // Auto re-authenticate if wallet was previously connected
      if (this.userAddress && !this.isAuthenticated) {
        this.log('Re-authenticating...');
        if (this.elements.connectBtn) this.elements.connectBtn.textContent = 'Authenticating...';
        try {
          await this.authenticate();
          this.log('Re-authenticated successfully!');
          this.enableButtons();
          await this.getBalances();
          await this.getChannels();
          await this.getAppSessions();
        } catch (error) {
          this.log(`Re-authentication failed: ${error.message}`, 'error');
          if (this.elements.connectBtn) {
            this.elements.connectBtn.textContent = 'Reconnect';
            this.elements.connectBtn.disabled = false;
          }
        }
      }
    };

    this.ws.onclose = () => {
      this.elements.wsStatus?.classList.remove('connected');
      this.elements.wsStatus?.classList.add('disconnected');
      if (this.elements.wsStatusText) {
        this.elements.wsStatusText.textContent = 'Disconnected';
      }
      this.isAuthenticated = false;
      this.log('Disconnected from Yellow Network');

      if (this.userAddress && this.elements.connectBtn) {
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

  enableButtons() {
    if (this.elements.connectBtn) {
      this.elements.connectBtn.textContent = 'Connected';
      this.elements.connectBtn.disabled = true;
    }
    if (this.elements.createSessionBtn) this.elements.createSessionBtn.disabled = false;
    if (this.elements.createChannelBtn) this.elements.createChannelBtn.disabled = false;
    if (this.elements.refreshChannelsBtn) this.elements.refreshChannelsBtn.disabled = false;
    if (this.elements.checkCustodyBtn) this.elements.checkCustodyBtn.disabled = false;
    if (this.elements.withdrawToWalletBtn) this.elements.withdrawToWalletBtn.disabled = false;
    if (this.elements.createAppSessionBtn) this.elements.createAppSessionBtn.disabled = false;
    if (this.elements.refreshAppSessionsBtn) this.elements.refreshAppSessionsBtn.disabled = false;
    if (this.elements.depositBtn) this.elements.depositBtn.disabled = false;
    if (this.elements.refreshOnChainBtn) this.elements.refreshOnChainBtn.disabled = false;
    if (this.elements.depositAndCreateBtn) this.elements.depositAndCreateBtn.disabled = false;
    if (this.elements.createOnChainChannelBtn) this.elements.createOnChainChannelBtn.disabled = false;
  }

  handleMessage(data) {
    console.log(`[${this.environment}] Raw WebSocket message:`, data);

    let parsed;
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      this.log(`Non-JSON message: ${data.toString().slice(0, 100)}`);
      return;
    }

    console.log(`[${this.environment}] Parsed JSON:`, parsed);

    if (parsed.res) {
      const [requestId, method, responseData, timestamp] = parsed.res;
      console.log(`[${this.environment}] Response - Method: ${method}, RequestId: ${requestId}`);

      if (method === 'error') {
        const errorMsg = responseData?.error || JSON.stringify(responseData);
        this.log(`Error: ${errorMsg}`, 'error');

        // Handle "channel already exists" error
        if (errorMsg.includes('an open channel with broker already exists:') && this.pendingWithdrawal) {
          const match = errorMsg.match(/already exists: (0x[a-fA-F0-9]+)/);
          if (match) {
            const existingChannelId = match[1];
            this.log(`Using existing channel: ${existingChannelId.slice(0, 10)}...`);
            const { amount } = this.pendingWithdrawal;
            this.pendingWithdrawal = null;
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
          this.handleCreateAppSessionResponse(responseData);
          break;

        case 'get_app_sessions':
          this.handleGetAppSessionsResponse(responseData);
          break;

        case 'submit_app_state':
          this.handleSubmitAppStateResponse(responseData);
          break;

        case 'close_app_session':
          this.handleCloseAppSessionResponse(responseData);
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

        case 'bu':
          this.handleBalanceUpdate(responseData);
          break;

        case 'channels':
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

      let challengeMessage;
      if (responseData?.challenge_message) {
        challengeMessage = responseData.challenge_message;
      } else if (Array.isArray(responseData) && responseData[0]?.challenge_message) {
        challengeMessage = responseData[0].challenge_message;
      } else {
        challengeMessage = JSON.stringify(responseData);
      }

      console.log('Challenge message:', challengeMessage);

      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' }
          ],
          ...EIP712AuthTypes
        },
        primaryType: 'Policy',
        domain: {
          name: this.authParams.application
        },
        message: {
          challenge: challengeMessage,
          scope: this.authParams.scope || '',
          wallet: this.authParams.address,
          session_key: this.authParams.session_key,
          expires_at: this.authParams.expires_at,
          allowances: this.authParams.allowances || []
        }
      };

      console.log('EIP-712 typed data:', JSON.stringify(typedData, null, 2));

      let signature;

      if (this.walletConnectionType === 'privatekey' && this.privateKeyAccount) {
        // Sign with private key using viem's signTypedData
        signature = await this.privateKeyAccount.signTypedData({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message
        });
        this.log('Signed with private key (local)');
      } else if (this.walletConnectionType === 'walletconnect' && this.walletConnectProvider) {
        // Sign via WalletConnect
        signature = await this.walletConnectProvider.request({
          method: 'eth_signTypedData_v4',
          params: [this.userAddress, JSON.stringify(typedData)]
        });
        this.log('Signed via WalletConnect');
      } else {
        // Sign via MetaMask / browser wallet
        signature = await window.ethereum.request({
          method: 'eth_signTypedData_v4',
          params: [this.userAddress, JSON.stringify(typedData)]
        });
        this.log('Signed via browser wallet');
      }

      console.log('EIP-712 signature:', signature);

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

  handleTransferResponse(data) {
    console.log('Transfer response:', data);
    if (data?.transactions && data.transactions.length > 0) {
      const tx = data.transactions[0];
      const amount = (parseInt(tx.amount) / 1_000_000).toFixed(2);
      this.log(`Transfer successful! ${amount} ${tx.asset} to ${tx.to_account.slice(0, 6)}...${tx.to_account.slice(-4)} (TX #${tx.id})`);
      this.getBalances();
    } else if (data?.success || data?.tx_id) {
      this.log(`Transfer successful! TX: ${data.tx_id || 'completed'}`);
      this.getBalances();
    } else {
      this.log(`Transfer response: ${JSON.stringify(data)}`);
    }
  }

  async connectWallet() {
    const walletType = this.elements.walletType?.value || 'metamask';
    this.walletConnectionType = walletType;

    try {
      this.log(`Connecting via ${walletType}...`);

      if (walletType === 'privatekey') {
        await this.connectWithPrivateKey();
      } else if (walletType === 'walletconnect') {
        await this.connectWithWalletConnect();
      } else {
        await this.connectWithMetaMask();
      }

      this.elements.walletStatus?.classList.add('connected');
      if (this.elements.walletStatusText) {
        this.elements.walletStatusText.textContent = 'Wallet connected';
      }
      if (this.elements.userAddress) {
        this.elements.userAddress.textContent = this.userAddress;
      }
      if (this.elements.connectBtn) {
        this.elements.connectBtn.textContent = 'Authenticating...';
      }

      this.log(`Wallet connected: ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);

      await this.authenticate();

      this.enableButtons();

      await this.getBalances();
      await this.getChannels();
      await this.getAppSessions();
      await this.refreshOnChainBalances();

    } catch (error) {
      this.log(`Failed to connect wallet: ${error.message}`, 'error');
      if (this.elements.connectBtn) {
        this.elements.connectBtn.textContent = 'Connect Wallet';
      }
    }
  }

  async connectWithMetaMask() {
    if (!window.ethereum) {
      throw new Error('Please install MetaMask!');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });

    this.userAddress = accounts[0];

    // Get the default chain for this environment
    const defaultChainId = this.environment === 'mainnet' ? 8453 : 11155111; // Base for mainnet
    const chainConfig = this.config.chains[defaultChainId];

    if (chainConfig?.chain) {
      this.publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });
      this.walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
    }

    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        this.log('Wallet disconnected');
        location.reload();
      } else {
        this.log('Account changed - please reconnect');
        location.reload();
      }
    });
  }

  async connectWithPrivateKey() {
    const pkInput = this.elements.pkInput?.value.trim();
    if (!pkInput) {
      throw new Error('Please enter a private key');
    }

    // Normalize key (add 0x if needed)
    const normalizedKey = pkInput.replace(/^0x/, '');
    const fullKey = `0x${normalizedKey}`;

    try {
      this.privateKeyAccount = privateKeyToAccount(fullKey);
      this.userAddress = this.privateKeyAccount.address;

      // Get the default chain for this environment
      const defaultChainId = this.environment === 'mainnet' ? 8453 : 11155111;
      const chainConfig = this.config.chains[defaultChainId];

      if (chainConfig?.chain) {
        this.publicClient = createPublicClient({
          chain: chainConfig.chain,
          transport: http()
        });
        // Create wallet client with private key account
        this.walletClient = createWalletClient({
          chain: chainConfig.chain,
          transport: http(),
          account: this.privateKeyAccount
        });
      }

      this.log('Connected with private key (local signing)');
    } catch (e) {
      throw new Error('Invalid private key format');
    }
  }

  async connectWithWalletConnect() {
    // WalletConnect requires a project ID from WalletConnect Cloud
    // For now, show instructions
    const projectId = prompt(
      'Enter your WalletConnect Project ID:\n\n' +
      'Get one free at: https://cloud.walletconnect.com/\n\n' +
      'Leave empty to cancel.'
    );

    if (!projectId) {
      throw new Error('WalletConnect requires a Project ID');
    }

    // Dynamic import of WalletConnect
    try {
      this.log('Initializing WalletConnect...');

      // Note: This requires @walletconnect/ethereum-provider to be installed
      // npm install @walletconnect/ethereum-provider
      // Using dynamic module name to bypass Vite static analysis
      const wcModule = '@walletconnect/ethereum-provider';
      const { EthereumProvider } = await import(/* @vite-ignore */ wcModule);

      const provider = await EthereumProvider.init({
        projectId: projectId,
        chains: [this.environment === 'mainnet' ? 8453 : 11155111],
        showQrModal: true,
        metadata: {
          name: 'Yellow Network Payment App',
          description: 'Yellow Network state channel payments',
          url: window.location.origin,
          icons: ['https://yellow.org/favicon.ico']
        }
      });

      await provider.connect();

      const accounts = await provider.request({ method: 'eth_accounts' });
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from WalletConnect');
      }

      this.userAddress = accounts[0];
      this.walletConnectProvider = provider;

      const defaultChainId = this.environment === 'mainnet' ? 8453 : 11155111;
      const chainConfig = this.config.chains[defaultChainId];

      if (chainConfig?.chain) {
        this.publicClient = createPublicClient({
          chain: chainConfig.chain,
          transport: http()
        });
        this.walletClient = createWalletClient({
          chain: chainConfig.chain,
          transport: custom(provider),
          account: this.userAddress
        });
      }

      provider.on('disconnect', () => {
        this.log('WalletConnect disconnected');
        location.reload();
      });

      this.log('Connected via WalletConnect');
    } catch (e) {
      if (e.message?.includes('Cannot find module')) {
        throw new Error(
          'WalletConnect not installed. Run: npm install @walletconnect/ethereum-provider'
        );
      }
      throw e;
    }
  }

  // Helper: Get the appropriate provider for the current wallet type
  getProvider() {
    if (this.walletConnectionType === 'walletconnect' && this.walletConnectProvider) {
      return this.walletConnectProvider;
    }
    return window.ethereum;
  }

  // Helper: Check and switch chain if needed
  async ensureChain(chainId, chainConfig) {
    if (this.walletConnectionType === 'privatekey') {
      // Private key connections can't switch chains via UI
      // The wallet client is already configured for the correct chain
      this.log(`Using ${chainConfig.name} (private key mode)`);
      return true;
    }

    const provider = this.getProvider();
    if (!provider) {
      throw new Error('No wallet provider available');
    }

    try {
      const currentChainId = await provider.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }
      return true;
    } catch (error) {
      this.log(`Failed to switch chain: ${error.message}`, 'error');
      return false;
    }
  }

  // Helper: Create a wallet client for a specific chain
  createWalletClientForChain(chainConfig) {
    if (this.walletConnectionType === 'privatekey' && this.privateKeyAccount) {
      return createWalletClient({
        chain: chainConfig.chain,
        transport: http(),
        account: this.privateKeyAccount
      });
    } else if (this.walletConnectionType === 'walletconnect' && this.walletConnectProvider) {
      return createWalletClient({
        chain: chainConfig.chain,
        transport: custom(this.walletConnectProvider),
        account: this.userAddress
      });
    } else {
      return createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
    }
  }

  async authenticate() {
    return new Promise(async (resolve, reject) => {
      try {
        this.log('Authenticating with Clearnode...');
        this.pendingAuthResolve = resolve;

        this.sessionKeyPrivate = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(this.sessionKeyPrivate);
        this.sessionKeyAddress = sessionAccount.address;

        this.messageSigner = createECDSAMessageSigner(this.sessionKeyPrivate);

        this.log(`Session key generated: ${this.sessionKeyAddress.slice(0, 6)}...${this.sessionKeyAddress.slice(-4)}`);

        // Environment-specific session expiry
        const expiryHours = this.config.sessionExpiryHours;
        const expiresAt = Math.floor(Date.now() / 1000) + (expiryHours * 60 * 60);

        this.log(`Session expiry: ${expiryHours} hour(s)`);

        const checksummedAddress = getAddress(this.userAddress);
        const checksummedSessionKey = getAddress(this.sessionKeyAddress);
        this.authParams = {
          address: checksummedAddress,
          session_key: checksummedSessionKey,
          application: 'clearnode',
          allowances: [],
          expires_at: expiresAt,
          scope: ''
        };

        const authMessage = await createAuthRequestMessage({
          ...this.authParams,
          expires_at: BigInt(expiresAt)
        });
        console.log('Auth request message:', authMessage);

        this.ws.send(authMessage);

        this.authTimeoutId = setTimeout(() => {
          if (!this.isAuthenticated) {
            this.pendingAuthResolve = null;
            reject(new Error('Authentication timeout'));
          }
        }, 60000);
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

  // ============ DEPOSIT USDC (Mainnet) ============

  async depositUSDC() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    const chainId = parseInt(this.elements.depositChainSelect?.value || '1');
    const amount = parseFloat(this.elements.depositAmount?.value || '0');

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid deposit amount', 'error');
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Deposit USDC', amount)) {
      this.log('Deposit cancelled by user');
      return;
    }

    const chainConfig = this.config.chains[chainId];
    if (!chainConfig) {
      this.log('Invalid chain selected', 'error');
      return;
    }

    try {
      this.log(`Starting deposit: ${amount} USDC on ${chainConfig.name}`);

      // Switch network if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

      // Create clients for this chain
      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const amountInUnits = parseUnits(amount.toString(), 6); // USDC has 6 decimals

      // Check wallet USDC balance
      const walletBalance = await publicClient.readContract({
        address: chainConfig.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.userAddress]
      });

      this.log(`Wallet USDC balance: ${formatUnits(walletBalance, 6)}`);

      if (walletBalance < amountInUnits) {
        this.log(`Insufficient USDC in wallet. Have: ${formatUnits(walletBalance, 6)}, Need: ${amount}`, 'error');
        return;
      }

      // Check allowance
      const allowance = await publicClient.readContract({
        address: chainConfig.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [this.userAddress, chainConfig.custody]
      });

      this.log(`Current allowance: ${formatUnits(allowance, 6)}`);

      // Approve if needed
      if (allowance < amountInUnits) {
        this.log('Requesting USDC approval...');

        const approveTxHash = await walletClient.writeContract({
          address: chainConfig.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [chainConfig.custody, amountInUnits]
        });

        this.log(`Approval tx: ${approveTxHash.slice(0, 10)}...`);
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
        this.log('Approval confirmed!');
      }

      // Deposit to custody
      this.log('Depositing to custody contract...');

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      const depositTxHash = await nitroliteService.deposit(chainConfig.token, amountInUnits);
      this.log(`Deposit tx: ${depositTxHash.slice(0, 10)}...`);

      await publicClient.waitForTransactionReceipt({ hash: depositTxHash });
      this.log('Deposit confirmed! Funds will appear in your Yellow balance shortly.');

      // Refresh balance after a short delay
      setTimeout(() => this.getBalances(), 3000);

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Deposit failed: ${errorMsg}`, 'error');
      console.error('Deposit error:', error);
    }
  }

  // ============ ON-CHAIN BALANCE ============

  async refreshOnChainBalances() {
    if (!this.userAddress) {
      this.log('Please connect wallet first', 'error');
      return;
    }

    this.log('Fetching on-chain custody balances...');
    this.onChainBalances.clear();

    const chainIds = Object.keys(this.config.chains).map(id => parseInt(id));

    for (const chainId of chainIds) {
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig?.chain || !chainConfig?.custody) continue;

      try {
        const publicClient = createPublicClient({
          chain: chainConfig.chain,
          transport: http()
        });

        const nitroliteService = new NitroliteService(
          publicClient,
          { custody: chainConfig.custody },
          null,
          this.userAddress
        );

        const balance = await nitroliteService.getAccountBalance(this.userAddress, chainConfig.token);
        this.onChainBalances.set(chainId, balance);

        if (balance > 0n) {
          this.log(`${chainConfig.name}: ${(Number(balance) / 1_000_000).toFixed(6)} USDC`);
        }
      } catch (error) {
        console.error(`Failed to fetch balance for chain ${chainId}:`, error);
      }
    }

    this.renderOnChainBalances();
  }

  renderOnChainBalances() {
    const container = this.elements.onChainBalanceContainer;
    if (!container) return;

    let hasBalance = false;
    let html = '';

    for (const [chainId, balance] of this.onChainBalances) {
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig) continue;

      const balanceFormatted = (Number(balance) / 1_000_000).toFixed(6);

      if (balance > 0n) {
        hasBalance = true;
        html += `
          <div style="background: rgba(76,175,80,0.15); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(76,175,80,0.4);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #4caf50;">${balanceFormatted} USDC</strong>
                <span style="color: #888; font-size: 0.85rem;"> on ${chainConfig.name}</span>
              </div>
              <button onclick="window.${this.prefix.replace('-', '')}app.withdrawFromOnChainLedger(${chainId}, '${chainConfig.token}', '${balance}')"
                style="background: #4caf50; color: white; padding: 0.4rem 0.8rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                Withdraw
              </button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div style="padding: 0.25rem 0; color: #666; font-size: 0.85rem;">
            ${chainConfig.name}: 0.00 USDC
          </div>
        `;
      }
    }

    if (this.onChainBalances.size === 0) {
      html = '<p style="color: #888; font-size: 0.9rem;">No chains checked yet.</p>';
    } else if (!hasBalance) {
      html = '<p style="color: #888; font-size: 0.9rem;">No on-chain custody balance found.</p>' + html;
    }

    container.innerHTML = html;
  }

  async withdrawFromOnChainLedger(chainId, tokenAddress, amount) {
    const chainConfig = this.config.chains[chainId];
    const amountFormatted = (Number(amount) / 1_000_000).toFixed(6);

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Withdraw from On-Chain Custody', parseFloat(amountFormatted))) {
      this.log('Withdrawal cancelled by user');
      return;
    }

    try {
      this.log(`Withdrawing ${amountFormatted} USDC from ${chainConfig.name} custody...`);

      // Switch chain if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

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

      const txHash = await nitroliteService.withdraw(tokenAddress, BigInt(amount));
      this.log(`Withdraw tx: ${txHash.slice(0, 10)}...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'success') {
        this.log('Withdrawal complete! USDC sent to your wallet.');
      } else {
        this.log('Withdrawal failed', 'error');
      }

      // Refresh on-chain balances
      await this.refreshOnChainBalances();

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Withdraw failed: ${errorMsg}`, 'error');
      console.error('Withdraw error:', error);
    }
  }

  // ============ DIRECT DEPOSIT TO CUSTODY ============

  async depositAndCreateChannel() {
    const chainId = parseInt(this.elements.depositCreateChainSelect?.value || '0');
    const amount = parseFloat(this.elements.depositCreateAmount?.value || '0');

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const chainConfig = this.config.chains[chainId];
    if (!chainConfig?.chain || !chainConfig?.custody) {
      this.log('Invalid chain selected or chain not supported', 'error');
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Deposit to Custody', amount)) {
      this.log('Operation cancelled by user');
      return;
    }

    try {
      this.log(`Depositing ${amount} USDC to custody on ${chainConfig.name}...`);

      // Switch chain if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: this.userAddress
      });
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const amountInUnits = parseUnits(amount.toString(), 6); // USDC has 6 decimals

      // Check wallet USDC balance
      const walletBalance = await publicClient.readContract({
        address: chainConfig.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.userAddress]
      });

      if (walletBalance < amountInUnits) {
        this.log(`Insufficient USDC in wallet. Have: ${formatUnits(walletBalance, 6)}, Need: ${amount}`, 'error');
        return;
      }

      // Check and request approval
      const allowance = await publicClient.readContract({
        address: chainConfig.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [this.userAddress, chainConfig.custody]
      });

      if (allowance < amountInUnits) {
        this.log('Requesting USDC approval...');

        const approveTxHash = await walletClient.writeContract({
          address: chainConfig.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [chainConfig.custody, amountInUnits]
        });

        this.log(`Approval tx: ${approveTxHash.slice(0, 10)}...`);
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
        this.log('Approval confirmed!');
      }

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        this.userAddress
      );

      this.log('Depositing to custody contract...');
      const depositTxHash = await nitroliteService.deposit(chainConfig.token, amountInUnits);
      this.log(`Deposit tx: ${depositTxHash.slice(0, 10)}...`);

      await publicClient.waitForTransactionReceipt({ hash: depositTxHash });
      this.log('Deposit confirmed! Funds are now in on-chain custody.');
      this.log('Note: Use "Refresh On-Chain Balance" to see your balance, and "Withdraw" to retrieve funds.');

      // Refresh balances
      await this.refreshOnChainBalances();

    } catch (error) {
      const errorMsg = error.cause?.message || error.shortMessage || error.message;
      this.log(`Deposit failed: ${errorMsg}`, 'error');
      console.error('Deposit error:', error);
    }
  }

  // ============ ON-CHAIN CHANNEL CREATION ============

  async createOnChainChannel() {
    const chainId = parseInt(this.elements.onChainChannelChainSelect?.value || '0');
    const partnerPrivateKey = this.elements.onChainChannelPartnerKey?.value.trim();
    const amount = parseFloat(this.elements.onChainChannelAmount?.value || '0');

    if (!partnerPrivateKey) {
      this.log('Please enter a valid partner private key', 'error');
      return;
    }

    // Add 0x prefix if not present
    const normalizedKey = partnerPrivateKey.replace(/^0x/, '');
    const fullKey = `0x${normalizedKey}`;

    // Derive partner address from private key
    let partnerAccount;
    try {
      partnerAccount = privateKeyToAccount(fullKey);
    } catch (e) {
      this.log('Invalid private key format', 'error');
      return;
    }

    const partnerAddress = partnerAccount.address;

    if (partnerAddress.toLowerCase() === this.userAddress.toLowerCase()) {
      this.log('Partner address cannot be the same as your address', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const chainConfig = this.config.chains[chainId];
    if (!chainConfig?.chain || !chainConfig?.custody || !chainConfig?.adjudicator) {
      this.log('Invalid chain selected or chain not fully configured', 'error');
      return;
    }

    // Refresh on-chain balance before checking (fixes race condition)
    this.log('Checking on-chain custody balance...');
    await this.refreshOnChainBalances();

    // Check on-chain custody balance
    const onChainBalance = this.onChainBalances.get(chainId) || 0n;
    const amountInUnits = parseUnits(amount.toString(), 6);

    if (onChainBalance < amountInUnits) {
      this.log(`Insufficient on-chain custody balance. Have: ${(Number(onChainBalance) / 1_000_000).toFixed(2)} USDC, Need: ${amount}`, 'error');
      this.log('Deposit funds to custody first using the "Deposit to Custody" button above.', 'error');
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Create On-Chain Channel', amount)) {
      this.log('Operation cancelled by user');
      return;
    }

    try {
      this.log(`Creating on-chain channel with partner ${partnerAddress.slice(0, 6)}...${partnerAddress.slice(-4)} on ${chainConfig.name}`);

      // Switch chain if needed
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

      const checksummedUser = getAddress(this.userAddress);
      const checksummedPartner = getAddress(partnerAddress);

      // Build channel structure
      const channel = {
        participants: [checksummedUser, checksummedPartner],
        adjudicator: chainConfig.adjudicator,
        challenge: 3600n, // 1 hour challenge period
        nonce: BigInt(Date.now())
      };

      // Build initial state with INITIALIZE intent (intent = 1)
      const initialState = {
        intent: 1, // INITIALIZE
        version: 0n,
        data: '0x',
        allocations: [
          {
            destination: checksummedUser,
            token: chainConfig.token,
            amount: amountInUnits
          },
          {
            destination: checksummedPartner,
            token: chainConfig.token,
            amount: 0n
          }
        ],
        sigs: []
      };

      // Calculate channel ID
      const channelIdHash = getChannelId(channel, chainId);
      this.log(`Channel ID: ${channelIdHash.slice(0, 10)}...`);

      // Get packed state for signing
      const packedState = getPackedState(channelIdHash, initialState);

      // Step 1: Get user signature via MetaMask
      this.log('Step 1/3: Requesting your signature via MetaMask...');

      const walletClient = createWalletClient({
        chain: chainConfig.chain,
        transport: custom(window.ethereum),
        account: checksummedUser
      });

      const userSignature = await walletClient.signMessage({
        account: checksummedUser,
        message: { raw: packedState }
      });

      this.log('Your signature obtained!');

      // Step 2: Sign with partner's private key programmatically
      this.log('Step 2/3: Signing with partner private key...');

      const partnerSignature = await partnerAccount.signMessage({
        message: { raw: packedState }
      });

      this.log('Partner signature obtained!');

      // Step 3: Submit the channel creation
      this.log('Step 3/3: Submitting channel creation transaction...');

      const signedState = {
        ...initialState,
        sigs: [userSignature, partnerSignature]
      };

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        walletClient,
        checksummedUser
      );

      // Debug: Verify custody balance directly from contract
      const actualCustodyBalance = await nitroliteService.getAccountBalance(checksummedUser, chainConfig.token);
      this.log(`Debug: Verified custody balance: ${(Number(actualCustodyBalance) / 1_000_000).toFixed(6)} USDC`);
      this.log(`Debug: Attempting to lock: ${(Number(amountInUnits) / 1_000_000).toFixed(6)} USDC`);
      this.log(`Debug: Balance check PASSED`);

      if (actualCustodyBalance < amountInUnits) {
        this.log(`Insufficient custody balance. Have: ${(Number(actualCustodyBalance) / 1_000_000).toFixed(6)}, Need: ${amount}`, 'error');
        return;
      }

      // Debug: Log all the parameters for external debugging
      console.log('=== DEBUG: On-Chain Channel Creation ===');
      console.log('Custody Contract (to):', chainConfig.custody);
      console.log('Channel:', JSON.stringify({
        participants: channel.participants,
        adjudicator: channel.adjudicator,
        challenge: channel.challenge.toString(),
        nonce: channel.nonce.toString()
      }, null, 2));
      console.log('State:', JSON.stringify({
        intent: signedState.intent,
        version: signedState.version.toString(),
        data: signedState.data,
        allocations: signedState.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: a.amount.toString()
        })),
        sigs: signedState.sigs
      }, null, 2));
      console.log('Channel ID:', channelIdHash);
      console.log('Packed State for signing:', packedState);
      console.log('User Signature:', userSignature);
      console.log('Partner Signature:', partnerSignature);
      console.log('Chain ID:', chainId);
      console.log('Sender:', checksummedUser);

      // Manually encode calldata for debugging
      const { encodeFunctionData } = await import('viem');
      const custodyAbi = [{
        name: 'create',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          {
            name: 'ch',
            type: 'tuple',
            components: [
              { name: 'participants', type: 'address[]' },
              { name: 'adjudicator', type: 'address' },
              { name: 'challenge', type: 'uint64' },
              { name: 'nonce', type: 'uint64' }
            ]
          },
          {
            name: 'initial',
            type: 'tuple',
            components: [
              { name: 'intent', type: 'uint8' },
              { name: 'version', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              {
                name: 'allocations',
                type: 'tuple[]',
                components: [
                  { name: 'destination', type: 'address' },
                  { name: 'token', type: 'address' },
                  { name: 'amount', type: 'uint256' }
                ]
              },
              { name: 'sigs', type: 'bytes[]' }
            ]
          }
        ],
        outputs: [{ name: 'channelId', type: 'bytes32' }]
      }];

      const calldata = encodeFunctionData({
        abi: custodyAbi,
        functionName: 'create',
        args: [
          {
            participants: channel.participants,
            adjudicator: channel.adjudicator,
            challenge: channel.challenge,
            nonce: channel.nonce
          },
          {
            intent: signedState.intent,
            version: signedState.version,
            data: signedState.data,
            allocations: signedState.allocations,
            sigs: signedState.sigs
          }
        ]
      });

      console.log('Encoded Calldata:', calldata);
      console.log('=== END DEBUG ===');

      const txHash = await nitroliteService.createChannel(channel, signedState);
      this.log(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel created on-chain successfully!');

        // Store channel info
        this.onChainChannels.set(channelIdHash, {
          channel,
          channelId: channelIdHash,
          chainId,
          chainConfig,
          tokenAddress: chainConfig.token,
          depositedAmount: Number(amountInUnits),
          partnerAddress: checksummedPartner
        });

        // Clear input
        if (this.elements.onChainChannelPartnerKey) this.elements.onChainChannelPartnerKey.value = '';

        this.renderChannelsList();
        await this.refreshOnChainBalances();
      } else {
        this.log('Transaction failed', 'error');
      }

    } catch (error) {
      console.error('On-chain channel error:', error);

      // Try to extract meaningful error information
      let errorMsg = 'Unknown error';

      // Check for contract revert data
      if (error.cause?.data) {
        // Try to decode known error selectors
        const errorData = error.cause.data;
        const errorSelectors = {
          '0x5a052d96': 'InsufficientBalance',
          '0x7dcb86b4': 'InvalidStateSignatures',
          '0x8f9d2ff8': 'InvalidParticipant',
          '0x4e487b71': 'Panic (arithmetic overflow/underflow)',
        };
        const selector = errorData.slice(0, 10);
        if (errorSelectors[selector]) {
          errorMsg = `Contract reverted with: ${errorSelectors[selector]}`;
          if (selector === '0x5a052d96' && errorData.length > 10) {
            // Try to decode InsufficientBalance(uint256 available, uint256 required)
            try {
              const available = BigInt('0x' + errorData.slice(10, 74));
              const required = BigInt('0x' + errorData.slice(74, 138));
              errorMsg += ` - Available: ${(Number(available) / 1_000_000).toFixed(6)}, Required: ${(Number(required) / 1_000_000).toFixed(6)}`;
            } catch (e) {}
          }
        } else {
          errorMsg = `Contract reverted with selector: ${selector}`;
        }
      } else if (error.shortMessage) {
        errorMsg = error.shortMessage;
      } else if (error.cause?.shortMessage) {
        errorMsg = error.cause.shortMessage;
      } else if (error.message) {
        errorMsg = error.message;
      }

      this.log(`Operation failed: ${errorMsg}`, 'error');
    }
  }

  // ============ APP SESSIONS ============

  async createAppSession() {
    const recipientAddress = this.elements.sessionRecipient?.value.trim();
    const amount = parseFloat(this.elements.sessionAmount?.value || '0');

    if (!recipientAddress || !recipientAddress.startsWith('0x')) {
      this.log('Please enter a valid recipient address', 'error');
      return;
    }

    if (recipientAddress.toLowerCase() === this.userAddress.toLowerCase()) {
      this.log('Cannot create session with yourself', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      // Check if user has on-chain balance they could use instead
      let totalOnChain = 0n;
      for (const balance of this.onChainBalances.values()) {
        totalOnChain += balance;
      }

      if (totalOnChain > 0n) {
        this.log(`⚠️ Off-chain balance is ${(this.ledgerBalance / 1_000_000).toFixed(2)} USDC, but you have ${(Number(totalOnChain) / 1_000_000).toFixed(2)} USDC on-chain.`, 'error');
        this.log('The off-chain payment session requires off-chain balance.', 'error');
        this.log('Options: 1) Use "Create On-Chain Channel" in On-Chain Balance section, or 2) Withdraw on-chain funds to wallet and re-deposit via proper method.', 'error');
      } else {
        this.log(`Insufficient balance. Available: ${(this.ledgerBalance / 1_000_000).toFixed(2)} USDC`, 'error');
      }
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Create Payment Session', amount)) {
      this.log('Session creation cancelled by user');
      return;
    }

    try {
      this.log(`Creating payment session with ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`);

      const checksummedRecipient = getAddress(recipientAddress);
      const checksummedUser = getAddress(this.userAddress);

      // App definition with NitroRPC/0.4 protocol
      const definition = {
        application: 'payment',
        protocol: 'NitroRPC/0.4',
        participants: [checksummedUser, checksummedRecipient],
        weights: [100, 0], // User A has full control over state updates
        quorum: 100,
        challenge: 0,
        nonce: Date.now()
      };

      // Initial allocations - all funds with user A, 0 with recipient
      const allocations = [
        {
          participant: checksummedUser,
          asset: this.config.asset,
          amount: amountInMicrounits.toString()
        },
        {
          participant: checksummedRecipient,
          asset: this.config.asset,
          amount: '0'
        }
      ];

      const message = await createAppSessionMessage(
        this.messageSigner,
        { definition, allocations }
      );

      console.log('Create app session message:', message);
      this.ws.send(message);

      this.log('App session request sent...');

    } catch (error) {
      this.log(`Failed to create app session: ${error.message}`, 'error');
      console.error('Create app session error:', error);
    }
  }

  handleCreateAppSessionResponse(data) {
    console.log('Create app session response:', data);

    if (data?.app_session_id) {
      const sessionId = data.app_session_id;
      this.log(`Payment session created: ${sessionId.slice(0, 10)}...`);

      // Clear inputs
      if (this.elements.sessionRecipient) this.elements.sessionRecipient.value = '';

      // Refresh sessions list
      this.getAppSessions();
      this.getBalances();
    } else {
      this.log(`App session response: ${JSON.stringify(data)}`);
    }
  }

  async getAppSessions() {
    if (!this.isAuthenticated) {
      return;
    }

    try {
      this.log('Fetching app sessions...');

      const message = createGetAppSessionsMessageV2(
        this.userAddress,
        'open' // Only get open sessions
      );

      console.log('Get app sessions message:', message);
      this.ws.send(message);

    } catch (error) {
      this.log(`Failed to get app sessions: ${error.message}`, 'error');
    }
  }

  handleGetAppSessionsResponse(data) {
    console.log('Get app sessions response:', data);

    this.appSessions = data?.app_sessions || [];
    this.log(`Found ${this.appSessions.length} active session(s)`);
    this.renderAppSessionsList();
  }

  renderAppSessionsList() {
    const container = this.elements.appSessionsList;
    if (!container) return;

    if (this.appSessions.length === 0) {
      container.innerHTML = '<p style="color: #888;">No active sessions. Create one above.</p>';
      return;
    }

    let html = '';
    this.appSessions.forEach(session => {
      const sessionIdShort = session.app_session_id?.slice(0, 10) + '...' || 'N/A';
      const status = session.status || 'unknown';

      // Determine counterparty and allocations
      const participants = session.participants || [];
      const isUserFirst = participants[0]?.toLowerCase() === this.userAddress.toLowerCase();
      const counterparty = isUserFirst ? participants[1] : participants[0];
      const counterpartyShort = counterparty ? `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : 'Unknown';

      // Get allocations if available
      let myAllocation = '0';
      let theirAllocation = '0';

      // Note: allocations might come from session data or need separate call
      // For now, show session info and allow actions

      html += `
        <div class="session-card">
          <div class="session-header">
            <span class="session-id">${sessionIdShort}</span>
            <span style="color: ${status === 'open' ? '#4caf50' : '#888'};">${status}</span>
          </div>
          <div class="counterparty">
            ${isUserFirst ? 'To:' : 'From:'} ${counterpartyShort}
          </div>
          ${status === 'open' ? `
            <div class="session-actions">
              ${isUserFirst ? `
                <button class="btn-pay" onclick="window.${this.prefix.replace('-', '')}app.promptPaySession('${session.app_session_id}', '${counterparty}')">
                  Pay
                </button>
              ` : ''}
              <button class="btn-close" onclick="window.${this.prefix.replace('-', '')}app.closeAppSession('${session.app_session_id}')">
                Close Session
              </button>
            </div>
          ` : ''}
        </div>
      `;
    });

    container.innerHTML = html;
  }

  promptPaySession(sessionId, counterparty) {
    const amountStr = prompt(`Enter amount to pay to ${counterparty.slice(0, 6)}...${counterparty.slice(-4)} (USDC):`);
    if (amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount) && amount > 0) {
        this.payOnSession(sessionId, amount);
      } else {
        this.log('Invalid amount', 'error');
      }
    }
  }

  async payOnSession(sessionId, payAmount) {
    const amountInMicrounits = Math.floor(payAmount * 1_000_000);

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Pay on Session', payAmount)) {
      this.log('Payment cancelled by user');
      return;
    }

    try {
      this.log(`Paying ${payAmount} USDC on session ${sessionId.slice(0, 10)}...`);

      // Find the session
      const session = this.appSessions.find(s => s.app_session_id === sessionId);
      if (!session) {
        this.log('Session not found', 'error');
        return;
      }

      const participants = session.participants || [];
      const isUserFirst = participants[0]?.toLowerCase() === this.userAddress.toLowerCase();
      const counterparty = isUserFirst ? participants[1] : participants[0];

      // For NitroRPC/0.4, we need to provide intent, version, and allocations
      // The payment moves funds from user to counterparty
      const newVersion = (session.version || 0) + 1;

      // Build new allocations - this is a simplified version
      // In a real app, you'd track current allocations and update them
      const params = {
        app_session_id: sessionId,
        intent: 'operate',
        version: newVersion,
        allocations: [
          {
            participant: getAddress(this.userAddress),
            asset: this.config.asset,
            amount: '0' // Simplified: give all remaining to counterparty
          },
          {
            participant: getAddress(counterparty),
            asset: this.config.asset,
            amount: amountInMicrounits.toString()
          }
        ]
      };

      const message = await createSubmitAppStateMessage(
        this.messageSigner,
        params
      );

      console.log('Submit app state message:', message);
      this.ws.send(message);

      this.log('Payment request sent...');

    } catch (error) {
      this.log(`Failed to pay on session: ${error.message}`, 'error');
      console.error('Pay on session error:', error);
    }
  }

  handleSubmitAppStateResponse(data) {
    console.log('Submit app state response:', data);

    if (data?.app_session_id) {
      this.log('Payment successful!');
      this.getAppSessions();
      this.getBalances();
    } else {
      this.log(`App state response: ${JSON.stringify(data)}`);
    }
  }

  async closeAppSession(sessionId) {
    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Close Payment Session', 0)) {
      this.log('Session close cancelled by user');
      return;
    }

    try {
      this.log(`Closing session ${sessionId.slice(0, 10)}...`);

      const session = this.appSessions.find(s => s.app_session_id === sessionId);
      if (!session) {
        this.log('Session not found', 'error');
        return;
      }

      const participants = session.participants || [];

      // Final allocations - close with current state
      // In a real app, you'd have the current allocation state
      const allocations = participants.map(p => ({
        participant: getAddress(p),
        asset: this.config.asset,
        amount: '0' // Will be determined by current state on server
      }));

      const message = await createCloseAppSessionMessage(
        this.messageSigner,
        {
          app_session_id: sessionId,
          allocations
        }
      );

      console.log('Close app session message:', message);
      this.ws.send(message);

      this.log('Close session request sent...');

    } catch (error) {
      this.log(`Failed to close session: ${error.message}`, 'error');
      console.error('Close session error:', error);
    }
  }

  handleCloseAppSessionResponse(data) {
    console.log('Close app session response:', data);

    if (data?.app_session_id) {
      this.log('Session closed! Funds returned to ledger balance.');
      this.getAppSessions();
      this.getBalances();
    } else {
      this.log(`Close session response: ${JSON.stringify(data)}`);
    }
  }

  // ============ LEGACY TRANSFER (Quick Send) ============

  async createSession() {
    const partnerAddress = this.elements.partnerAddress?.value.trim();
    const initialAmount = parseFloat(this.elements.initialAmount?.value || '0');

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

    if (this.ledgerBalance <= 0) {
      this.log('No balance available. Please deposit funds first.', 'error');
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Send Transfer', initialAmount)) {
      this.log('Transfer cancelled by user');
      return;
    }

    try {
      this.log('Creating transfer...');

      const amountInMicrounits = Math.floor(initialAmount * 1_000_000).toString();

      const transferParams = {
        destination: partnerAddress,
        allocations: [{
          asset: this.config.asset,
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

    } catch (error) {
      this.log(`Failed to create transfer: ${error.message}`, 'error');
    }
  }

  updateBalanceDisplay() {
    const displayAmount = (this.balance / 1_000_000).toFixed(2);
    if (this.elements.balance) {
      this.elements.balance.textContent = `${displayAmount} USDC`;
    }
  }

  // ============ Channel Management ============

  async createChannel() {
    const chainId = parseInt(this.elements.chainSelect?.value || '0');
    const amount = parseFloat(this.elements.channelAmount?.value || '0');

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

    const chainConfig = this.config.chains[chainId];
    if (!chainConfig) {
      this.log('Invalid chain selected', 'error');
      return;
    }

    try {
      this.log(`Creating channel on ${chainConfig.name} with ${amount} USDC...`);

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

  async withdrawToWallet() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    const amount = parseFloat(this.elements.channelAmount?.value || '0');
    if (!amount || amount <= 0) {
      this.log('Please enter a valid amount', 'error');
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      this.log(`Insufficient balance. Available: ${(this.ledgerBalance / 1_000_000).toFixed(2)} USDC`, 'error');
      return;
    }

    const chainId = parseInt(this.elements.chainSelect?.value || '0');
    const chainConfig = this.config.chains[chainId];

    if (!chainConfig) {
      this.log('Invalid chain selected', 'error');
      return;
    }

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Withdraw to Wallet', amount)) {
      this.log('Withdrawal cancelled by user');
      return;
    }

    try {
      this.log(`Starting withdrawal: ${amount} USDC to ${chainConfig.name}`);
      this.log('Step 1/4: Creating off-chain channel...');

      this.pendingWithdrawal = {
        step: 'create_channel',
        amount: amountInMicrounits,
        chainId,
        chainConfig
      };

      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: chainId,
          token: chainConfig.token
        }
      );

      this.ws.send(channelMessage);

    } catch (error) {
      this.log(`Withdrawal failed: ${error.message}`, 'error');
      console.error('Withdrawal error:', error);
      this.pendingWithdrawal = null;
    }
  }

  async getChannels() {
    if (!this.isAuthenticated) {
      this.log('Please authenticate first', 'error');
      return;
    }

    try {
      this.log('Fetching channels...');

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
      const chainId = parseInt(this.elements.chainSelect?.value || '0');
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig) {
        this.log('Invalid chain selected', 'error');
        return;
      }

      this.log(`Checking custody balance on ${chainConfig.name}...`);

      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const currentChainIdDecimal = parseInt(currentChainId, 16);
      if (currentChainIdDecimal !== chainId) {
        this.log(`Please switch to ${chainConfig.name} in your wallet first`, 'error');
        return;
      }

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http()
      });

      const nitroliteService = new NitroliteService(
        publicClient,
        { custody: chainConfig.custody },
        null,
        this.userAddress
      );

      const balance = await nitroliteService.getAccountBalance(this.userAddress, chainConfig.token);
      const balanceFormatted = (Number(balance) / 1_000_000).toFixed(6);

      this.log(`Custody balance: ${balanceFormatted} USDC`);

      if (balance > 0n) {
        this.log('You have funds in custody! Click withdraw to get them.');
        const container = this.elements.channelsList;
        if (container) {
          container.innerHTML = `
            <div style="background: rgba(76,175,80,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(76,175,80,0.5);">
              <p style="color: #4caf50; margin-bottom: 0.5rem;"><strong>Custody Balance: ${balanceFormatted} USDC</strong></p>
              <p style="font-size: 0.8rem; color: #aaa; margin-bottom: 0.5rem;">on ${chainConfig.name}</p>
              <button onclick="window.${this.prefix.replace('-', '')}app.withdrawFromCustody(${chainId}, '${chainConfig.token}', '${balance}')"
                style="background: #4caf50; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                Withdraw to Wallet
              </button>
            </div>
          ` + container.innerHTML;
        }
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
    // Mainnet confirmation
    const amountFormatted = (Number(amount) / 1_000_000).toFixed(6);
    if (!await this.confirmMainnetAction('Withdraw from Custody', parseFloat(amountFormatted))) {
      this.log('Withdrawal cancelled by user');
      return;
    }

    try {
      const chainConfig = this.config.chains[chainId];
      this.log(`Withdrawing ${amountFormatted} USDC from custody...`);

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

      const txHash = await nitroliteService.withdraw(tokenAddress, BigInt(amount));
      this.log(`Withdraw tx: ${txHash.slice(0, 10)}...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'success') {
        this.log('Withdrawal complete! Tokens sent to your wallet.');
      } else {
        this.log('Withdrawal failed', 'error');
      }

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

    // Mainnet confirmation
    if (!await this.confirmMainnetAction('Close Channel', 0)) {
      this.log('Channel close cancelled by user');
      return;
    }

    try {
      this.log(`Closing channel ${channelId.slice(0, 10)}...`);

      const closeMessage = await createCloseChannelMessage(
        this.messageSigner,
        channelId,
        this.userAddress
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

      this.pendingChannelId = data.channel_id;
      this.pendingChannelData = data;

      if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'create_channel') {
        if (!data?.channel_id || !data?.channel || !data?.state || !data?.server_signature) {
          this.log('Channel creation failed - missing data', 'error');
          this.pendingWithdrawal = null;
          return;
        }

        const { amount, chainId, chainConfig } = this.pendingWithdrawal;

        this.log('Step 2/4: Submitting channel on-chain (with 0 allocations)...');
        this.log('Server requires channel to exist on-chain before we can allocate funds');

        this.pendingWithdrawal.step = 'submit_on_chain';
        this.pendingWithdrawal.channelId = data.channel_id;
        this.pendingWithdrawal.channelData = data;

        await this.submitChannelOnChainForWithdrawal(data, chainId, chainConfig);
        return;
      } else if (this.pendingChannelFund) {
        this.log('Channel created for funding...');
      }

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
      const chainId = parseInt(this.elements.chainSelect?.value || '0');
      const chainConfig = this.config.chains[chainId];

      if (!chainConfig?.custody) {
        this.log('No custody address configured for this chain', 'error');
        return;
      }

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

      const nitroliteService = new NitroliteService(
        this.publicClient,
        { custody: chainConfig.custody },
        this.walletClient,
        this.userAddress
      );

      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

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

      const channelIdCalculated = getChannelId(channel, chainId);
      this.log(`Channel ID: ${channelIdCalculated.slice(0, 10)}...`);

      const packedState = getPackedState(channelIdCalculated, unsignedState);

      this.log('Requesting wallet signature for state...');
      const userSignature = await this.walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      const signedState = {
        ...unsignedState,
        sigs: [userSignature, channelData.server_signature]
      };

      this.log('Creating channel on-chain (requires wallet approval)...');
      console.log('On-chain channel data:', { channel, signedState, channelIdCalculated });

      const txHash = await nitroliteService.createChannel(channel, signedState);
      this.log(`On-chain tx submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel created on-chain!');

        this.onChainChannels.set(channelData.channel_id, {
          channel,
          channelId: channelIdCalculated,
          chainId,
          chainConfig,
          tokenAddress: chainConfig.token
        });

        this.renderChannelsList();

        if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'submit_on_chain') {
          const { amount, channelId } = this.pendingWithdrawal;
          this.pendingWithdrawal.step = 'allocate_funds';
          this.log(`Step 2/4: Channel on-chain, allocating ${(amount / 1_000_000).toFixed(2)} USDC...`);
          await this.allocateFundsToChannel(channelId, amount);
        } else if (this.pendingChannelFund) {
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
      const errorDetails = error.cause?.message || error.cause?.shortMessage || error.shortMessage || error.message;
      const errorReason = error.cause?.reason || error.reason || '';
      this.log(`On-chain submission failed: ${errorDetails}`, 'error');
      if (errorReason) {
        this.log(`Reason: ${errorReason}`, 'error');
      }
      console.error('On-chain error:', error);
      this.pendingChannelFund = null;
    }
  }

  async submitChannelOnChainForWithdrawal(channelData, chainId, chainConfig) {
    try {
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

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

      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      const channelIdHash = getChannelId(channel, chainId);
      this.log(`Channel ID: ${channelIdHash.slice(0, 10)}...`);

      const initialState = {
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

      const packedState = getPackedState(channelIdHash, initialState);
      this.log('Requesting wallet signature...');
      const userSignature = await walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      const signedState = {
        ...initialState,
        sigs: [userSignature, channelData.server_signature]
      };

      this.log('Creating channel on-chain (requires gas)...');
      const txHash = await nitroliteService.createChannel(channel, signedState);
      this.log(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel created on-chain!');

        this.onChainChannels.set(channelData.channel_id, {
          channel,
          channelId: channelIdHash,
          chainId,
          chainConfig,
          tokenAddress: chainConfig.token
        });

        this.log('Step 3/4: Moving funds from ledger to on-chain custody...');
        const { amount } = this.pendingWithdrawal;
        this.log(`Moving ${(amount / 1_000_000).toFixed(2)} USDC to custody contract`);

        const resizeMessage = await createResizeChannelMessage(
          this.messageSigner,
          {
            channel_id: channelData.channel_id,
            resize_amount: BigInt(amount),
            funds_destination: this.userAddress
          }
        );

        this.pendingWithdrawal.step = 'allocate_to_channel';

        this.ws.send(resizeMessage);

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

  handleGetChannelsResponse(data) {
    console.log('Get channels response:', data);
    this.channels = data?.channels || [];
    this.renderChannelsList();
  }

  handleChannelsBroadcast(data) {
    console.log('Channels broadcast:', data);
    const channels = data?.channels || [];

    channels.forEach(ch => {
      if (ch.channel_id) {
        this.serverChannels.set(ch.channel_id, ch);
        console.log(`Stored server channel: ${ch.channel_id.slice(0, 10)}...`);
      }
    });

    if (channels.length > 0) {
      this.channels = channels;
      this.renderChannelsList();
    }
  }

  async handleResizeChannelResponse(data) {
    console.log('Resize channel response:', data);

    if (this.pendingWithdrawal && this.pendingWithdrawal.step === 'allocate_to_channel') {
      if (!data?.channel_id) {
        this.log('Resize failed', 'error');
        console.error('Resize response:', data);
        this.pendingWithdrawal = null;
        return;
      }

      const { channelId } = this.pendingWithdrawal;

      const userAllocation = data.state?.allocations?.find(a =>
        a.destination.toLowerCase() === this.userAddress.toLowerCase()
      );
      if (userAllocation) {
        this.log(`Funds moved to custody: ${(parseInt(userAllocation.amount) / 1_000_000).toFixed(2)} USDC`);
      }

      this.log('Step 4/4: Closing channel to withdraw to wallet...');

      try {
        const closeMessage = await createCloseChannelMessage(
          this.messageSigner,
          channelId,
          this.userAddress
        );

        this.pendingWithdrawal.step = 'close_channel';

        this.ws.send(closeMessage);

      } catch (error) {
        this.log(`Close failed: ${error.message}`, 'error');
        this.pendingWithdrawal = null;
      }
      return;
    }

    if (data?.channel_id || data?.success) {
      this.log('Channel funded! Funds allocated to channel.');
      this.log('Close the channel to withdraw funds on-chain.');
      this.getChannels();
      this.getBalances();
    } else {
      this.log(`Resize response: ${JSON.stringify(data)}`);
    }
  }

  async handleCloseChannelResponse(data) {
    console.log('Close channel response:', data);

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

    if (data?.channel_id && data?.state && data?.server_signature) {
      this.log('Received final state, closing channel on-chain...');
      await this.submitCloseChannelOnChain(data);
    } else if (data?.success || data?.channel_id) {
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

      if (!onChainData) {
        const serverChannel = this.serverChannels.get(channelId);
        if (serverChannel) {
          this.log('Reconstructing channel from server data...');

          const brokerAddress = closeData.state?.allocations?.[1]?.destination;
          if (!brokerAddress) {
            this.log('Cannot determine broker address from close response', 'error');
            return;
          }

          const chainId = serverChannel.chain_id;
          const chainConfig = this.config.chains[chainId];
          if (!chainConfig) {
            this.log(`Unsupported chain: ${chainId}`, 'error');
            return;
          }

          const channel = {
            participants: [getAddress(serverChannel.participant), getAddress(brokerAddress)],
            adjudicator: getAddress(serverChannel.adjudicator),
            challenge: BigInt(serverChannel.challenge),
            nonce: BigInt(serverChannel.nonce)
          };

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

      const nitroliteService = new NitroliteService(
        this.publicClient,
        { custody: chainConfig.custody },
        this.walletClient,
        this.userAddress
      );

      const finalState = {
        intent: closeData.state.intent || 2,
        version: BigInt(closeData.state.version),
        data: closeData.state.state_data || '0x',
        allocations: closeData.state.allocations.map(a => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount)
        })),
        sigs: []
      };

      const packedState = getPackedState(channelIdHash, finalState);

      this.log('Requesting wallet signature for close...');
      const userSignature = await this.walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      const signedFinalState = {
        ...finalState,
        sigs: [userSignature, closeData.server_signature]
      };

      this.log('Closing channel on-chain (requires wallet approval)...');
      console.log('Close channel on-chain data:', { channelIdHash, signedFinalState });

      const txHash = await nitroliteService.close(channelIdHash, signedFinalState, []);
      this.log(`Close tx submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Channel closed on-chain! Funds released to custody.');

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
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(currentChainId, 16) !== chainId) {
        this.log(`Switching to ${chainConfig.name}...`);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        });
      }

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

      const channel = {
        participants: channelData.channel.participants,
        adjudicator: channelData.channel.adjudicator,
        challenge: BigInt(channelData.channel.challenge),
        nonce: BigInt(channelData.channel.nonce)
      };

      const channelIdHash = getChannelId(channel, chainId);

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

      const packedState = getPackedState(channelIdHash, finalState);
      this.log('Requesting wallet signature...');
      const userSignature = await walletClient.signMessage({
        account: this.userAddress,
        message: { raw: packedState }
      });

      const signedFinalState = {
        ...finalState,
        sigs: [userSignature, closeData.server_signature]
      };

      this.log('Submitting close transaction (requires gas)...');
      const txHash = await nitroliteService.close(channelIdHash, signedFinalState, []);
      this.log(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      this.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        this.log('Withdrawal complete!');
        this.log(`Check your wallet on ${chainConfig.name} for the USDC tokens.`);

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
    if (!container) return;

    let html = '';

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
              <button onclick="window.${this.prefix.replace('-', '')}app.closeChannel('${channelId}')"
                style="background: #f44336; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                Close & Withdraw
              </button>
            </div>
          </div>
        `;
      });
    }

    if (this.channels.length > 0) {
      html += '<p style="color: #aaa; font-size: 0.85rem; margin-bottom: 0.5rem; margin-top: 0.5rem;">Off-Chain Channels:</p>';
      html += this.channels.map(ch => {
        const chainConfig = this.config.chains[ch.chain_id];
        const chainName = chainConfig?.name || `Chain ${ch.chain_id}`;
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
                <button onclick="window.${this.prefix.replace('-', '')}app.closeChannel('${ch.channel_id}')"
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

// Initialize both testnet and mainnet app instances
function initializeApps() {
  window.testnetapp = new YellowPaymentApp('testnet', 'testnet-');
  window.mainnetapp = new YellowPaymentApp('mainnet', 'mainnet-');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApps);
} else {
  initializeApps();
}
