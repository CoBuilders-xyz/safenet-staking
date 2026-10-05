/**
 * Mock EIP-1193 Ethereum provider injected via page.addInitScript().
 * This script runs in the browser context before the app loads.
 *
 * Two modes. Without `rpcUrl`, it answers wallet calls itself and fakes transactions into the
 * Node-side mock chain state. With `rpcUrl`, as in the fork suite, it answers only the calls
 * that describe the wallet (accounts, chain, permissions) and forwards everything else to that
 * endpoint, transactions included. Anvil signs them for its unlocked and impersonated accounts,
 * so no private key ever reaches the page.
 */

interface MockProviderConfig {
  chainIdHex: string
  accounts: string[]
  /** Advertise EIP-5792 atomicBatch support (wallet_getCapabilities/sendCalls/getCallsStatus). */
  supportsBatching?: boolean
  /** Forward every non-wallet call, `eth_sendTransaction` included, to this JSON-RPC endpoint. */
  rpcUrl?: string
}

export function createEthereumProviderScript(config: MockProviderConfig): string {
  return `
    (() => {
      const config = ${JSON.stringify(config)};
      const listeners = {};

      // Answered by the wallet itself even when forwarding: they describe the wallet, not the chain.
      const WALLET_METHODS = [
        'eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'net_version',
        'wallet_switchEthereumChain', 'wallet_getPermissions', 'wallet_requestPermissions',
        'wallet_getCapabilities',
      ];
      let rpcId = 0;
      async function forward(method, params) {
        const res = await fetch(config.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params || [] }),
        });
        const body = await res.json();
        if (body.error) {
          // Keep code and data, so viem can decode a revert reason.
          const err = new Error(body.error.message);
          err.code = body.error.code;
          err.data = body.error.data;
          throw err;
        }
        return body.result;
      }

      const provider = {
        isMetaMask: true,
        _metamask: { isUnlocked: () => Promise.resolve(true) },
        chainId: config.chainIdHex,
        networkVersion: String(parseInt(config.chainIdHex, 16)),
        selectedAddress: config.accounts[0] || null,

        on(event, handler) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
          return provider;
        },

        removeListener(event, handler) {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(h => h !== handler);
          }
          return provider;
        },

        removeAllListeners(event) {
          if (event) {
            delete listeners[event];
          } else {
            Object.keys(listeners).forEach(k => delete listeners[k]);
          }
          return provider;
        },

        emit(event, ...args) {
          if (listeners[event]) {
            listeners[event].forEach(h => {
              try { h(...args); } catch (e) { console.error('Provider event error:', e); }
            });
          }
        },

        async request({ method, params }) {
          if (config.rpcUrl && !WALLET_METHODS.includes(method)) return forward(method, params);
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return config.accounts;
            case 'eth_chainId':
              return config.chainIdHex;
            case 'net_version':
              return String(parseInt(config.chainIdHex, 16));
            case 'wallet_switchEthereumChain':
              return null;
            case 'eth_sendTransaction':
              // Let a test simulate the user rejecting the wallet prompt.
              if (window.__shouldRejectTx && await window.__shouldRejectTx()) {
                const rejected = new Error('User rejected the request.');
                rejected.code = 4001;
                throw rejected;
              }
              // Report the submitted call back to the Node-side mock chain state
              // (see mock-chain-state.ts) so subsequent reads reflect the "transaction".
              // A transaction whose receipt carries logs (a claim) comes back with its own hash.
              let txHash;
              if (window.__mockTx && params[0] && params[0].data) {
                txHash = await window.__mockTx(params[0].data);
              }
              // Otherwise a deterministic mock tx hash
              return txHash || '${`0x${"a".repeat(64)}`}';
            case 'personal_sign':
              return '0x' + 'ab'.repeat(65);
            case 'eth_getBalance':
              return '0x56BC75E2D63100000'; // 100 ETH
            case 'eth_getTransactionCount':
              return '0x1';
            case 'wallet_getPermissions':
              return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_requestPermissions':
              return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_getCapabilities':
              // EIP-5792. Only advertised for tests that opt in (see batchingPage fixture) —
              // most existing tests rely on this being unsupported (throwing below) so the
              // app falls back to the sequential approve-then-stake flow.
              if (!config.supportsBatching) throw new Error('MockProvider: unhandled method wallet_getCapabilities');
              return { [config.chainIdHex]: { atomicBatch: { supported: true } } };
            case 'wallet_sendCalls': {
              const calls = (params[0] && params[0].calls) || [];
              // The batch id doubles as the executed transaction's hash in wallet_getCallsStatus.
              let batchHash;
              for (const call of calls) {
                if (window.__mockTx && call.data) batchHash = (await window.__mockTx(call.data)) || batchHash;
              }
              return batchHash || '${`0x${"5".repeat(64)}`}';
            }
            case 'wallet_getCallsStatus':
              return {
                version: '2.0.0',
                id: params[0],
                chainId: config.chainIdHex,
                status: 200,
                receipts: [{
                  logs: [],
                  status: '0x1',
                  blockHash: '0x' + 'bb'.repeat(32),
                  blockNumber: '0x6000000',
                  gasUsed: '0x30d40',
                  transactionHash: params[0],
                }],
              };
            default:
              // Fall through to the RPC handler for contract calls
              throw new Error('MockProvider: unhandled method ' + method);
          }
        }
      };

      // Expose globally for wagmi's injected connector detection
      window.ethereum = provider;

      // Also announce as EIP-6963
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'mock-wallet', name: 'Mock Wallet', icon: 'data:image/svg+xml,<svg/>', rdns: 'io.mock.wallet' },
          provider
        }
      }));
    })();
  `
}

/**
 * Script to create a disconnected wallet state (no accounts).
 */
export function createDisconnectedProviderScript(chainIdHex: string): string {
  return createEthereumProviderScript({ chainIdHex, accounts: [] })
}
