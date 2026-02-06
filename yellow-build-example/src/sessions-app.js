import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  parseAuthChallengeResponse,
  createEIP712AuthMessageSigner,
  createGetLedgerBalancesMessage,
  createGetConfigMessageV2,
  createAppSessionMessage,
  createGetAppSessionsMessageV2,
  createSubmitAppStateMessage,
  createCloseAppSessionMessage,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  createGetChannelsMessageV2,
  createECDSAMessageSigner,
  EIP712AuthTypes,
  getChannelId,
  getPackedState,
  NitroliteService,
} from "@erc7824/nitrolite";
import {
  getAddress,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  erc20Abi,
  encodeFunctionData,
  toHex,
  keccak256,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, mainnet } from "viem/chains";

// Custody contract ABI for deposit function
const custodyDepositAbi = [
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Custody contract ABI for depositAndCreate function
const custodyDepositAndCreateAbi = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      {
        name: "ch",
        type: "tuple",
        components: [
          { name: "participants", type: "address[]" },
          { name: "adjudicator", type: "address" },
          { name: "challenge", type: "uint64" },
          { name: "nonce", type: "uint64" },
        ],
      },
      {
        name: "initial",
        type: "tuple",
        components: [
          { name: "intent", type: "uint8" },
          { name: "version", type: "uint256" },
          { name: "data", type: "bytes" },
          {
            name: "allocations",
            type: "tuple[]",
            components: [
              { name: "destination", type: "address" },
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "sigs", type: "bytes[]" },
        ],
      },
    ],
    name: "depositAndCreate",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "payable",
    type: "function",
  },
];

// Mainnet configuration for sessions - supports multiple chains
const SESSIONS_CONFIG = {
  wsUrl: "wss://clearnet.yellow.com/ws",
  asset: "usdc",
  sessionExpiryHours: 1,
  // All supported chains
  chains: {
    1: {
      id: 1,
      name: "Ethereum",
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Circle USDC
      custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
      adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
      rpcUrl: "https://eth.llamarpc.com",
      explorerUrl: "https://etherscan.io",
    },
    8453: {
      id: 8453,
      name: "Base",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
      custody: "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6",
      adjudicator: "0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C",
      rpcUrl: "https://mainnet.base.org",
      explorerUrl: "https://basescan.org",
    },
  },
  // Default chain for operations
  chain: {
    id: 8453,
    name: "Base",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    custody: "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6",
    adjudicator: "0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
  },
};

export class SessionsApp {
  constructor() {
    this.ws = null;
    this.messageSigner = null;
    this.userAddress = null;
    this.isAuthenticated = false;
    this.pendingAuthResolve = null;
    this.sessionKeyPrivate = null;
    this.sessionKeyAddress = null;
    this.ledgerBalance = 0;
    this.appSessions = [];
    this.publicClient = null;
    this.walletClient = null;
    this.nitroliteService = null;
    this.authTimeoutId = null;
    this.channels = [];
    this.activeChannel = null; // Current channel with clearnode
    this.channelStates = new Map(); // Store channel states for proofs: channelId -> state
    this.fetchedChannelData = null; // For on-chain force close
    this.pendingCreateChannelOnly = false; // For create channel without deposit

    this.initUI();
    this.connectWebSocket();
  }

  // Get element by ID with sessions- prefix
  getElement(id) {
    return document.getElementById("sessions-" + id);
  }

  initUI() {
    this.elements = {
      wsStatus: this.getElement("wsStatus"),
      wsStatusText: this.getElement("wsStatusText"),
      walletStatus: this.getElement("walletStatus"),
      walletStatusText: this.getElement("walletStatusText"),
      userAddress: this.getElement("userAddress"),
      connectBtn: this.getElement("connectBtn"),
      ledgerBalance: this.getElement("ledgerBalance"),
      custodyBalanceDisplay: this.getElement("custodyBalanceDisplay"),
      channelBalanceDisplay: this.getElement("channelBalanceDisplay"),
      refreshBalancesBtn: this.getElement("refreshBalancesBtn"),
      depositAmount: this.getElement("depositAmount"),
      depositBtn: this.getElement("depositBtn"),
      syncSection: this.getElement("syncSection"),
      withdrawCustodyBtn: this.getElement("withdrawCustodyBtn"),
      withdrawAmount: this.getElement("withdrawAmount"),
      withdrawBtn: this.getElement("withdrawBtn"),
      partnerAddress: this.getElement("partnerAddress"),
      sessionAmount: this.getElement("sessionAmount"),
      createSessionBtn: this.getElement("createSessionBtn"),
      sessionsList: this.getElement("sessionsList"),
      refreshSessionsBtn: this.getElement("refreshSessionsBtn"),
      activityLog: this.getElement("activityLog"),
      // Resize elements
      resizeCard: this.getElement("resizeCard"),
      resizeChannelId: this.getElement("resizeChannelId"),
      resizeAmount: this.getElement("resizeAmount"),
      resizeDirection: this.getElement("resizeDirection"),
      resizeBtn: this.getElement("resizeBtn"),
      resizeStatus: this.getElement("resizeStatus"),
      closeChannelBtn: this.getElement("closeChannelBtn"),
      channelsList: this.getElement("channelsList"),
      refreshChannelsBtn: this.getElement("refreshChannelsBtn"),
      // Create channel elements
      createChannelBtn: this.getElement("createChannelBtn"),
      createChannelStatus: this.getElement("createChannelStatus"),
      // Force close elements
      forceCloseChannelId: this.getElement("forceCloseChannelId"),
      fetchChannelDataBtn: this.getElement("fetchChannelDataBtn"),
      forceCloseBtn: this.getElement("forceCloseBtn"),
      channelDataDisplay: this.getElement("channelDataDisplay"),
      channelStatusDisplay: this.getElement("channelStatusDisplay"),
      channelStateDisplay: this.getElement("channelStateDisplay"),
      channelAllocationsDisplay: this.getElement("channelAllocationsDisplay"),
      forceCloseStatus: this.getElement("forceCloseStatus"),
      // Payment modal
      paymentModal: this.getElement("paymentModal"),
      paymentSessionId: this.getElement("paymentSessionId"),
      paymentPartner: this.getElement("paymentPartner"),
      paymentMyBalance: this.getElement("paymentMyBalance"),
      paymentPartnerBalance: this.getElement("paymentPartnerBalance"),
      paymentVersion: this.getElement("paymentVersion"),
      paymentDirection: this.getElement("paymentDirection"),
      paymentAmount: this.getElement("paymentAmount"),
      paymentSendBtn: this.getElement("paymentSendBtn"),
      paymentCloseBtn: this.getElement("paymentCloseBtn"),
      paymentCancelBtn: this.getElement("paymentCancelBtn"),
      closeSessionBtn: this.getElement("closeSessionBtn"),
    };

    // Event listeners
    this.elements.connectBtn?.addEventListener("click", () =>
      this.connectWallet()
    );
    this.elements.refreshBalancesBtn?.addEventListener("click", () =>
      this.refreshAllBalances()
    );
    this.elements.depositBtn?.addEventListener("click", () =>
      this.depositFunds()
    );
    this.elements.resizeBtn?.addEventListener("click", () =>
      this.requestResize()
    );
    this.elements.closeChannelBtn?.addEventListener("click", () =>
      this.closeChannelManual()
    );
    this.elements.refreshChannelsBtn?.addEventListener("click", () =>
      this.getChannels()
    );
    this.elements.createChannelBtn?.addEventListener("click", () =>
      this.createChannelOnly()
    );
    this.elements.fetchChannelDataBtn?.addEventListener("click", () =>
      this.fetchChannelDataOnChain()
    );
    this.elements.forceCloseBtn?.addEventListener("click", () =>
      this.forceCloseChannelOnChain()
    );
    this.elements.withdrawCustodyBtn?.addEventListener("click", () =>
      this.withdrawFromCustodyDirect()
    );
    this.elements.withdrawBtn?.addEventListener("click", () =>
      this.withdrawFunds()
    );
    this.elements.createSessionBtn?.addEventListener("click", () =>
      this.createAppSession()
    );
    this.elements.refreshSessionsBtn?.addEventListener("click", () =>
      this.getAppSessions()
    );
    this.elements.paymentSendBtn?.addEventListener("click", () =>
      this.sendPayment()
    );
    this.elements.paymentCancelBtn?.addEventListener("click", () =>
      this.hidePaymentModal()
    );
    this.elements.paymentCloseBtn?.addEventListener("click", () =>
      this.hidePaymentModal()
    );
    this.elements.closeSessionBtn?.addEventListener("click", () =>
      this.closeCurrentSession()
    );
  }

  log(message, type = "info") {
    console.log(`[Sessions] ${message}`);
    if (!this.elements.activityLog) return;

    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = new Date().toLocaleTimeString();
    const prefix = type === "error" ? "❌" : type === "success" ? "✅" : "📝";
    entry.innerHTML = `<span style="color: #888;">[${time}]</span> ${prefix} ${message}`;
    this.elements.activityLog.insertBefore(
      entry,
      this.elements.activityLog.firstChild
    );

    // Keep log limited
    while (this.elements.activityLog.children.length > 50) {
      this.elements.activityLog.removeChild(
        this.elements.activityLog.lastChild
      );
    }
  }

