# CROPSmaster — Private DeFi Intelligence, Public On-Chain Action

> *"Ethereum provides public coordination; Venice provides private cognition."*

An autonomous AI agent that scores DeFi protocols using the **CROPS framework** (Censorship Resistance, Open Source, Privacy, Security), commits scores on-chain, and rebalances a vault index via Uniswap — all powered by Venice private inference.

## Live Demo (Ethereum Sepolia)

- **Vault contract**: `0x339D8D21531abeBCd4612CF0c6e082FCc5fD6Dd1`
- **Agent wallet**: `0x43fb3bc082C286Bb0F19AD3F98418bb9181d704F`
- **Latest scores**: [`crops-scores.json`](./crops-scores.json)

## The Venice Pattern: Private Cognition → Public Consequence

DeFi protocols hold sensitive data that affects their risk profile but cannot be made public: unpublished audit findings, treasury compositions, undisclosed vulnerability disclosures. This is the problem Venice solves.

### Step 1 — Private Input
Each protocol submits a confidential document to the agent. It is passed **exclusively** to Venice's no-data-retention inference — never logged, never stored, never sent to any other provider.

```typescript
const privateDocument = privateMemo; // never logged
const result = await venice.chat.completions.create({
  model: "qwen3-4b",              // Venice no-retention model
  baseURL: "https://api.venice.ai/api/v1",
  messages: [
    { role: "system", content: "Return only JSON: {delta: number, reasoning: string}" },
    { role: "user", content: `Private audit memo for ${protocol}:\n${privateDocument}` } // never logged
  ]
});
```

### Step 2 — Venice Inference
Venice reasons over the sensitive document and returns only a **numeric delta** `[-0.2, +0.2]`. The original document is never retained by Venice, never in our logs, never propagated downstream.

```
Input (private):  "Confidential: $500K bad debt absorbed silently in Jan 2026..."
Output (public):  { delta: -0.2, reasoning: "Unreported bad debt reduces security score" }
```

### Step 3 — On-Chain Output
Only the final CROPS score is committed on-chain. The private document never leaves the Venice inference call.

```
Railgun:    CROPS=0.5685 → vault.updateScore() → 0xcb830a... (Sepolia)
Uniswap V4: CROPS=0.3865 → vault.updateScore() → 0x3d9356...
Aave V3:    CROPS=0.3412 → vault.updateScore() → 0x294704...
```

> *"Any VPS is off-chain — that's not the point. Venice provides a verifiable no-retention guarantee: protocols can share sensitive scoring inputs without trusting us as operators. Only the score is public."*

---

## Trust Mechanism: Slash for False Disclosure

Protocols are incentivized to submit accurate confidential data. If a protocol submits a false memo to inflate its CROPS score, the agent detects the inconsistency and **slashes** it on-chain.

### How Slashing Works

When the agent receives a confidential update, Venice runs a two-pass verification:

1. **Score delta pass** — extracts the numeric impact of the disclosed information
2. **Gaming detection pass** — cross-checks the claim against known public facts

```
Protocol → confidential memo → Venice (no retention)
                                    ↓
                          [pass 1] score delta ∈ [-0.2, +0.2]
                          [pass 2] is this claim consistent with public data?
                                    ↓
                     consistent → apply delta → vault.updateScore()
                     inconsistent → SLASH → vault.updateScore(protocol, 0)
```

```typescript
// Gaming detection via Venice (private, no retention)
const { gamed, reason } = await detectGaming(
  protocol, privateMemo, publicKnowledge  // memo never logged
);

if (gamed) {
  // Score → 0 on-chain: protocol removed from vault allocation
  await vault.updateScore(protocol, 0);
}
```

### Slash Example

```
Aave V3 submits: "No bad debt exposure. All positions fully collateralized at 150%+ LTV."
Venice detects:  inconsistent with public reports of $500K bad debt in Jan 2026
Result:          vault.updateScore(0x8787..., 0) → CROPS = 0 → weight = 0%
Consequence:     all vault allocation rebalanced away from Aave via Uniswap
```

### Aligned Incentives

| Action | Outcome |
|--------|---------|
| Submit accurate bad news | Score drops slightly, weight decreases, allocation reduced |
| Submit false good news | Score → 0, weight → 0%, slashed from vault permanently |
| Submit no data | Score unchanged, weight unchanged |

Protocols gain nothing from lying — the expected value of a false disclosure is always negative.

---

## Rebalancing Schedule

The agent rebalances the vault in two conditions:

```
1. SCHEDULED   — every 2 weeks (autonomous cron, UTC midnight)
2. ON-DEMAND   — immediately when a protocol submits a confidential update
```

```
Week 0  → initial scoring → vault allocation → 57% Railgun / 30% Uniswap / 13% Aave
Week 2  → rescore all protocols → delta rebalancing → Uniswap API swaps
Week 3  → Aave submits false memo → Venice detects gaming → slash → 100% rebalanced out
Week 4  → scheduled run → Aave still at score=0 → allocation stays at 0
```

The vault accumulates protocol fees between rebalancing cycles. Yield is denominated in the base asset (ETH) and compounds into the next cycle's available balance.

---

## CROPS Multi-Factor Model

Inspired by Fama-French factor models, CROPS quantifies DeFi protocol alignment with the Ethereum Foundation's March 2026 mandate:

```
CROPS = 0.30 × CR + 0.25 × OS + 0.25 × P + 0.20 × S    ∈ [0, 1]
```

