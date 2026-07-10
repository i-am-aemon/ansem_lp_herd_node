/**
 * Browser Phantom helpers — exported as an HTML <script> string for dashboard pages.
 * Never asks for seed/private key. Only signAndSendTransaction on unsigned base64 txs.
 */
export function phantomSignScript() {
  return `
        const PHANTOM_LS_KEY = 'ansem_node_phantom_pubkey';

        function getPhantomProvider() {
          if (typeof window === 'undefined') return null;
          const dedicated = window.phantom?.solana;
          if (dedicated?.isPhantom) return dedicated;
          if (window.solana?.isPhantom) return window.solana;
          return null;
        }

        function waitForPhantom(ms) {
          return new Promise((resolve) => {
            const existing = getPhantomProvider();
            if (existing) return resolve(existing);
            let done = false;
            const finish = (p) => {
              if (done) return;
              done = true;
              window.removeEventListener('phantom#initialized', onInit);
              clearTimeout(timer);
              resolve(p || getPhantomProvider());
            };
            const onInit = () => finish(getPhantomProvider());
            window.addEventListener('phantom#initialized', onInit);
            const timer = setTimeout(() => finish(getPhantomProvider()), ms || 2500);
            let n = 0;
            const poll = setInterval(() => {
              const p = getPhantomProvider();
              if (p || ++n > 25) {
                clearInterval(poll);
                finish(p);
              }
            }, 100);
          });
        }

        function rememberedPubkey() {
          try { return localStorage.getItem(PHANTOM_LS_KEY) || ''; } catch (_) { return ''; }
        }

        function rememberPubkey(pk) {
          try { if (pk) localStorage.setItem(PHANTOM_LS_KEY, pk); } catch (_) {}
        }

        function phantomErrMessage(e) {
          if (!e) return 'unknown error';
          if (typeof e === 'string') return e;
          const code = e.code != null ? (' [' + e.code + ']') : '';
          const msg = e.message || e.error?.message || e.error || String(e);
          if (/unexpected error/i.test(msg)) {
            return 'Phantom unexpected error' + code + ' — unlock Phantom, then click Connect again in Chrome/Brave';
          }
          if (/user rejected|rejected the request|denied/i.test(msg)) {
            return 'You cancelled in Phantom — nothing was linked';
          }
          return msg + code;
        }

        /**
         * Open Phantom and prompt the user to connect.
         * forcePrompt: disconnect first so the wallet popup always appears.
         */
        async function ensurePhantomConnected(opts) {
          const forcePrompt = Boolean(opts && opts.forcePrompt);
          let provider = getPhantomProvider();
          if (!provider) provider = await waitForPhantom(2500);
          if (!provider) {
            throw new Error('Phantom not found — open this dashboard in Chrome/Brave with Phantom unlocked');
          }

          if (!forcePrompt) {
            try {
              if (provider.isConnected && provider.publicKey) {
                const pk = provider.publicKey.toString();
                rememberPubkey(pk);
                return pk;
              }
            } catch (_) {}
          } else {
            // Force a fresh Connect popup so the user sees Phantom open
            try {
              if (provider.isConnected) await provider.disconnect();
            } catch (_) {}
          }

          let res;
          try {
            res = await provider.connect();
          } catch (e) {
            if (!forcePrompt && provider.publicKey) {
              const pk = provider.publicKey.toString();
              rememberPubkey(pk);
              return pk;
            }
            throw new Error(phantomErrMessage(e));
          }
          const pk = res?.publicKey?.toString?.() || provider.publicKey?.toString?.();
          if (!pk) throw new Error('Phantom connected but no pubkey returned');
          rememberPubkey(pk);
          return pk;
        }

        async function disconnectPhantomQuiet() {
          try {
            const provider = getPhantomProvider();
            if (provider?.isConnected) await provider.disconnect();
          } catch (_) {}
        }

        /**
         * Watch Phantom disconnect / accountChanged. Returns an unbind fn.
         * onStop(reason) is called once per event; caller should halt session + re-auth.
         */
        function bindPhantomSessionWatchers(onStop) {
          const provider = getPhantomProvider();
          if (!provider || typeof onStop !== 'function') return () => {};
          let stopped = false;
          const fire = (reason) => {
            if (stopped) return;
            stopped = true;
            try { onStop(reason); } catch (_) {}
          };
          const onDisconnect = () => fire('phantom_disconnect');
          const onAccountChanged = (publicKey) => {
            if (!publicKey) fire('phantom_account_cleared');
            else fire('phantom_account_changed');
          };
          try { provider.on?.('disconnect', onDisconnect); } catch (_) {}
          try { provider.on?.('accountChanged', onAccountChanged); } catch (_) {}
          return () => {
            stopped = true;
            try { provider.removeListener?.('disconnect', onDisconnect); } catch (_) {}
            try { provider.off?.('disconnect', onDisconnect); } catch (_) {}
            try { provider.removeListener?.('accountChanged', onAccountChanged); } catch (_) {}
            try { provider.off?.('accountChanged', onAccountChanged); } catch (_) {}
          };
        }

        async function signBase64Tx(serializedB64) {
          if (!serializedB64) throw new Error('No serialized tx — rebuild plan');
          const provider = getPhantomProvider() || await waitForPhantom(2500);
          if (!provider) throw new Error('Phantom not found');
          await ensurePhantomConnected();
          const solanaWeb3 = window.solanaWeb3;
          if (!solanaWeb3?.Transaction) {
            throw new Error('solanaWeb3 missing — page must load @solana/web3.js UMD');
          }
          const raw = Uint8Array.from(atob(serializedB64), c => c.charCodeAt(0));
          const tx = solanaWeb3.Transaction.from(raw);
          const { signature } = await provider.signAndSendTransaction(tx);
          return signature;
        }
  `;
}

/** CDN script tag for Transaction.from in the browser */
export function solanaWeb3CdnTag() {
  return `<script src="https://unpkg.com/@solana/web3.js@1.98.4/lib/index.iife.min.js"></script>`;
}