  connectWebSocket() {
    this.log("Connecting to Yellow Network (Mainnet)...");

    this.ws = new WebSocket(SESSIONS_CONFIG.wsUrl);

    this.ws.onopen = async () => {
      this.elements.wsStatus?.classList.add("connected");
      if (this.elements.wsStatusText) {
        this.elements.wsStatusText.textContent = "Connected to Yellow Network";
      }
      this.log("Connected to Yellow Network!", "success");

      // Auto re-authenticate if wallet was connected
      if (this.userAddress && !this.isAuthenticated) {
        this.log("Re-authenticating...");
        try {
          await this.authenticate();
          this.log("Re-authenticated successfully!", "success");
          this.enableButtons();
          await this.getChannels();
          await this.getBalances();
          await this.getAppSessions();
        } catch (error) {
          this.log(`Re-authentication failed: ${error.message}`, "error");
        }
      }
    };

    this.ws.onclose = () => {
      this.elements.wsStatus?.classList.remove("connected");
      if (this.elements.wsStatusText) {
        this.elements.wsStatusText.textContent = "Disconnected";
      }
      this.isAuthenticated = false;
      this.log("Disconnected from Yellow Network");

      // Auto-reconnect
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      this.log(`WebSocket error: ${error.message || "Unknown error"}`, "error");
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  handleMessage(data) {
    let parsed;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      return;
    }

    console.log("[Sessions] WebSocket message:", parsed);

    if (parsed.res) {
      const [requestId, method, responseData, timestamp] = parsed.res;

      switch (method) {
        case "auth_challenge":
          this.handleAuthChallenge(responseData, requestId);
          break;

        case "auth_verify":
          this.log("Authentication successful!", "success");
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

        case "get_ledger_balances":
          this.handleBalanceResponse(responseData);
          break;

        case "create_app_session":
          this.handleCreateAppSessionResponse(responseData);
          break;

        case "get_app_sessions":
          this.handleGetAppSessionsResponse(responseData);
          break;

        case "submit_app_state":
          this.handleSubmitAppStateResponse(responseData);
          break;

        case "close_app_session":
          this.handleCloseAppSessionResponse(responseData);
          break;

        case "create_channel":
          this.handleCreateChannelResponse(responseData);
          break;

        case "resize_channel":
          this.handleResizeChannelResponse(responseData);
          break;

        case "close_channel":
          this.handleCloseChannelResponse(responseData);
          break;

        case "get_channels":
          this.handleGetChannelsResponse(responseData);
          break;

        case "get_config":
          this.handleGetConfigResponse(responseData);
          break;

        // Push notifications from clearnode
        case "assets":
          this.handleAssetsNotification(responseData);
          break;

        case "channels":
          this.handleChannelsNotification(responseData);
          break;

        case "balance_update":
          this.handleBalanceUpdateNotification(responseData);
          break;

        case "app_session_update":
          this.handleAppSessionUpdateNotification(responseData);
          break;

        case "error":
          const errorMsg = responseData?.error || JSON.stringify(responseData);
          this.log(`Error: ${errorMsg}`, "error");

          // Update resize status if there was a pending on-chain resize
          if (this.pendingOnChainResize && this.elements.resizeStatus) {
            this.elements.resizeStatus.textContent = `Server rejected: ${errorMsg}`;
            this.elements.resizeStatus.style.color = "#f44336";
            this.pendingOnChainResize = null;
          }

          // Handle resize retry for "insufficient unified balance" error
          if (
            errorMsg.includes("insufficient unified balance") &&
            this.pendingResize
          ) {
            const { channelId, amount, retryCount } = this.pendingResize;
            if (retryCount < 3) {
              this.log(
                `Retrying resize in 5 seconds... (attempt ${retryCount + 2}/4)`
              );
              setTimeout(async () => {
                await this.resizeChannelToLedger(
                  channelId,
                  amount,
                  retryCount + 1
                );
              }, 5000);
            } else {
              this.log("Max retries reached. Please try again later.", "error");
              this.pendingResize = null;
            }
          }
          break;

        default:
          console.log(`[Sessions] Unhandled method: ${method}`, responseData);
      }
    }
  }

  // Push notification handlers
  handleGetConfigResponse(data) {
    console.log("[Sessions] ========== CLEARNODE CONFIG ==========");
    console.log("[Sessions] Config response:", data);
    if (data) {
      console.log(
        "[Sessions] Broker address:",
        data.broker_address || data.brokerAddress
      );
      console.log("[Sessions] Networks:", data.networks);
      if (data.networks) {
        data.networks.forEach((network, idx) => {
          console.log(`[Sessions] Network ${idx + 1}:`, {
            chain_id: network.chain_id,
            name: network.name,
            custody: network.custody,
            adjudicator: network.adjudicator,
            tokens: network.tokens,
          });
        });
      }
    }
    console.log("[Sessions] =====================================");
    this.log("Received clearnode config");
  }

  handleAssetsNotification(data) {
    console.log("[Sessions] ========== ASSETS NOTIFICATION ==========");
    console.log("[Sessions] Assets data:", data);
    if (Array.isArray(data?.assets || data)) {
      const assets = data?.assets || data;
      assets.forEach((asset, idx) => {
        console.log(`[Sessions] Asset ${idx + 1}:`, asset);
      });
    }
    console.log("[Sessions] ========================================");
    // Assets info from clearnode - typically sent after auth
  }

  handleChannelsNotification(data) {
    console.log("[Sessions] Channels notification:", data);
    this.processChannels(data);
  }

  handleGetChannelsResponse(data) {
    console.log("[Sessions] Get channels response (raw):", data);
    console.log("[Sessions] Response type:", typeof data);
    console.log("[Sessions] Has channels property:", !!data?.channels);
    console.log("[Sessions] Is array:", Array.isArray(data));
    this.processChannels(data?.channels || data);
  }

  processChannels(data) {
    console.log("[Sessions] processChannels input:", data);
    console.log(
      "[Sessions] processChannels input type:",
      typeof data,
      "isArray:",
      Array.isArray(data)
    );

    if (Array.isArray(data)) {
      this.channels = data;

      // Log all channel details with ALL keys to see actual structure
      console.log("[Sessions] All channels:", data);
      data.forEach((ch, idx) => {
        console.log(
          `[Sessions] Channel ${idx + 1} - ALL KEYS:`,
          Object.keys(ch)
        );
        console.log(
          `[Sessions] Channel ${idx + 1} - FULL DATA:`,
          JSON.stringify(ch, null, 2)
        );
        console.log(`[Sessions] Channel ${idx + 1}:`, {
          channel_id: ch.channel_id || ch.channelId,
          status: ch.status,
          chain_id: ch.chain_id || ch.chainId,
          token: ch.token,
          participants: ch.participants,
          allocations: ch.allocations,
          balance: ch.balance,
          my_balance: ch.my_balance,
          version: ch.version,
          nonce: ch.nonce,
          challenge: ch.challenge,
        });
      });

      // Find active channel for our token on Base
      // Check both snake_case and camelCase field names
      const targetChainId = SESSIONS_CONFIG.chain.id;
      const targetToken = SESSIONS_CONFIG.chain.token.toLowerCase();
      console.log(
        "[Sessions] Looking for channel with chain_id:",
        targetChainId,
        "token:",
        targetToken
      );

      const openChannel = data.find((ch) => {
        const chStatus = ch.status;
        const chChainId = ch.chain_id || ch.chainId;
        const chToken = (ch.token || "").toLowerCase();

        console.log(
          `[Sessions] Checking channel: status=${chStatus}, chain_id=${chChainId}, token=${chToken}`
        );
        console.log(
          `[Sessions] Match: status=${chStatus === "open"}, chain=${
            chChainId === targetChainId
          }, token=${chToken === targetToken}`
        );

        return (
          chStatus === "open" &&
          chChainId === targetChainId &&
          chToken === targetToken
        );
      });

      if (openChannel) {
        // Normalize channel to use snake_case for consistency in our app
        const channelId = openChannel.channel_id || openChannel.channelId;
        this.activeChannel = {
          ...openChannel,
          channel_id: channelId,
          chain_id: openChannel.chain_id || openChannel.chainId,
        };
        console.log("[Sessions] Active channel details:", this.activeChannel);
        this.log(`Active channel: ${channelId.slice(0, 10)}...`);
        this.updateDepositUI(true);
        this.updateChannelBalanceDisplay(openChannel);
      } else {
        this.activeChannel = null;
        console.log("[Sessions] No matching open channel found");
        this.updateDepositUI(false);
        this.updateChannelBalanceDisplay(null);
      }

      this.log(`Received ${data.length} channel(s) from clearnode`);

      // Render all channels in the list
      this.renderChannelsList(data);
    }
  }

  renderChannelsList(channels) {
    if (!this.elements.channelsList) return;

    if (!channels || channels.length === 0) {
      this.elements.channelsList.innerHTML = '<p style="color: #888; text-align: center;">No channels found.</p>';
      return;
    }

    const targetChainId = SESSIONS_CONFIG.chain.id;
    const targetToken = SESSIONS_CONFIG.chain.token.toLowerCase();

    // Filter channels for our chain/token
    const relevantChannels = channels.filter((ch) => {
      const chChainId = ch.chain_id || ch.chainId;
      const chToken = (ch.token || "").toLowerCase();
      return chChainId === targetChainId && chToken === targetToken;
    });

    if (relevantChannels.length === 0) {
      this.elements.channelsList.innerHTML = '<p style="color: #888; text-align: center;">No channels on Base network.</p>';
      return;
    }

    const html = relevantChannels.map((ch) => {
      const channelId = ch.channel_id || ch.channelId;
      const status = ch.status || "unknown";
      const shortId = channelId ? `${channelId.slice(0, 10)}...${channelId.slice(-6)}` : "N/A";

      // Status color coding
      let statusColor = "#888";
      let statusIcon = "⚪";
      if (status === "open") {
        statusColor = "#4caf50";
        statusIcon = "🟢";
      } else if (status === "resize" || status === "pending_resize" || status === "resizing") {
        statusColor = "#ff9800";
        statusIcon = "🟠";
      } else if (status === "closed" || status === "closing") {
        statusColor = "#f44336";
        statusIcon = "🔴";
      } else if (status === "challenged") {
        statusColor = "#e91e63";
        statusIcon = "⚠️";
      }

      // Get balance info
      let balanceDisplay = "N/A";
      if (ch.allocations && Array.isArray(ch.allocations)) {
        const userAlloc = ch.allocations.find(
          (a) => a.participant?.toLowerCase() === this.userAddress?.toLowerCase()
        );
        if (userAlloc) {
          const amount = parseInt(userAlloc.amount || "0") / 1_000_000;
          balanceDisplay = `${amount.toFixed(2)} USDC`;
        }
      } else if (ch.my_balance !== undefined) {
        balanceDisplay = `${(parseInt(ch.my_balance) / 1_000_000).toFixed(2)} USDC`;
      }

      return `
        <div style="background: rgba(156,39,176,0.1); border: 1px solid rgba(156,39,176,0.3); border-radius: 6px; padding: 0.75rem; margin-bottom: 0.5rem; cursor: pointer;" onclick="document.getElementById('sessions-resizeChannelId').value = '${channelId}'">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <span style="font-family: monospace; font-size: 0.8rem; color: #9c27b0;">${shortId}</span>
            <span style="color: ${statusColor}; font-size: 0.75rem;">${statusIcon} ${status}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.75rem; color: #888;">Balance:</span>
            <span style="font-weight: bold; color: #4caf50;">${balanceDisplay}</span>
          </div>
        </div>
      `;
    }).join("");

    this.elements.channelsList.innerHTML = html;
  }

  updateChannelBalanceDisplay(channel) {
    if (!this.elements.channelBalanceDisplay) return;

    if (!channel) {
      this.elements.channelBalanceDisplay.textContent = "0.00 USDC";
      return;
    }

    // Try to get user's allocation from channel data
    // Channel structure may have: allocations, balances, or participant-specific amounts
    let userBalance = 0;

    // Check various possible channel data structures
    if (channel.allocations && Array.isArray(channel.allocations)) {
      const userAlloc = channel.allocations.find(
        (a) => a.participant?.toLowerCase() === this.userAddress?.toLowerCase()
      );
      if (userAlloc) {
        userBalance = parseInt(userAlloc.amount || "0");
      }
    } else if (channel.balance !== undefined) {
      // Some responses have a direct balance field
      userBalance = parseInt(channel.balance || "0");
    } else if (channel.my_balance !== undefined) {
      userBalance = parseInt(channel.my_balance || "0");
    } else if (channel.participant_balances) {
      // Another possible structure
      const myBalance =
        channel.participant_balances[this.userAddress?.toLowerCase()];
      if (myBalance) {
        userBalance = parseInt(myBalance || "0");
      }
    }

    const displayBalance = (userBalance / 1_000_000).toFixed(2);
    this.elements.channelBalanceDisplay.textContent = `${displayBalance} USDC`;

    if (userBalance > 0) {
      this.log(`Channel balance: ${displayBalance} USDC`);
    }
  }

  updateDepositUI(hasChannel) {
    // Update deposit button text based on whether we have an existing channel
    if (this.elements.depositBtn) {
      this.elements.depositBtn.textContent = hasChannel
        ? "Top Up"
        : "Deposit & Create Channel";
    }
    // Always show resize card - user can manually enter channel ID if not auto-detected
    if (this.elements.resizeBtn) {
      // Enable button when wallet is connected (user can manually enter channel ID)
      this.elements.resizeBtn.disabled = !this.userAddress;
    }
    if (this.elements.closeChannelBtn) {
      // Enable close button when wallet is connected
      this.elements.closeChannelBtn.disabled = !this.userAddress;
    }
    if (!hasChannel && this.elements.resizeStatus) {
      this.elements.resizeStatus.style.display = "block";
      this.elements.resizeStatus.textContent =
        "No channel auto-detected. Enter channel ID manually or create one via deposit.";
      this.elements.resizeStatus.style.color = "#ff9800";
    }
    console.log(
      "[Sessions] updateDepositUI - hasChannel:",
      hasChannel,
      "activeChannel:",
      this.activeChannel
    );
  }

  async getConfig() {
    if (!this.isAuthenticated) return;

    try {
      this.log("Requesting clearnode config...");
      const message = createGetConfigMessageV2();
      this.ws.send(message);
    } catch (error) {
      this.log(`Failed to get config: ${error.message}`, "error");
    }
  }

  async getChannels() {
    if (!this.isAuthenticated) {
      console.log("[Sessions] getChannels: Not authenticated, skipping");
      return;
    }

    try {
      // Fetch on-chain channels from ALL supported chains
      console.log(
        "[Sessions] ========== CHECKING ALL CHAINS FOR CHANNELS =========="
      );
      console.log("[Sessions] User address:", this.userAddress);
      console.log("[Sessions] Chains to check:", Object.keys(SESSIONS_CONFIG.chains));

      let foundChannel = null;
      let foundChainConfig = null;

      for (const [chainIdStr, chainConfig] of Object.entries(
        SESSIONS_CONFIG.chains
      )) {
        const chainId = parseInt(chainIdStr);
        console.log(
          `[Sessions] Checking chain ${chainConfig.name} (${chainId})...`
        );
        console.log(`[Sessions] Custody address: ${chainConfig.custody}`);
        console.log(`[Sessions] RPC URL: ${chainConfig.rpcUrl}`);

        try {
          // Create a public client for this chain
          const chainPublicClient = createPublicClient({
            chain: chainId === 1 ? mainnet : base,
            transport: http(chainConfig.rpcUrl),
          });

          console.log(`[Sessions] Created public client for ${chainConfig.name}`);

          // Create NitroliteService for this chain
          const chainNitroliteService = new NitroliteService(
            chainPublicClient,
            {
              custody: chainConfig.custody,
              adjudicator: chainConfig.adjudicator,
            },
            null, // No wallet client needed for reads
            this.userAddress
          );

          console.log(`[Sessions] Created NitroliteService for ${chainConfig.name}`);
          console.log(`[Sessions] Calling getOpenChannels for ${this.userAddress}...`);

          const channelIds = await chainNitroliteService.getOpenChannels(
            this.userAddress
          );
          console.log(
            `[Sessions] ${chainConfig.name}: Found ${channelIds.length} channel(s):`,
            channelIds
          );

          if (channelIds.length > 0) {
            this.log(
              `Found ${channelIds.length} channel(s) on ${chainConfig.name}`
            );

            // Use the first channel found
            if (!foundChannel) {
              foundChannel = channelIds[0];
              foundChainConfig = chainConfig;

              // Try to get channel data
              try {
                const channelData = await chainNitroliteService.getChannelData(
                  foundChannel
                );
                console.log(
                  `[Sessions] Channel data for ${foundChannel}:`,
                  channelData
                );
              } catch (dataError) {
                console.warn(
                  `[Sessions] Could not get channel data:`,
                  dataError.message
                );
              }
            }
          }
        } catch (chainError) {
          console.warn(
            `[Sessions] Error checking ${chainConfig.name}:`,
            chainError.message
          );
        }
      }

      console.log(
        "[Sessions] ========================================================="
      );

      if (foundChannel && foundChainConfig) {
        this.activeChannel = {
          channel_id: foundChannel,
          chain_id: foundChainConfig.id,
          token: foundChainConfig.token,
          status: "open",
        };
        // Update the active chain config
        this.activeChainConfig = foundChainConfig;
        console.log("[Sessions] Set active channel:", this.activeChannel);
        console.log("[Sessions] Active chain config:", foundChainConfig);
        this.updateDepositUI(true);
      } else {
        this.log("No on-chain channels found on any chain");
        this.activeChannel = null;
        this.activeChainConfig = SESSIONS_CONFIG.chain; // Default to Base
        this.updateDepositUI(false);
      }

      // Also fetch via WebSocket RPC for additional channel data
      const message = createGetChannelsMessageV2(this.userAddress, "open");
      this.ws.send(message);
    } catch (error) {
      this.log(`Failed to get channels: ${error.message}`, "error");
      console.error("[Sessions] getChannels error:", error);
    }
  }

  handleBalanceUpdateNotification(data) {
    console.log("[Sessions] Balance update:", data);
    // Refresh balances when notified of changes
    this.getBalances();
  }

  handleAppSessionUpdateNotification(data) {
    console.log("[Sessions] App session update:", data);
    // Refresh sessions when notified of changes
    this.getAppSessions();
  }

  async connectWallet() {
    try {
      this.log("Connecting wallet...");

      if (!window.ethereum) {
        throw new Error("Please install MetaMask!");
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      this.userAddress = getAddress(accounts[0]);

      // Create viem clients for Base
      this.publicClient = createPublicClient({
        chain: base,
        transport: http(SESSIONS_CONFIG.chain.rpcUrl),
      });

      // Create wallet client with account for signing
      // We need to use the address as account for viem to work with browser wallets
      const [account] = await window.ethereum.request({
        method: "eth_accounts",
      });
      this.walletClient = createWalletClient({
        chain: base,
        transport: custom(window.ethereum),
        account: account,
      });

      // Create NitroliteService
      this.nitroliteService = new NitroliteService(
        this.publicClient,
        {
          custody: SESSIONS_CONFIG.chain.custody,
          adjudicator: SESSIONS_CONFIG.chain.adjudicator,
        },
        this.walletClient,
        this.userAddress
      );

      this.elements.walletStatus?.classList.add("connected");
      if (this.elements.walletStatusText) {
        this.elements.walletStatusText.textContent = "Wallet connected";
      }
      if (this.elements.userAddress) {
        this.elements.userAddress.textContent = this.userAddress;
      }
      if (this.elements.connectBtn) {
        this.elements.connectBtn.textContent = "Authenticating...";
      }

      this.log(
        `Wallet connected: ${this.userAddress.slice(
          0,
          6
        )}...${this.userAddress.slice(-4)}`
      );

      // Listen for account changes
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) {
          this.log("Wallet disconnected");
          location.reload();
        } else {
          this.log("Account changed - please reconnect");
          location.reload();
        }
      });

      await this.authenticate();
      this.enableButtons();
      await this.getConfig();
      await this.getChannels();
      await this.getBalances();
      await this.getAppSessions();
    } catch (error) {
      this.log(`Failed to connect wallet: ${error.message}`, "error");
      if (this.elements.connectBtn) {
        this.elements.connectBtn.textContent = "Connect Wallet";
      }
    }
  }

  enableButtons() {
    if (this.elements.connectBtn) {
      this.elements.connectBtn.textContent = "Connected";
      this.elements.connectBtn.disabled = true;
    }
    if (this.elements.depositBtn) this.elements.depositBtn.disabled = false;
    if (this.elements.withdrawCustodyBtn)
      this.elements.withdrawCustodyBtn.disabled = false;
    if (this.elements.withdrawBtn) this.elements.withdrawBtn.disabled = false;
    if (this.elements.createSessionBtn)
      this.elements.createSessionBtn.disabled = false;
    if (this.elements.refreshSessionsBtn)
      this.elements.refreshSessionsBtn.disabled = false;
    if (this.elements.refreshBalancesBtn)
      this.elements.refreshBalancesBtn.disabled = false;
    if (this.elements.refreshChannelsBtn)
      this.elements.refreshChannelsBtn.disabled = false;
    if (this.elements.createChannelBtn)
      this.elements.createChannelBtn.disabled = false;
    if (this.elements.fetchChannelDataBtn)
      this.elements.fetchChannelDataBtn.disabled = false;
    if (this.elements.forceCloseBtn)
      this.elements.forceCloseBtn.disabled = false;

    // Check all balances
    this.refreshAllBalances();
  }

  async refreshAllBalances() {
    this.log("Refreshing all balances...");
    await Promise.all([
      this.checkCustodyBalance(),
      this.getBalances(),
      this.getChannels(),
    ]);
  }

  async authenticate() {
    return new Promise(async (resolve, reject) => {
      try {
        this.log("Authenticating with Clearnode...");
        this.pendingAuthResolve = resolve;
        this.pendingAuthReject = reject;

        // Generate session key
        this.sessionKeyPrivate = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(this.sessionKeyPrivate);
        this.sessionKeyAddress = sessionAccount.address;

        this.messageSigner = createECDSAMessageSigner(this.sessionKeyPrivate);

        this.log(
          `Session key: ${this.sessionKeyAddress.slice(
            0,
            6
          )}...${this.sessionKeyAddress.slice(-4)}`
        );

        const expiresAt = BigInt(
          Math.floor(Date.now() / 1000) +
            SESSIONS_CONFIG.sessionExpiryHours * 60 * 60
        );

        // Store auth params for challenge handler
        this.pendingAuthParams = {
          address: getAddress(this.userAddress),
          session_key: getAddress(this.sessionKeyAddress),
          application: "clearnode",
          allowances: [],
          expires_at: expiresAt,
          scope: "console",
        };

        const authMessage = await createAuthRequestMessage(
          this.pendingAuthParams
        );

        this.ws.send(authMessage);

        this.authTimeoutId = setTimeout(() => {
          if (!this.isAuthenticated) {
            this.pendingAuthResolve = null;
            this.pendingAuthReject = null;
            reject(new Error("Authentication timeout"));
          }
        }, 60000);
      } catch (error) {
        reject(error);
      }
    });
  }

  async handleAuthChallenge(data, requestId) {
    try {
      // Extract challenge message - can come as {challenge_message: "..."} or array
      let challengeMessage;
      if (data?.challenge_message) {
        challengeMessage = data.challenge_message;
      } else if (Array.isArray(data) && data[0]?.challenge_message) {
        challengeMessage = data[0].challenge_message;
      } else {
        challengeMessage = JSON.stringify(data);
      }

      this.log(`Signing auth challenge: ${challengeMessage.slice(0, 20)}...`);

      // Use window.ethereum.request directly for browser wallet compatibility
      // IMPORTANT: expires_at must be uint64, and Allowance.amount must be string (per SDK EIP712AuthTypes)
      const expiresAtNumber = Number(this.pendingAuthParams.expires_at);

      const typedData = {
        types: {
          EIP712Domain: [{ name: "name", type: "string" }],
          Policy: [
            { name: "challenge", type: "string" },
            { name: "scope", type: "string" },
            { name: "wallet", type: "address" },
            { name: "session_key", type: "address" },
            { name: "expires_at", type: "uint64" },
            { name: "allowances", type: "Allowance[]" },
          ],
          Allowance: [
            { name: "asset", type: "string" },
            { name: "amount", type: "string" },
          ],
        },
        primaryType: "Policy",
        domain: { name: this.pendingAuthParams.application },
        message: {
          challenge: challengeMessage,
          scope: this.pendingAuthParams.scope,
          wallet: this.userAddress,
          session_key: this.pendingAuthParams.session_key,
          expires_at: expiresAtNumber,
          allowances: this.pendingAuthParams.allowances || [],
        },
      };

      // Sign with wallet using eth_signTypedData_v4
      const signature = await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [this.userAddress, JSON.stringify(typedData)],
      });

      this.log("Wallet signed, sending auth_verify...");

      // Build auth_verify message manually with wallet signature
      const verifyRequestId = Date.now();
      const timestamp = Date.now();
      const verifyMessage = {
        req: [
          verifyRequestId,
          "auth_verify",
          { challenge: challengeMessage },
          timestamp,
        ],
        sig: [signature],
      };

      console.log("Sending auth_verify:", JSON.stringify(verifyMessage));
      this.ws.send(JSON.stringify(verifyMessage));
    } catch (error) {
      this.log(`Auth challenge failed: ${error.message}`, "error");
      console.error("Auth error:", error);
      if (this.pendingAuthReject) {
        this.pendingAuthReject(error);
        this.pendingAuthReject = null;
        this.pendingAuthResolve = null;
      }
    }
  }

  async getBalances() {
    try {
      const balanceMessage = await createGetLedgerBalancesMessage(
        this.messageSigner,
        this.userAddress
      );
      this.ws.send(balanceMessage);
    } catch (error) {
      this.log(`Failed to get balances: ${error.message}`, "error");
    }
  }

  handleBalanceResponse(data) {
    if (Array.isArray(data)) {
      const usdcBalance = data.find((b) => b.asset === SESSIONS_CONFIG.asset);
      if (usdcBalance) {
        this.ledgerBalance = parseInt(usdcBalance.amount);
        const displayBalance = (this.ledgerBalance / 1_000_000).toFixed(2);
        if (this.elements.ledgerBalance) {
          this.elements.ledgerBalance.textContent = `${displayBalance} USDC`;
        }
        this.log(`Ledger balance: ${displayBalance} USDC`);
      } else {
        this.ledgerBalance = 0;
        if (this.elements.ledgerBalance) {
          this.elements.ledgerBalance.textContent = "0.00 USDC";
        }
      }
    }
  }

  // ========== DEPOSIT FUNDS ==========

  async depositFunds() {
    const amount = parseFloat(this.elements.depositAmount?.value || "0");
    if (isNaN(amount) || amount <= 0) {
      this.log("Please enter a valid deposit amount", "error");
      return;
    }

    try {
      this.log(`Starting deposit: ${amount} USDC on Base`);

      // Switch to Base if needed
      await this.ensureBaseNetwork();

      const amountInUnits = parseUnits(amount.toString(), 6);

      // Check wallet USDC balance
      const walletBalance = await this.publicClient.readContract({
        address: SESSIONS_CONFIG.chain.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.userAddress],
      });

      this.log(`Wallet USDC: ${formatUnits(walletBalance, 6)}`);

      if (walletBalance < amountInUnits) {
        this.log(
          `Insufficient USDC. Have: ${formatUnits(
            walletBalance,
            6
          )}, Need: ${amount}`,
          "error"
        );
        return;
      }

      // Check allowance
      const allowance = await this.publicClient.readContract({
        address: SESSIONS_CONFIG.chain.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.userAddress, SESSIONS_CONFIG.chain.custody],
      });

      // Approve if needed
      if (allowance < amountInUnits) {
        this.log("Requesting USDC approval...");
        const approveTxHash = await this.walletClient.writeContract({
          address: SESSIONS_CONFIG.chain.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [SESSIONS_CONFIG.chain.custody, amountInUnits],
          account: this.userAddress,
        });
        this.log(`Approval tx: ${approveTxHash.slice(0, 10)}...`);
        await this.publicClient.waitForTransactionReceipt({
          hash: approveTxHash,
        });
        this.log("Approval confirmed!", "success");
      }

      // Check if we already have an active channel - if so, just do a top-up deposit
      if (this.activeChannel) {
        this.log("Active channel exists. Depositing to custody for top-up...");
        const depositTxHash = await this.walletClient.writeContract({
          address: SESSIONS_CONFIG.chain.custody,
          abi: custodyDepositAbi,
          functionName: "deposit",
          args: [this.userAddress, SESSIONS_CONFIG.chain.token, amountInUnits],
          account: this.userAddress,
        });

        this.log(`Deposit tx: ${depositTxHash.slice(0, 10)}...`);
        await this.publicClient.waitForTransactionReceipt({
          hash: depositTxHash,
        });
        this.log(`Deposited ${amount} USDC to custody`, "success");
        this.log("Use On-Chain Resize to move funds to channel", "success");

        await this.refreshAllBalances();
        return;
      }

      // No active channel - need to create one via depositAndCreate
      // Step 1: Request channel config from clearnode
      this.log("Requesting channel config from clearnode...");

      // Store pending deposit info for when we get the channel config
      this.pendingDepositAndCreate = {
        amount: amountInUnits,
        displayAmount: amount,
      };

      // Request create_channel from clearnode - this gets the channel config we need
      // Parameters: chain_id and token (no participant - that comes from auth)
      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: SESSIONS_CONFIG.chain.id,
          token: SESSIONS_CONFIG.chain.token,
        }
      );

      this.ws.send(channelMessage);
      this.log("Waiting for channel config from clearnode...");

      // The flow continues in handleCreateChannelResponse -> executeDepositAndCreate
    } catch (error) {
      this.log(`Deposit failed: ${error.message}`, "error");
      console.error("Deposit error:", error);
      this.pendingDepositAndCreate = null;
    }
  }

  async ensureBaseNetwork() {
    const currentChainId = await window.ethereum.request({
      method: "eth_chainId",
    });
    const currentChainIdDecimal = parseInt(currentChainId, 16);

    if (currentChainIdDecimal !== SESSIONS_CONFIG.chain.id) {
      this.log("Switching to Base network...");
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${SESSIONS_CONFIG.chain.id.toString(16)}` }],
        });
        // Recreate clients
        this.walletClient = createWalletClient({
          chain: base,
          transport: custom(window.ethereum),
          account: this.userAddress,
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          // Chain not added, try to add it
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${SESSIONS_CONFIG.chain.id.toString(16)}`,
                chainName: "Base",
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: [SESSIONS_CONFIG.chain.rpcUrl],
                blockExplorerUrls: [SESSIONS_CONFIG.chain.explorerUrl],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    }
  }

  async ensureChannelExists(amountInUnits) {
    // Create channel via WebSocket to move funds from custody to ledger
    try {
      this.log("Creating channel with Clearnode...");

      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: SESSIONS_CONFIG.chain.id,
          token: SESSIONS_CONFIG.chain.token,
        }
      );

      this.pendingChannelAmount = amountInUnits;
      this.ws.send(channelMessage);
    } catch (error) {
      this.log(`Channel creation failed: ${error.message}`, "error");
    }
  }

  async handleCreateChannelResponse(data) {
    if (data?.channel_id) {
      console.log("[Sessions] Create channel response:", data);
      console.log("[Sessions] Channel details:", {
        channel_id: data.channel_id,
        channel: data.channel,
        state: data.state,
        server_signature: data.server_signature || data.serverSignature,
        status: data.status,
      });
      this.log(`Channel config received: ${data.channel_id.slice(0, 10)}...`);

      // Store the initial state for use as proof in future resize operations
      // Note: For resize proofs, we need both user and server signatures
      if (data.state && (data.server_signature || data.serverSignature)) {
        const serverSig = data.server_signature || data.serverSignature;
        const stateAllocations = data.state.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount),
        }));

        // Build state for signing
        const stateToSign = {
          intent: data.state.intent,
          version: BigInt(data.state.version),
          data: data.state.stateData || data.state.data || "0x",
          allocations: stateAllocations,
          sigs: [],
        };

        // Sign the state with user's wallet
        try {
          const packedState = getPackedState(data.channel_id, stateToSign);
          const userSignature = await this.walletClient.signMessage({
            message: { raw: packedState },
            account: this.userAddress,
          });

          // Determine signature order based on participant positions
          // Contract expects: sigs[0] from participants[0], sigs[1] from participants[1]
          const participants = data.channel?.participants || [];
          const userIsClient = participants.length >= 2 &&
            participants[0].toLowerCase() === this.userAddress.toLowerCase();
          console.log("[Sessions] Initial state signature order:");
          console.log("[Sessions]   participants:", participants);
          console.log("[Sessions]   userAddress:", this.userAddress);
          console.log("[Sessions]   userIsClient:", userIsClient);

          const signedState = {
            ...stateToSign,
            sigs: userIsClient ? [userSignature, serverSig] : [serverSig, userSignature],
          };
          console.log("[Sessions] Signature order - sigs[0] from:", userIsClient ? "user" : "server");
          console.log("[Sessions] Signature order - sigs[1] from:", userIsClient ? "server" : "user");

          this.channelStates.set(data.channel_id, signedState);
          console.log(
            "[Sessions] Stored signed initial channel state for proofs:",
            {
              intent: signedState.intent,
              version: signedState.version.toString(),
              allocations: signedState.allocations.map((a) => ({
                destination: a.destination,
                token: a.token,
                amount: a.amount.toString(),
              })),
              sigs: signedState.sigs,
            }
          );
        } catch (signError) {
          console.warn(
            "[Sessions] Failed to sign initial state for proof storage:",
            signError
          );
          // Store with just server sig - resize may fail without user sig
          const partialState = {
            ...stateToSign,
            sigs: [serverSig],
          };
          this.channelStates.set(data.channel_id, partialState);
        }
      }

      // Handle depositAndCreate flow
      if (this.pendingDepositAndCreate) {
        await this.executeDepositAndCreate(data);
        return;
      }

      // Handle create channel only flow (no deposit)
      if (this.pendingCreateChannelOnly) {
        await this.executeCreateChannelOnly(data);
        return;
      }

      this.log(
        `Channel created: ${data.channel_id.slice(0, 10)}...`,
        "success"
      );

      // Store as active channel
      this.activeChannel = {
        channel_id: data.channel_id,
        chain_id: SESSIONS_CONFIG.chain.id,
        token: SESSIONS_CONFIG.chain.token,
        status: "open",
      };
      this.updateDepositUI(true);

      // Handle deposit flow: resize channel to move funds from custody to ledger
      if (this.pendingChannelAmount) {
        this.resizeChannelToLedger(data.channel_id, this.pendingChannelAmount);
        this.pendingChannelAmount = null;
        return;
      }

      // Handle withdrawal flow: resize channel to move funds from ledger to custody
      if (this.pendingWithdrawal?.step === "create_channel") {
        this.pendingWithdrawal.channelId = data.channel_id;
        this.pendingWithdrawal.step = "resize_channel";
        this.resizeChannelForWithdrawal(
          data.channel_id,
          this.pendingWithdrawal.amount
        );
      }
    }
  }

  /**
   * Execute depositAndCreate on-chain using channel config from clearnode
   * This deposits funds and creates channel in one transaction, which clearnode monitors
   */
  async executeDepositAndCreate(channelData) {
    const pendingDeposit = this.pendingDepositAndCreate;
    this.pendingDepositAndCreate = null;

    try {
      this.log("Preparing on-chain depositAndCreate...");

      // Extract channel config from response
      // Response format: { channel_id, channel: {participants, adjudicator, challenge, nonce}, state: {intent, version, stateData, allocations}, serverSignature }
      const channel = channelData.channel;
      const state = channelData.state;
      const serverSignature =
        channelData.server_signature || channelData.serverSignature;

      if (!channel || !state || !serverSignature) {
        throw new Error(
          "Invalid channel response - missing channel, state or serverSignature"
        );
      }

      console.log("[Sessions] Channel data:", {
        channel,
        state,
        serverSignature,
      });

      // Build the Channel struct for the contract
      const channelStruct = {
        participants: channel.participants,
        adjudicator: channel.adjudicator,
        challenge: BigInt(channel.challenge),
        nonce: BigInt(channel.nonce),
      };

      // Convert allocations from RPC format to contract format
      // RPC: { destination, token, amount } - contract needs same format
      const allocations = state.allocations.map((a) => ({
        destination: a.destination,
        token: a.token,
        amount: BigInt(a.amount),
      }));

      // Build unsigned state for signing
      const unsignedState = {
        intent: state.intent,
        version: BigInt(state.version),
        data: state.state_data || state.stateData || state.data || "0x",
        allocations: allocations,
        sigs: [],
      };

      // Calculate channel ID for signing
      const channelId = getChannelId(channelStruct, SESSIONS_CONFIG.chain.id);
      this.log(`Channel ID: ${channelId.slice(0, 10)}...`);

      // Get packed state for signing
      const packedState = getPackedState(channelId, unsignedState);
      this.log("Signing state with wallet...");

      // Sign with user's wallet using EIP-191 personal_sign (raw message)
      const userSignature = await this.walletClient.signMessage({
        message: { raw: packedState },
        account: this.userAddress,
      });

      this.log("State signed!");

      // Determine signature order based on participant positions
      // Contract expects: sigs[0] from participants[0], sigs[1] from participants[1]
      const userIsClient = channel.participants[0].toLowerCase() === this.userAddress.toLowerCase();
      console.log("[Sessions] Participant order check:");
      console.log("[Sessions]   participants[0]:", channel.participants[0]);
      console.log("[Sessions]   participants[1]:", channel.participants[1]);
      console.log("[Sessions]   userAddress:", this.userAddress);
      console.log("[Sessions]   userIsClient:", userIsClient);

      // Build final state with signatures in correct order
      const signedState = {
        intent: unsignedState.intent,
        version: unsignedState.version,
        data: unsignedState.data,
        allocations: unsignedState.allocations,
        sigs: userIsClient ? [userSignature, serverSignature] : [serverSignature, userSignature],
      };
      console.log("[Sessions] Signature order - sigs[0] from:", userIsClient ? "user" : "server");
      console.log("[Sessions] Signature order - sigs[1] from:", userIsClient ? "server" : "user");

      // Execute depositAndCreate on-chain
      this.log("Executing depositAndCreate on-chain...");

      const txHash = await this.walletClient.writeContract({
        address: SESSIONS_CONFIG.chain.custody,
        abi: custodyDepositAndCreateAbi,
        functionName: "depositAndCreate",
        args: [
          SESSIONS_CONFIG.chain.token,
          pendingDeposit.amount,
          channelStruct,
          signedState,
        ],
        account: this.userAddress,
      });

      this.log(`Tx submitted: ${txHash.slice(0, 10)}...`);
      await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      this.log(
        `Deposited ${pendingDeposit.displayAmount} USDC and created channel!`,
        "success"
      );

      // Store as active channel - use the channel_id from clearnode response
      const clearnodeChannelId = channelData.channel_id;
      this.activeChannel = {
        channel_id: clearnodeChannelId,
        chain_id: SESSIONS_CONFIG.chain.id,
        token: SESSIONS_CONFIG.chain.token,
        status: "open",
      };
      this.updateDepositUI(true);

      // Store the signed initial state for use as proof in future resize operations
      this.channelStates.set(clearnodeChannelId, signedState);
      console.log(
        "[Sessions] Stored signed initial state for channel:",
        clearnodeChannelId
      );
      console.log("[Sessions] Initial state:", {
        intent: signedState.intent,
        version: signedState.version.toString(),
        allocations: signedState.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: a.amount.toString(),
        })),
        sigs: signedState.sigs,
      });

      // Now resize the channel to move funds from custody to ledger
      // The depositAndCreate puts funds in custody, resize moves them to ledger
      this.log("Moving funds from custody to ledger...");
      await this.resizeChannelToLedger(
        clearnodeChannelId,
        pendingDeposit.amount
      );
    } catch (error) {
      this.log(`depositAndCreate failed: ${error.message}`, "error");
      console.error("depositAndCreate error:", error);
    }
  }

  async resizeChannelForWithdrawal(channelId, amount) {
    try {
      this.log("Moving funds from channel to custody (on-chain resize)...");

      // For withdrawal, use negative resize_amount to move funds from channel to custody
      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          resize_amount: -amount, // Negative to move from channel to custody
          funds_destination: this.userAddress,
        }
      );

      this.ws.send(resizeMessage);
    } catch (error) {
      this.log(`Resize for withdrawal failed: ${error.message}`, "error");
      this.pendingWithdrawal = null;
    }
  }

  // Wait for clearnode to sync with on-chain state
  waitForClearnodeSync(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Check on-chain custody balance and show sync section if > 0
  async checkCustodyBalance() {
    if (!this.publicClient || !this.userAddress) return;

    try {
      // Read custody balance using getAccountsBalances(address[] accounts, address[] tokens)
      const custodyAbi = [
        {
          inputs: [
            { name: "accounts", type: "address[]" },
            { name: "tokens", type: "address[]" },
          ],
          name: "getAccountsBalances",
          outputs: [{ name: "", type: "uint256[][]" }],
          stateMutability: "view",
          type: "function",
        },
      ];

      const balances = await this.publicClient.readContract({
        address: SESSIONS_CONFIG.chain.custody,
        abi: custodyAbi,
        functionName: "getAccountsBalances",
        args: [[this.userAddress], [SESSIONS_CONFIG.chain.token]],
      });

      // balances is uint256[][] - balances[0][0] is our account's balance for the token
      const balance = balances[0][0];
      this.custodyBalanceAmount = balance;
      const displayBalance = formatUnits(balance, 6);

      // Always update the custody balance display
      if (this.elements.custodyBalanceDisplay) {
        this.elements.custodyBalanceDisplay.textContent = `${parseFloat(
          displayBalance
        ).toFixed(2)} USDC`;
      }

      if (balance > 0n) {
        // Show sync section
        if (this.elements.syncSection) {
          this.elements.syncSection.style.display = "block";
        }
        this.log(`Custody balance: ${displayBalance} USDC`);
      } else {
        // Hide sync section
        if (this.elements.syncSection) {
          this.elements.syncSection.style.display = "none";
        }
      }
    } catch (error) {
      console.error("Failed to check custody balance:", error);
      // Show 0 on error
      if (this.elements.custodyBalanceDisplay) {
        this.elements.custodyBalanceDisplay.textContent = "0.00 USDC";
      }
    }
  }

  // Withdraw funds directly from custody contract to wallet
  // (Use this when funds are stuck in custody and clearnode doesn't recognize them)
  async withdrawFromCustodyDirect() {
    if (!this.custodyBalanceAmount || this.custodyBalanceAmount === 0n) {
      this.log("No funds in custody to withdraw", "error");
      return;
    }

    try {
      await this.ensureBaseNetwork();

      const amount = this.custodyBalanceAmount;
      this.log(
        `Withdrawing ${formatUnits(amount, 6)} USDC from custody to wallet...`
      );

      const withdrawTxHash = await this.withdrawFromCustody(amount);
      this.log(`Withdraw tx: ${withdrawTxHash.slice(0, 10)}...`);

      await this.publicClient.waitForTransactionReceipt({
        hash: withdrawTxHash,
      });
      this.log("Withdrawal complete! Funds returned to wallet.", "success");

      // Refresh balances
      await this.checkCustodyBalance();
    } catch (error) {
      this.log(`Withdrawal failed: ${error.message}`, "error");
      console.error("Custody withdrawal error:", error);
    }
  }

  // ========== ON-CHAIN RESIZE ==========

  async requestResize() {
    const amount = parseFloat(this.elements.resizeAmount?.value || "0");
    const direction = this.elements.resizeDirection?.value || "allocate";
    const manualChannelId = this.elements.resizeChannelId?.value?.trim() || "";

    if (isNaN(amount) || amount <= 0) {
      this.log("Please enter a valid resize amount", "error");
      return;
    }

    // Use manual channel ID if provided, otherwise fall back to auto-detected channel
    const channelId = manualChannelId || this.activeChannel?.channel_id;

    if (!channelId) {
      this.log("No channel ID provided and no active channel detected", "error");
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);

    // Show status
    if (this.elements.resizeStatus) {
      this.elements.resizeStatus.style.display = "block";
      this.elements.resizeStatus.textContent = "Requesting server signature...";
      this.elements.resizeStatus.style.color = "#888";
    }

    try {
      this.log(
        `Requesting resize: ${
          direction === "allocate" ? "+" : "-"
        }${amount} USDC (channel: ${channelId.slice(0, 10)}...)`
      );

      // Store pending resize info for when we get the response
      this.pendingOnChainResize = {
        channelId: channelId,
        amount: amountInMicrounits,
        direction,
        displayAmount: amount,
      };

      // Request resize via WebSocket to get server signature
      // Use resize_amount for on-chain custody ↔ channel operations
      // (allocate_amount uses off-chain ledger which may show 0)
      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          resize_amount:
            direction === "allocate" ? amountInMicrounits : -amountInMicrounits,
          funds_destination: this.userAddress,
        }
      );

      this.ws.send(resizeMessage);
    } catch (error) {
      this.log(`Resize request failed: ${error.message}`, "error");
      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.textContent = `Error: ${error.message}`;
        this.elements.resizeStatus.style.color = "#f44336";
      }
      this.pendingOnChainResize = null;
    }
  }

  async closeChannelManual() {
    const manualChannelId = this.elements.resizeChannelId?.value?.trim() || "";
    const channelId = manualChannelId || this.activeChannel?.channel_id;

    if (!channelId) {
      this.log("No channel ID provided and no active channel detected", "error");
      return;
    }

    // Show status
    if (this.elements.resizeStatus) {
      this.elements.resizeStatus.style.display = "block";
      this.elements.resizeStatus.textContent = "Requesting channel close...";
      this.elements.resizeStatus.style.color = "#888";
    }

    try {
      this.log(`Closing channel: ${channelId.slice(0, 10)}...`);

      const closeMessage = await createCloseChannelMessage(this.messageSigner, {
        channel_id: channelId,
      });

      this.ws.send(closeMessage);

      // Update status after sending
      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.textContent = "Close request sent. Waiting for response...";
      }
    } catch (error) {
      this.log(`Close channel failed: ${error.message}`, "error");
      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.textContent = `Error: ${error.message}`;
        this.elements.resizeStatus.style.color = "#f44336";
      }
    }
  }

  // ========== CREATE CHANNEL ONLY ==========

  async createChannelOnly() {
    // Show status
    if (this.elements.createChannelStatus) {
      this.elements.createChannelStatus.style.display = "block";
      this.elements.createChannelStatus.textContent = "Requesting channel config from clearnode...";
      this.elements.createChannelStatus.style.color = "#888";
    }

    try {
      this.log("Creating channel (no deposit)...");

      // Switch to Base if needed
      await this.ensureBaseNetwork();

      // Store that we're creating a channel without deposit
      this.pendingCreateChannelOnly = true;

      // Request create_channel from clearnode
      const channelMessage = await createCreateChannelMessage(
        this.messageSigner,
        {
          chain_id: SESSIONS_CONFIG.chain.id,
          token: SESSIONS_CONFIG.chain.token,
        }
      );

      this.ws.send(channelMessage);
      this.log("Waiting for channel config from clearnode...");

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = "Waiting for channel config...";
      }

      // Flow continues in handleCreateChannelResponse -> executeCreateChannelOnly
    } catch (error) {
      this.log(`Create channel failed: ${error.message}`, "error");
      console.error("Create channel error:", error);
      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = `Error: ${error.message}`;
        this.elements.createChannelStatus.style.color = "#f44336";
      }
      this.pendingCreateChannelOnly = false;
    }
  }

  async executeCreateChannelOnly(channelData) {
    this.pendingCreateChannelOnly = false;

    try {
      this.log("Preparing on-chain channel creation...");

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = "Preparing on-chain transaction...";
      }

      // Extract channel config from response
      const channel = channelData.channel;
      const state = channelData.state;
      const serverSignature = channelData.server_signature || channelData.serverSignature;

      if (!channel || !state || !serverSignature) {
        throw new Error("Invalid channel response - missing channel, state or serverSignature");
      }

      // Build the Channel struct for the contract
      const channelStruct = {
        participants: channel.participants,
        adjudicator: channel.adjudicator,
        challenge: BigInt(channel.challenge),
        nonce: BigInt(channel.nonce),
      };

      // Convert allocations
      const allocations = state.allocations.map((a) => ({
        destination: a.destination,
        token: a.token,
        amount: BigInt(a.amount),
      }));

      // Build unsigned state
      const unsignedState = {
        intent: state.intent,
        version: BigInt(state.version),
        data: state.state_data || state.stateData || state.data || "0x",
        allocations: allocations,
        sigs: [],
      };

      // Calculate channel ID
      const channelId = getChannelId(channelStruct, SESSIONS_CONFIG.chain.id);
      this.log(`Channel ID: ${channelId.slice(0, 10)}...`);

      // Get packed state for signing
      const packedState = getPackedState(channelId, unsignedState);
      this.log("Signing state with wallet...");

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = "Please sign in wallet...";
      }

      // Sign with user's wallet
      const userSignature = await this.walletClient.signMessage({
        message: { raw: packedState },
        account: this.userAddress,
      });

      this.log("State signed!");

      // Determine signature order based on participant positions
      // Contract expects: sigs[0] from participants[0], sigs[1] from participants[1]
      const userIsClient = channel.participants[0].toLowerCase() === this.userAddress.toLowerCase();
      console.log("[Sessions] Participant order check:");
      console.log("[Sessions]   participants[0]:", channel.participants[0]);
      console.log("[Sessions]   participants[1]:", channel.participants[1]);
      console.log("[Sessions]   userAddress:", this.userAddress);
      console.log("[Sessions]   userIsClient:", userIsClient);

      // Build final state with signatures in correct order
      const signedState = {
        intent: unsignedState.intent,
        version: unsignedState.version,
        data: unsignedState.data,
        allocations: unsignedState.allocations,
        sigs: userIsClient ? [userSignature, serverSignature] : [serverSignature, userSignature],
      };
      console.log("[Sessions] Signature order - sigs[0] from:", userIsClient ? "user" : "server");
      console.log("[Sessions] Signature order - sigs[1] from:", userIsClient ? "server" : "user");

      // Execute create on-chain (not depositAndCreate)
      this.log("Executing create on-chain...");

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = "Submitting transaction...";
      }

      const txHash = await this.nitroliteService.createChannel(channelStruct, signedState);

      this.log(`Tx submitted: ${txHash.slice(0, 10)}...`);

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = `Tx: ${txHash.slice(0, 10)}... Waiting for confirmation...`;
        this.elements.createChannelStatus.style.color = "#ff9800";
      }

      await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      this.log("Channel created on-chain!", "success");

      // Store as active channel
      const clearnodeChannelId = channelData.channel_id;
      this.activeChannel = {
        channel_id: clearnodeChannelId,
        chain_id: SESSIONS_CONFIG.chain.id,
        token: SESSIONS_CONFIG.chain.token,
        status: "open",
      };
      this.updateDepositUI(true);

      // Store the signed initial state for proofs
      this.channelStates.set(clearnodeChannelId, signedState);

      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = `Channel created! ID: ${clearnodeChannelId.slice(0, 10)}...`;
        this.elements.createChannelStatus.style.color = "#4caf50";
      }

      // Refresh data
      await this.refreshAllBalances();
    } catch (error) {
      this.log(`Create channel failed: ${error.message}`, "error");
      console.error("Create channel error:", error);
      if (this.elements.createChannelStatus) {
        this.elements.createChannelStatus.textContent = `Error: ${error.message}`;
        this.elements.createChannelStatus.style.color = "#f44336";
      }
    }
  }

  // ========== ON-CHAIN FORCE CLOSE ==========

  async fetchChannelDataOnChain() {
    const channelId = this.elements.forceCloseChannelId?.value?.trim();

    if (!channelId) {
      this.log("Please enter a channel ID", "error");
      return;
    }

    // Show status
    if (this.elements.forceCloseStatus) {
      this.elements.forceCloseStatus.style.display = "block";
      this.elements.forceCloseStatus.textContent = "Fetching channel data from contract...";
      this.elements.forceCloseStatus.style.color = "#888";
    }

    try {
      this.log(`Fetching on-chain data for channel: ${channelId.slice(0, 10)}...`);

      // Use NitroliteService to fetch channel data
      const channelData = await this.nitroliteService.getChannelData(channelId);

      console.log("[Sessions] On-chain channel data:", channelData);

      // Store for use in force close
      this.fetchedChannelData = {
        channelId,
        ...channelData,
      };

      // Display channel data
      if (this.elements.channelDataDisplay) {
        this.elements.channelDataDisplay.style.display = "block";
      }

      // Status display (0 = Open, 1 = Challenged, 2 = Closed)
      const statusMap = { 0: "Open", 1: "Challenged", 2: "Closed" };
      const statusText = statusMap[channelData.status] || `Unknown (${channelData.status})`;
      if (this.elements.channelStatusDisplay) {
        this.elements.channelStatusDisplay.textContent = statusText;
        this.elements.channelStatusDisplay.style.color =
          channelData.status === 0 ? "#4caf50" :
          channelData.status === 1 ? "#ff9800" : "#f44336";
      }

      // State version display
      if (this.elements.channelStateDisplay) {
        const state = channelData.lastValidState;
        this.elements.channelStateDisplay.textContent =
          `Version: ${state.version}, Intent: ${state.intent}`;
      }

      // Allocations display
      if (this.elements.channelAllocationsDisplay) {
        const state = channelData.lastValidState;
        const allocHtml = state.allocations.map((a, i) => {
          const amount = Number(a.amount) / 1_000_000;
          const shortAddr = `${a.destination.slice(0, 6)}...${a.destination.slice(-4)}`;
          return `<div>P${i + 1} (${shortAddr}): ${amount.toFixed(2)} USDC</div>`;
        }).join("");
        this.elements.channelAllocationsDisplay.innerHTML = allocHtml;
      }

      if (this.elements.forceCloseStatus) {
        this.elements.forceCloseStatus.textContent = "Channel data fetched. Ready to force close.";
        this.elements.forceCloseStatus.style.color = "#4caf50";
      }

      this.log("Channel data fetched from contract", "success");
    } catch (error) {
      this.log(`Failed to fetch channel data: ${error.message}`, "error");
      console.error("[Sessions] fetchChannelDataOnChain error:", error);
      if (this.elements.forceCloseStatus) {
        this.elements.forceCloseStatus.textContent = `Error: ${error.message}`;
        this.elements.forceCloseStatus.style.color = "#f44336";
      }
      if (this.elements.channelDataDisplay) {
        this.elements.channelDataDisplay.style.display = "none";
      }
    }
  }

  async forceCloseChannelOnChain() {
    const channelId = this.elements.forceCloseChannelId?.value?.trim();

    if (!channelId) {
      this.log("Please enter a channel ID", "error");
      return;
    }

    // Check if we have fetched data for this channel
    if (!this.fetchedChannelData || this.fetchedChannelData.channelId !== channelId) {
      this.log("Please fetch channel data first", "error");
      return;
    }

    const { lastValidState, status } = this.fetchedChannelData;

    // Check if channel is already closed
    if (status === 2) {
      this.log("Channel is already closed on-chain", "error");
      return;
    }

    // Show status
    if (this.elements.forceCloseStatus) {
      this.elements.forceCloseStatus.style.display = "block";
      this.elements.forceCloseStatus.textContent = "Executing on-chain close...";
      this.elements.forceCloseStatus.style.color = "#888";
    }

    try {
      this.log(`Force closing channel on-chain: ${channelId.slice(0, 10)}...`);

      // The lastValidState from the contract should have the signatures
      // Call close with the last valid state
      const txHash = await this.nitroliteService.close(
        channelId,
        lastValidState,
        [] // No additional proofs needed when using lastValidState
      );

      this.log(`Close tx submitted: ${txHash.slice(0, 10)}...`, "success");

      if (this.elements.forceCloseStatus) {
        this.elements.forceCloseStatus.textContent = `Tx submitted: ${txHash.slice(0, 10)}... Waiting for confirmation...`;
        this.elements.forceCloseStatus.style.color = "#ff9800";
      }

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === "success") {
        this.log("Channel closed on-chain!", "success");
        if (this.elements.forceCloseStatus) {
          this.elements.forceCloseStatus.textContent = `Success! Tx: ${txHash}`;
          this.elements.forceCloseStatus.style.color = "#4caf50";
        }

        // Clear the fetched data
        this.fetchedChannelData = null;

        // Refresh data
        await this.refreshAllBalances();
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      this.log(`Force close failed: ${error.message}`, "error");
      console.error("[Sessions] forceCloseChannelOnChain error:", error);
      if (this.elements.forceCloseStatus) {
        this.elements.forceCloseStatus.textContent = `Error: ${error.message}`;
        this.elements.forceCloseStatus.style.color = "#f44336";
      }
    }
  }

  async executeOnChainResize(resizeData) {
    // This is called when we receive a successful resize_channel response with server signature
    const pending = this.pendingOnChainResize;
    this.pendingOnChainResize = null;

    if (!pending) return;

    try {
      this.log("Got server signature, executing on-chain resize...");

      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.textContent = "Executing on-chain resize...";
      }

      // Extract the state and server signature from the response
      const { state, server_signature, serverSignature } = resizeData;
      const serverSig = server_signature || serverSignature;

      console.log("[Sessions] ========== RESIZE DATA ==========");
      console.log("[Sessions] Full resize response:", resizeData);
      console.log("[Sessions] State:", state);
      console.log("[Sessions] Server signature:", serverSig);
      console.log("[Sessions] ================================");

      if (!state || !serverSig) {
        throw new Error("Missing state or server signature in resize response");
      }

      // Get channel ID
      const channelId = pending.channelId;

      // Fetch channel data from contract to get participant order
      this.log("Fetching channel config from contract...");
      const channelData = await this.nitroliteService.getChannelData(channelId);
      const participants = channelData.channel.participants;

      console.log("[Sessions] ========== CHANNEL PARTICIPANTS ==========");
      console.log("[Sessions] participants[0] (CLIENT):", participants[0]);
      console.log("[Sessions] participants[1] (SERVER):", participants[1]);
      console.log("[Sessions] User address:", this.userAddress);
      console.log("[Sessions] ==========================================");

      // Determine if user is participants[0] (CLIENT) or participants[1] (SERVER)
      const userIsClient = participants[0].toLowerCase() === this.userAddress.toLowerCase();
      console.log("[Sessions] User is CLIENT (participants[0]):", userIsClient);

      // Build the resize state for on-chain submission
      const resizeState = {
        intent: state.intent,
        version: BigInt(state.version),
        data: state.state_data || state.stateData || state.data || "0x",
        allocations: state.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount),
        })),
        sigs: [],
      };

      // Sign the state ourselves
      const packedState = getPackedState(channelId, resizeState);
      const userSignature = await this.walletClient.signMessage({
        message: { raw: packedState },
        account: this.userAddress,
      });

      // Add signatures in correct order based on participant positions
      // Contract expects: sigs[0] from participants[0], sigs[1] from participants[1]
      if (userIsClient) {
        // User is participants[0], server is participants[1]
        resizeState.sigs = [userSignature, serverSig];
      } else {
        // Server is participants[0], user is participants[1]
        resizeState.sigs = [serverSig, userSignature];
      }
      console.log("[Sessions] Signature order - sigs[0] from:", userIsClient ? "user" : "server");
      console.log("[Sessions] Signature order - sigs[1] from:", userIsClient ? "server" : "user");

      console.log("[Sessions] ========== PREPARED RESIZE STATE ==========");
      console.log("[Sessions] Channel ID:", channelId);
      console.log("[Sessions] Resize state:", {
        intent: resizeState.intent,
        version: resizeState.version.toString(),
        data: resizeState.data,
        allocations: resizeState.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: a.amount.toString(),
        })),
        sigs: resizeState.sigs,
      });
      console.log("[Sessions] ==========================================");

      // Get the preceding state as proof
      let precedingState = this.channelStates.get(channelId);
      if (!precedingState) {
        // Try to fetch from contract if not in memory
        this.log("No cached state, fetching from contract...");
        console.log("[Sessions] Fetching lastValidState from contract as preceding state");

        // channelData was already fetched above for participant order
        const lastValidState = channelData.lastValidState;
        if (lastValidState && lastValidState.sigs && lastValidState.sigs.length >= 2) {
          precedingState = {
            intent: lastValidState.intent,
            version: lastValidState.version,
            data: lastValidState.data || "0x",
            allocations: lastValidState.allocations,
            sigs: lastValidState.sigs,
          };
          console.log("[Sessions] Using lastValidState from contract as preceding state");
        } else {
          throw new Error(
            "No preceding state found in memory or on contract. Cannot provide proof for resize."
          );
        }
      }

      console.log("[Sessions] ========== PRECEDING STATE (PROOF) ==========");
      console.log("[Sessions] Preceding state:", {
        intent: precedingState.intent,
        version: precedingState.version?.toString(),
        data: precedingState.data,
        allocations: precedingState.allocations?.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: a.amount?.toString(),
        })),
        sigs: precedingState.sigs,
      });
      console.log("[Sessions] =============================================");

      // Verify version increment
      const precedingVersion = precedingState.version || 0n;
      const candidateVersion = resizeState.version;
      console.log(
        "[Sessions] Version check: preceding =",
        precedingVersion.toString(),
        ", candidate =",
        candidateVersion.toString()
      );

      if (candidateVersion !== precedingVersion + 1n) {
        console.warn(
          "[Sessions] WARNING: Version mismatch! Candidate should be preceding + 1"
        );
      }

      // Call prepareResize to get the calldata
      this.log("Preparing resize transaction...");
      try {
        const proofs = [precedingState]; // The preceding state is the proof

        const preparedRequest = await this.nitroliteService.prepareResize(
          channelId,
          resizeState,
          proofs
        );

        console.log(
          "[Sessions] ========== PREPARED REQUEST (CALLDATA) =========="
        );
        console.log("[Sessions] Prepared request:", preparedRequest);
        console.log("[Sessions] To:", preparedRequest.address);
        console.log("[Sessions] Function:", preparedRequest.functionName);
        console.log("[Sessions] Args:", preparedRequest.args);

        // Encode the calldata manually for logging
        const calldata = encodeFunctionData({
          abi: preparedRequest.abi,
          functionName: preparedRequest.functionName,
          args: preparedRequest.args,
        });
        console.log("[Sessions] Encoded calldata:", calldata);
        console.log("[Sessions] =============================================");

        this.log("Executing on-chain resize...");

        const txHash = await this.nitroliteService.resize(
          channelId,
          resizeState,
          proofs // Pass the preceding state as proof
        );

        this.log(`Resize tx: ${txHash.slice(0, 10)}...`, "success");

        if (this.elements.resizeStatus) {
          this.elements.resizeStatus.textContent = `Success! Tx: ${txHash.slice(
            0,
            10
          )}...`;
          this.elements.resizeStatus.style.color = "#4caf50";
        }

        await this.publicClient.waitForTransactionReceipt({ hash: txHash });
        this.log("On-chain resize complete!", "success");

        // Update stored state for future resizes
        this.channelStates.set(channelId, resizeState);
        console.log(
          "[Sessions] Updated stored channel state to new resize state"
        );
      } catch (prepareError) {
        console.error("[Sessions] prepareResize error:", prepareError);
        this.log(`prepareResize failed: ${prepareError.message}`, "error");
        throw prepareError;
      }

      // Refresh balances
      await this.refreshAllBalances();
    } catch (error) {
      this.log(`On-chain resize failed: ${error.message}`, "error");
      console.error("[Sessions] Full resize error:", error);
      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.textContent = `Error: ${error.message}`;
        this.elements.resizeStatus.style.color = "#f44336";
      }
    }
  }

  async resizeChannelToLedger(channelId, amount, retryCount = 0) {
    try {
      this.log("Moving funds from custody to channel (on-chain resize)...");

      // Convert BigInt to number for the resize_amount (in microunits)
      const amountNumber = typeof amount === "bigint" ? Number(amount) : amount;

      // Store for potential retry
      this.pendingResize = { channelId, amount: amountNumber, retryCount };

      // Use resize_amount for on-chain custody → channel operation
      const resizeMessage = await createResizeChannelMessage(
        this.messageSigner,
        {
          channel_id: channelId,
          resize_amount: amountNumber,
          funds_destination: this.userAddress,
        }
      );

      this.ws.send(resizeMessage);
    } catch (error) {
      this.log(`Resize failed: ${error.message}`, "error");
      this.pendingResize = null;
    }
  }

  async handleResizeChannelResponse(data) {
    if (data?.state || data?.channel_id) {
      // Clear pending resize on success
      this.pendingResize = null;

      // Handle on-chain resize flow (from resize box)
      if (this.pendingOnChainResize) {
        await this.executeOnChainResize(data);
        return;
      }

      // Handle deposit/top-up flow
      if (!this.pendingWithdrawal) {
        this.log("Funds moved to ledger!", "success");
        this.getBalances();
        this.getChannels(); // Refresh channel info
        this.checkCustodyBalance(); // Update sync section
        return;
      }

      // Handle withdrawal flow: withdraw from custody on-chain
      // (keep channel open for future use)
      if (this.pendingWithdrawal?.step === "resize_channel") {
        this.log("Funds moved to custody. Withdrawing to wallet...");
        this.pendingWithdrawal.step = "on_chain_withdraw";

        try {
          const withdrawTxHash = await this.withdrawFromCustody(
            this.pendingWithdrawal.amountBigInt
          );
          this.log(`Withdrawal tx: ${withdrawTxHash.slice(0, 10)}...`);
          await this.publicClient.waitForTransactionReceipt({
            hash: withdrawTxHash,
          });
          this.log("Withdrawal complete!", "success");
        } catch (error) {
          this.log(`On-chain withdrawal failed: ${error.message}`, "error");
          console.error("Withdrawal error:", error);
        }

        this.pendingWithdrawal = null;
        this.getBalances();
        this.getChannels();
      }
    }
  }

  async closeChannelForWithdrawal(channelId) {
    try {
      const closeMessage = await createCloseChannelMessage(this.messageSigner, {
        channel_id: channelId,
      });

      this.ws.send(closeMessage);
    } catch (error) {
      this.log(`Close channel failed: ${error.message}`, "error");
      this.pendingWithdrawal = null;
    }
  }

  // ========== WITHDRAW FUNDS ==========

  async withdrawFunds() {
    const amount = parseFloat(this.elements.withdrawAmount?.value || "0");
    if (isNaN(amount) || amount <= 0) {
      this.log("Please enter a valid withdrawal amount", "error");
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      this.log(
        `Insufficient balance. Have: ${(this.ledgerBalance / 1_000_000).toFixed(
          2
        )} USDC`,
        "error"
      );
      return;
    }

    try {
      this.log(`Starting withdrawal: ${amount} USDC to wallet`);
      await this.ensureBaseNetwork();

      this.pendingWithdrawal = {
        amount: amountInMicrounits,
        amountBigInt: parseUnits(amount.toString(), 6),
        step: "resize_channel",
      };

      // Withdrawal flow:
      // 1. Use existing channel or create new one
      // 2. Resize channel to move funds from ledger to custody
      // 3. Withdraw from custody contract on-chain
      if (this.activeChannel) {
        // Use existing channel
        this.pendingWithdrawal.channelId = this.activeChannel.channel_id;
        this.resizeChannelForWithdrawal(
          this.activeChannel.channel_id,
          amountInMicrounits
        );
      } else {
        // Need to create channel first
        this.pendingWithdrawal.step = "create_channel";
        const channelMessage = await createCreateChannelMessage(
          this.messageSigner,
          {
            chain_id: SESSIONS_CONFIG.chain.id,
            token: SESSIONS_CONFIG.chain.token,
          }
        );
        this.ws.send(channelMessage);
      }
    } catch (error) {
      this.log(`Withdrawal failed: ${error.message}`, "error");
    }
  }

  async handleCloseChannelResponse(data) {
    if (
      (data?.state || data?.channel_id) &&
      this.pendingWithdrawal?.step === "close_channel"
    ) {
      this.log("Channel closed. Withdrawing from custody...", "success");
      this.pendingWithdrawal.step = "on_chain_withdraw";

      try {
        // Withdraw from custody contract on-chain
        const withdrawTxHash = await this.withdrawFromCustody(
          this.pendingWithdrawal.amountBigInt
        );
        this.log(`Withdrawal tx: ${withdrawTxHash.slice(0, 10)}...`);
        await this.publicClient.waitForTransactionReceipt({
          hash: withdrawTxHash,
        });
        this.log("Withdrawal complete!", "success");
      } catch (error) {
        this.log(`On-chain withdrawal failed: ${error.message}`, "error");
        console.error("Withdrawal error:", error);
      }

      this.pendingWithdrawal = null;
      this.getBalances();
    } else if (data?.state || data?.channel_id) {
      // Manual close channel (from Close Channel button)
      const closedChannelId = data.channel_id || "unknown";
      this.log(`Channel closed: ${closedChannelId.slice(0, 10)}...`, "success");

      if (this.elements.resizeStatus) {
        this.elements.resizeStatus.style.display = "block";
        this.elements.resizeStatus.textContent = `Channel closed successfully!`;
        this.elements.resizeStatus.style.color = "#4caf50";
      }

      // Clear the channel ID input
      if (this.elements.resizeChannelId) {
        this.elements.resizeChannelId.value = "";
      }

      // Refresh channels and balances
      this.getChannels();
      this.getBalances();
    }
  }

  async withdrawFromCustody(amount) {
    // Custody withdraw ABI
    const custodyWithdrawAbi = [
      {
        inputs: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "withdraw",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
    ];

    try {
      // Try SDK method first
      return await this.nitroliteService.withdraw(
        SESSIONS_CONFIG.chain.token,
        amount
      );
    } catch (sdkError) {
      console.warn("SDK withdraw failed, using direct call:", sdkError.message);

      // Fallback to direct viem writeContract
      return await this.walletClient.writeContract({
        address: SESSIONS_CONFIG.chain.custody,
        abi: custodyWithdrawAbi,
        functionName: "withdraw",
        args: [SESSIONS_CONFIG.chain.token, amount],
        account: this.userAddress,
      });
    }
  }

  // ========== APP SESSIONS ==========

  async createAppSession() {
    const partnerAddress = this.elements.partnerAddress?.value.trim();
    const amount = parseFloat(this.elements.sessionAmount?.value || "0");

    if (!partnerAddress || !partnerAddress.startsWith("0x")) {
      this.log("Please enter a valid partner address", "error");
      return;
    }

    if (partnerAddress.toLowerCase() === this.userAddress.toLowerCase()) {
      this.log("Cannot create session with yourself", "error");
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      this.log("Please enter a valid amount", "error");
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    if (amountInMicrounits > this.ledgerBalance) {
      this.log(
        `Insufficient balance. Have: ${(this.ledgerBalance / 1_000_000).toFixed(
          2
        )} USDC`,
        "error"
      );
      return;
    }

    try {
      this.log(
        `Creating bidirectional session with ${partnerAddress.slice(0, 6)}...`
      );

      const checksummedPartner = getAddress(partnerAddress);
      const checksummedUser = getAddress(this.userAddress);

      // BIDIRECTIONAL: weights [50, 50], quorum 50
      const definition = {
        application: "payment",
        protocol: "NitroRPC/0.4",
        participants: [checksummedUser, checksummedPartner],
        weights: [50, 50], // Both can sign
        quorum: 50, // Either signature sufficient
        challenge: 0,
        nonce: Date.now(),
      };

      // Initial allocation: all with user (they overpay)
      const allocations = [
        {
          participant: checksummedUser,
          asset: SESSIONS_CONFIG.asset,
          amount: amountInMicrounits.toString(),
        },
        {
          participant: checksummedPartner,
          asset: SESSIONS_CONFIG.asset,
          amount: "0",
        },
      ];

      const message = await createAppSessionMessage(this.messageSigner, {
        definition,
        allocations,
      });

      this.ws.send(message);
      this.log("Session request sent...");
    } catch (error) {
      this.log(`Failed to create session: ${error.message}`, "error");
    }
  }

  handleCreateAppSessionResponse(data) {
    if (data?.app_session_id) {
      this.log(
        `Session created: ${data.app_session_id.slice(0, 10)}...`,
        "success"
      );
      this.elements.partnerAddress.value = "";
      this.getAppSessions();
      this.getBalances();
    }
  }

  async getAppSessions() {
    if (!this.isAuthenticated) return;

    try {
      const message = createGetAppSessionsMessageV2(this.userAddress, "open");
      this.ws.send(message);
    } catch (error) {
      this.log(`Failed to get sessions: ${error.message}`, "error");
    }
  }

  handleGetAppSessionsResponse(data) {
    if (data?.app_sessions) {
      this.appSessions = data.app_sessions;
      this.renderSessionsList();
      this.log(`Found ${this.appSessions.length} active session(s)`);
    }
  }

  renderSessionsList() {
    if (!this.elements.sessionsList) return;

    if (this.appSessions.length === 0) {
      this.elements.sessionsList.innerHTML = `
        <p style="color: #888; text-align: center; padding: 1rem;">
          No active sessions. Create one above.
        </p>
      `;
      return;
    }

    this.elements.sessionsList.innerHTML = this.appSessions
      .map((session) => {
        const partner = session.participants.find(
          (p) => p.toLowerCase() !== this.userAddress.toLowerCase()
        );
        const partnerShort = partner
          ? `${partner.slice(0, 6)}...${partner.slice(-4)}`
          : "Unknown";

        return `
        <div class="session-card" data-session-id="${session.app_session_id}">
          <div class="session-header">
            <span class="counterparty">Partner: ${partnerShort}</span>
            <span class="session-status" style="color: ${
              session.status === "open" ? "#4caf50" : "#888"
            };">
              ${session.status}
            </span>
          </div>
          <div class="session-id">ID: ${session.app_session_id.slice(
            0,
            16
          )}...</div>
          <div style="margin-top: 0.5rem; font-size: 0.8rem; color: #aaa;">
            Weights: [${session.weights.join(", ")}] | Quorum: ${session.quorum}
          </div>
          <div class="session-actions">
            <button class="btn-pay" onclick="window.sessionsApp.showPaymentModal('${
              session.app_session_id
            }')">
              💰 Pay / Refund
            </button>
            <button class="btn-close" onclick="window.sessionsApp.closeSession('${
              session.app_session_id
            }')">
              Close
            </button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // Payment modal
  currentSession = null;
  currentSessionAllocations = null;

  showPaymentModal(sessionId) {
    const session = this.appSessions.find(
      (s) => s.app_session_id === sessionId
    );
    if (!session) {
      this.log("Session not found", "error");
      return;
    }

    this.currentSession = session;

    // Find partner
    const partner = session.participants.find(
      (p) => p.toLowerCase() !== this.userAddress.toLowerCase()
    );

    // Get current allocations (we need to fetch or estimate)
    // For now, show the session info
    if (this.elements.paymentSessionId) {
      this.elements.paymentSessionId.textContent =
        sessionId.slice(0, 16) + "...";
    }
    if (this.elements.paymentPartner) {
      this.elements.paymentPartner.textContent = partner
        ? `${partner.slice(0, 10)}...${partner.slice(-6)}`
        : "Unknown";
    }
    if (this.elements.paymentVersion) {
      this.elements.paymentVersion.textContent = session.version || "1";
    }
    if (this.elements.paymentMyBalance) {
      this.elements.paymentMyBalance.textContent = "Loading...";
    }
    if (this.elements.paymentPartnerBalance) {
      this.elements.paymentPartnerBalance.textContent = "Loading...";
    }

    // Show modal
    if (this.elements.paymentModal) {
      this.elements.paymentModal.classList.remove("hidden");
    }

    // Load current allocations from session_data if available
    this.loadSessionAllocations(session);
  }

  loadSessionAllocations(session) {
    // Try to get allocations from localStorage or session_data
    const storageKey = `session_allocations_${session.app_session_id}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        this.currentSessionAllocations = JSON.parse(stored);
      } catch (e) {
        this.currentSessionAllocations = null;
      }
    }

    if (!this.currentSessionAllocations) {
      // Initialize with estimated values
      // In a real app, you'd query the clearnode for current state
      this.currentSessionAllocations = {
        user: 0,
        partner: 0,
        version: session.version || 1,
      };
    }

    this.updatePaymentModalBalances();
  }

  updatePaymentModalBalances() {
    if (this.elements.paymentMyBalance && this.currentSessionAllocations) {
      this.elements.paymentMyBalance.textContent = `${(
        this.currentSessionAllocations.user / 1_000_000
      ).toFixed(2)} USDC`;
    }
    if (this.elements.paymentPartnerBalance && this.currentSessionAllocations) {
      this.elements.paymentPartnerBalance.textContent = `${(
        this.currentSessionAllocations.partner / 1_000_000
      ).toFixed(2)} USDC`;
    }
    if (this.elements.paymentVersion && this.currentSessionAllocations) {
      this.elements.paymentVersion.textContent =
        this.currentSessionAllocations.version.toString();
    }
  }

  hidePaymentModal() {
    if (this.elements.paymentModal) {
      this.elements.paymentModal.classList.add("hidden");
    }
    this.currentSession = null;
    this.currentSessionAllocations = null;
  }

  async sendPayment() {
    if (!this.currentSession) {
      this.log("No session selected", "error");
      return;
    }

    const amount = parseFloat(this.elements.paymentAmount?.value || "0");
    const direction =
      this.elements.paymentDirection?.value || "user-to-partner";

    if (isNaN(amount) || amount <= 0) {
      this.log("Please enter a valid amount", "error");
      return;
    }

    const amountInMicrounits = Math.floor(amount * 1_000_000);
    const partner = this.currentSession.participants.find(
      (p) => p.toLowerCase() !== this.userAddress.toLowerCase()
    );

    if (!partner) {
      this.log("Partner not found", "error");
      return;
    }

    try {
      // Calculate new allocations based on direction
      let newUserAmount, newPartnerAmount;

      if (!this.currentSessionAllocations) {
        this.currentSessionAllocations = { user: 0, partner: 0, version: 1 };
      }

      if (direction === "user-to-partner") {
        // User pays partner
        newUserAmount = Math.max(
          0,
          this.currentSessionAllocations.user - amountInMicrounits
        );
        newPartnerAmount =
          this.currentSessionAllocations.partner + amountInMicrounits;
        this.log(`Paying ${amount} USDC to partner...`);
      } else {
        // Partner refunds user (B can sign this)
        newUserAmount =
          this.currentSessionAllocations.user + amountInMicrounits;
        newPartnerAmount = Math.max(
          0,
          this.currentSessionAllocations.partner - amountInMicrounits
        );
        this.log(`Receiving ${amount} USDC refund from partner...`);
      }

      const newVersion = this.currentSessionAllocations.version + 1;

      const allocations = [
        {
          participant: getAddress(this.userAddress),
          asset: SESSIONS_CONFIG.asset,
          amount: newUserAmount.toString(),
        },
        {
          participant: getAddress(partner),
          asset: SESSIONS_CONFIG.asset,
          amount: newPartnerAmount.toString(),
        },
      ];

      const message = await createSubmitAppStateMessage(this.messageSigner, {
        app_session_id: this.currentSession.app_session_id,
        intent: "operate",
        version: newVersion,
        allocations,
        session_data: JSON.stringify({
          lastPayment: amount,
          direction,
          timestamp: Date.now(),
        }),
      });

      this.ws.send(message);

      // Optimistically update local state
      this.currentSessionAllocations = {
        user: newUserAmount,
        partner: newPartnerAmount,
        version: newVersion,
      };

      // Save to localStorage
      const storageKey = `session_allocations_${this.currentSession.app_session_id}`;
      localStorage.setItem(
        storageKey,
        JSON.stringify(this.currentSessionAllocations)
      );

      this.updatePaymentModalBalances();
    } catch (error) {
      this.log(`Payment failed: ${error.message}`, "error");
    }
  }

  handleSubmitAppStateResponse(data) {
    if (data?.app_session_id) {
      this.log(`Payment sent! Version: ${data.version}`, "success");
      this.getBalances();
    }
  }

  async closeSession(sessionId) {
    const session = this.appSessions.find(
      (s) => s.app_session_id === sessionId
    );
    if (!session) {
      this.log("Session not found", "error");
      return;
    }

    if (
      !confirm(
        "Close this session? Final allocations will be credited to ledger balances."
      )
    ) {
      return;
    }

    try {
      const partner = session.participants.find(
        (p) => p.toLowerCase() !== this.userAddress.toLowerCase()
      );

      // Get stored allocations or use defaults
      const storageKey = `session_allocations_${sessionId}`;
      let allocations;
      const stored = localStorage.getItem(storageKey);

      if (stored) {
        const data = JSON.parse(stored);
        allocations = [
          {
            participant: getAddress(this.userAddress),
            asset: SESSIONS_CONFIG.asset,
            amount: data.user.toString(),
          },
          {
            participant: getAddress(partner),
            asset: SESSIONS_CONFIG.asset,
            amount: data.partner.toString(),
          },
        ];
      } else {
        // Default: return all to user
        allocations = [
          {
            participant: getAddress(this.userAddress),
            asset: SESSIONS_CONFIG.asset,
            amount: "0",
          },
          {
            participant: getAddress(partner),
            asset: SESSIONS_CONFIG.asset,
            amount: "0",
          },
        ];
      }

      const message = await createCloseAppSessionMessage(this.messageSigner, {
        app_session_id: sessionId,
        allocations,
        session_data: JSON.stringify({ closed_at: Date.now() }),
      });

      this.ws.send(message);
      this.log("Closing session...");

      // Clean up localStorage
      localStorage.removeItem(storageKey);
    } catch (error) {
      this.log(`Failed to close session: ${error.message}`, "error");
    }
  }

  async closeCurrentSession() {
    if (this.currentSession) {
      await this.closeSession(this.currentSession.app_session_id);
      this.hidePaymentModal();
    }
  }

  handleCloseAppSessionResponse(data) {
    if (data?.app_session_id) {
      this.log(
        `Session closed: ${data.app_session_id.slice(0, 10)}...`,
        "success"
      );
      this.getAppSessions();
      this.getBalances();
    }
  }
}

// Initialize when DOM is ready
if (typeof window !== "undefined") {
  window.sessionsApp = null;

  // Function to initialize the sessions app
  window.initSessionsApp = () => {
    if (!window.sessionsApp) {
      window.sessionsApp = new SessionsApp();
    }
  };

  // Initialize when tab is switched to sessions (lazy load)
  const originalSwitchTab = window.switchTab;
  window.switchTab = (tab) => {
    if (typeof originalSwitchTab === "function") {
      originalSwitchTab(tab);
    }
    if (tab === "sessions" && !window.sessionsApp) {
      window.initSessionsApp();
    }
  };

  // Auto-init if sessions tab is default
  document.addEventListener("DOMContentLoaded", () => {
    const sessionsTab = document.getElementById("sessions-content");
    if (sessionsTab && sessionsTab.classList.contains("active")) {
      window.initSessionsApp();
    }
  });
}