| Factor | Weight | Formula | Description |
|--------|--------|---------|-------------|
| **CR** Censorship Resistance | 30% | `0.4×CR1 + 0.3×CR2 + 0.3×CR3` | Admin key risk, permissionless access, exit guarantees |
| **OS** Open Source | 25% | `min(contributors × OS_pct / 500, 1)` | GitHub contributor network quality |
| **P** Privacy | 25% | `0.5×TechLevel + 0.5×PrivacyTeamPct` | ZK/crypto tech stack + privacy-focused contributors |
| **S** Security | 20% | `min(audits × rep / 10, 1) × (1 - exploit_penalty)` | Weighted audits minus exploit history |

### Current Rankings

| Protocol | CR | OS | P | S | **CROPS** | Role in vault |
|----------|----|----|---|---|-----------|---------------|
| Railgun | 1.000 | 0.035 | 0.675 | 0.455 | **0.5685** | Privacy anchor (ETH base) |
| Uniswap V4 | 0.730 | 0.192 | 0.110 | 0.460 | **0.3865** | CR exposure (USDC) |
| Aave V3 | 0.580 | 0.136 | 0.115 | 0.522 | **0.3412** | Security exposure (USDC) |

---

## Uniswap Integration

The agent rebalances the vault using the **Uniswap Trading API** (Developer Platform API key required). All swaps are real, on-chain, with verifiable TxIDs.

### True Delta Rebalancing

The agent does not blindly buy on every run. It reads the current portfolio state and swaps **only the delta** between the previous and new target allocations:

```
portfolio weights  = CROPS_protocol / CROPS_total
target_eth         = available_eth × weight
delta              = target_eth - previous_target_eth

delta > threshold  → buy  (ETH → USDC via Uniswap API)
delta < -threshold → sell (USDC → ETH via Uniswap API + Permit2)
|delta| < threshold → hold
```

### Swap Flow

```
POST trade-api.gateway.uniswap.org/v1/quote   { tokenIn, tokenOut, amount, swapper }
POST trade-api.gateway.uniswap.org/v1/swap    { quote, signature, permitData }
agentWallet.sendTransaction(swap)             → TxID on Sepolia
```

### Real TxIDs (Ethereum Sepolia)

See [`crops-scores.json`](./crops-scores.json) for the full run history with all `scoreTx` and `swapTx` hashes.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  CROPSmaster Agent (VPS)                      │
│                                                               │
│  SCHEDULED (every 2 weeks) or ON-DEMAND (confidential input): │
│                                                               │
│  for each protocol:                                           │
│    1. Compute public score (CR, OS, P, S)                     │
│    2. [VENICE] private memo → score delta      ← no retention │
│    3. [VENICE] gaming check → slash if false   ← no retention │
│    4. final_score = public_score + venice_delta               │
│    5. vault.updateScore(protocol, score)  ─────────────────► │ Ethereum Sepolia
│                                                               │
│  rebalance():                                                 │
│    6. read ETH + USDC balances                                │
│    7. compute target weights from CROPS scores                │
│    8. delta = target - previous                               │
│    9. Uniswap API → swap delta  ───────────────────────────► │ Sepolia TxID
│                                                               │
│  on false disclosure:                                         │
│   10. vault.updateScore(protocol, 0) → SLASH ──────────────► │ score = 0
│   11. rebalance() → weight = 0 → Uniswap exits position ───► │ Sepolia TxID
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent runtime | TypeScript + Node.js, Oracle Cloud VPS (Ubuntu 22.04 ARM) |
| Private inference | Venice API `api.venice.ai`, model `qwen3-4b` (no data retention) |
| Smart contract | ERC-4626 CROPSVault, Solidity + Foundry, Ethereum Sepolia |
| Swaps | Uniswap Trading API v1 + Permit2, Developer Platform key |
| Blockchain | ethers.js v6 + Alchemy RPC |
| Security | UFW firewall, SSH key-only auth, isolated agent wallet |

## Running the Agent

```bash
git clone https://github.com/CROPSmaster/crops-master
cd crops-master
npm install

# Configure environment
cp .env.example .env
# VENICE_API_KEY=...
# AGENT_PRIVATE_KEY=...
# UNISWAP_API_KEY=...
# ALCHEMY_RPC=...
# VAULT_ADDRESS=0x339D8D21531abeBCd4612CF0c6e082FCc5fD6Dd1

npx ts-node --transpile-only src/agent/crops-agent.ts
```

## Smart Contract

```solidity
// CROPSVault — ERC-4626 with on-chain CROPS scoring
// Deployed: 0x339D8D21531abeBCd4612CF0c6e082FCc5fD6Dd1 (Ethereum Sepolia)

function updateScore(address protocol, uint256 score) external onlyOwner {
    // Only the numeric score is stored — private documents never reach this function
    cropsScore[protocol] = score;
    emit ScoreUpdated(protocol, score);
}
```

## Roadmap

- [x] Dashboard with live CROPS scores, portfolio chart, and factor breakdown
- [x] Demo mode: full 10-protocol evaluation with Venice inference + on-chain scoring
- [x] Slash mechanism: Venice gaming detection → score = 0 on-chain → Uniswap exit
- [x] Confidential update endpoint: protocols submit private memos, Venice verifies
- [ ] Autonomous cron scheduling (rebalance every 2 weeks, UTC midnight)
- [ ] Backtesting CROPS strategy vs ETH hodl (CoinGecko historical prices)
- [ ] Performance fee → $CROPS share holders (ERC-4626 management fee)
- [ ] Real GitHub GraphQL + DefiLlama data (replace static fallbacks)
- [ ] Base x402 agent services (pay-per-query CROPS score endpoint)

---

*Built for [The Synthesis Hackathon](https://synthesis.md) — March 2026*
*Bounty tracks: Venice Private Agents · Uniswap Agentic Finance · Base Autonomous Trading Agent*
