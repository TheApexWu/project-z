// src/x402live.mjs — REAL x402 / Monad-testnet settlement facilitator (OPT-IN live mode).
//
// SCAFFOLD (Carson's lane): structurally complete, but two things MUST be confirmed at the
// Day-1 Monad workshop before a real send:
//   (1) the Monad x402 facilitator's /settle request + response shape, and
//   (2) the testnet USDC EIP-712 domain (name / version) below.
//
// Same interface as makeFacilitator (verify / settle) so it drops into the seam untouched.
// viem is LAZY-imported ONLY here, so `node run.mjs` and `node --test` never load it and the
// offline gauge stays zero-runtime-dependency. NEVER call this from evolve / coevolve /
// runBenchmark / harness — those always use the seeded mock.
//
// SAFETY RAILS: asserts chainId 10143 before signing · one settlement per call · hard USDC
// cap · dry-run · on-chain receipt verification (a hash not mined / wrong sender = FAILURE,
// never a faked success).

const MONAD_TESTNET = 10143;

async function loadViem() {
  try {
    return { core: await import("viem"), accounts: await import("viem/accounts") };
  } catch {
    throw new Error("viem not installed — `npm i viem` (optionalDependency; live mode only)");
  }
}

export function makeLiveFacilitator(cfg = {}) {
  const {
    rpcUrl, privateKey, usdc, facilitatorUrl,
    maxUsdc = 1, chainId = MONAD_TESTNET, decimals = 6,
    usdcDomain = { name: "USD Coin", version: "2" }, // CONFIRM for Monad-testnet USDC (Day-1)
  } = cfg;
  let V, pub, account;

  async function ready() {
    if (pub) return;
    if (!rpcUrl || !privateKey || !usdc || !facilitatorUrl)
      throw new Error("live facilitator missing config (rpcUrl / privateKey / usdc / facilitatorUrl)");
    V = await loadViem();
    pub = V.core.createPublicClient({ transport: V.core.http(rpcUrl) });
    account = V.accounts.privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : "0x" + privateKey);
    const live = await pub.getChainId();
    if (live !== chainId)
      throw new Error(`refusing to sign: RPC chainId ${live} !== ${chainId} (Monad testnet). No tx sent.`);
  }

  // Build + sign an EIP-3009 TransferWithAuthorization. No approve()/allowance — one signature
  // moves funds, so the cap + chain assertions are the only guardrails; they run here.
  async function buildAuthorization(p) {
    await ready();
    if (!(p.amount > 0)) throw new Error("amount must be > 0");
    if (p.amount > maxUsdc) throw new Error(`amount $${p.amount} exceeds hard cap $${maxUsdc} — refusing`);
    const { randomBytes } = await import("node:crypto");
    const nonce = "0x" + randomBytes(32).toString("hex"); // fresh 32-byte nonce; NOT the mock's integer nonce
    const now = Math.floor(Date.now() / 1000);
    const message = {
      from: account.address, to: p.payTo,
      value: BigInt(Math.round(p.amount * 10 ** decimals)),
      validAfter: 0n, validBefore: BigInt(now + 3600), nonce,
    };
    const typedData = {
      domain: { name: usdcDomain.name, version: usdcDomain.version, chainId, verifyingContract: usdc },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message,
    };
    const signature = await account.signTypedData(typedData);
    // wire form: BigInts -> strings so the body is JSON-serializable
    const wire = { from: message.from, to: message.to, value: message.value.toString(), validAfter: "0", validBefore: message.validBefore.toString(), nonce };
    return { typedData, wire, signature };
  }

  return {
    kind: "live-monad",
    address: () => account?.address ?? null,

    async preflight() {
      await ready();
      const bal = await pub.getBalance({ address: account.address });
      return { address: account.address, chainId, nativeBalanceWei: bal.toString() };
    },

    async verify(p) { return p.amount > 0 && !!p.payTo && p.amount <= maxUsdc; },

    // dry-run: build + sign the authorization, print intent, DO NOT broadcast.
    async dryRun(p) {
      const a = await buildAuthorization(p);
      return { chainId, to: p.payTo, amount: p.amount.toFixed(6), verifyingContract: usdc, nonce: a.wire.nonce, willSend: false };
    },

    // settle: ONE real settlement. Hand the signed EIP-3009 authorization to the facilitator,
    // then VERIFY on-chain. A missing hash / wrong sender = FAILURE (never a fake success).
    async settle(p) {
      const { wire, signature } = await buildAuthorization(p);
      let res;
      try {
        // TODO Day-1: confirm the Monad x402 facilitator's /settle contract.
        res = await fetch(facilitatorUrl.replace(/\/$/, "") + "/settle", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ authorization: wire, signature, asset: usdc, chainId }),
        });
      } catch (e) {
        return { settled: false, reverted: false, moved: 0, error: `facilitator unreachable: ${e.message}` };
      }
      if (!res.ok) return { settled: false, reverted: false, moved: 0, error: `facilitator ${res.status}` };
      const body = await res.json().catch(() => ({}));
      const txHash = body.txHash || body.transactionHash || body.hash;
      if (!txHash) return { settled: false, reverted: false, moved: 0, error: "facilitator returned no txHash" };
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
      const ok = receipt.status === "success" && receipt.from?.toLowerCase() === account.address.toLowerCase();
      return { settled: ok, reverted: !ok, moved: ok ? p.amount : 0, txHash, blockNumber: receipt.blockNumber?.toString() };
    },
  };
}
