import OpenAI from "openai";
import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

// ── Venice client (private inference, no data retention) ────────────────────
const venice = new OpenAI({
  baseURL: "https://api.venice.ai/api/v1",
  apiKey: process.env.VENICE_API_KEY!,
});

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC!);
const agentWallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);

const VAULT_ABI = [
  "function updateScore(address protocol, uint256 score) external",
  "function cropsScore(address) view returns (uint256)",
];
const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, agentWallet);

const CHAIN_ID = 11155111;

// ── All 10 CROPS-aligned protocols ─────────────────────────────────────────
// On Sepolia: real Venice inference + real on-chain scores for all 10
// Swaps: real execution for WETH/USDC (Sepolia liquidity), simulated for others
const PROTOCOLS = [
  {
    name: "Railgun",
    ticker: "RAIL",
    address: "0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405",
    color: "#a855f7",
    weight: 0.25,
    cr: { cr1: 1.0, cr2: 1.0, cr3: 1.0 },
    privacyTech: 1.0,
    sepoliaToken: "WETH", // base asset, no swap needed
    mainnetToken: "RAIL",
    github: "Railgun-Privacy/railgun-smart-contracts",
    audits: 3, auditRep: 0.85, lossM: 0,
    privacyTeamPct: 0.35,
    contributors: 22,
    mockAuditMemo: "ZK circuit audit complete: Groth16 proof system verified, no vulnerabilities. Privacy guarantees formally verified by third party. Shielded pool TVL growing steadily.",
  },
  {
    name: "Aztec",
    ticker: "AZTEC",
    address: "0x1169ac6D18e4e74a6B43B3Ef78FcFb0e3C4b8c2",
    color: "#f97316",
    weight: 0.20,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.7 },
    privacyTech: 0.95,
    sepoliaToken: "WETH", // simulated on Sepolia
    mainnetToken: "AZTEC",
    github: "AztecProtocol/aztec-packages",
    audits: 6, auditRep: 0.92, lossM: 0,
    privacyTeamPct: 0.45,
    contributors: 180,
    mockAuditMemo: "Confidential audit of Noir circuit compilation: 2 medium findings patched. ZK proof generation benchmarks improved 40% in latest release. Core team contributor review: 45% have prior Zcash/Semaphore contributions.",
  },
  {
    name: "iExec",
    ticker: "RLC",
    address: "0xC8B960D09C0078c18Dcbe7eB9AB9d816BcCa8944",
    color: "#6366f1",
    weight: 0.10,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.5 },
    privacyTech: 0.5,
    sepoliaToken: "WETH",
    mainnetToken: "RLC",
    github: "iExecBlockchainComputing/iexec-core",
    audits: 4, auditRep: 0.80, lossM: 0,
    privacyTeamPct: 0.10,
    contributors: 65,
    mockAuditMemo: "TEE (Trusted Execution Environment) audit: Intel SGX integration secure. Confidential computing workloads verified. No critical findings. Decentralized compute marketplace operational.",
  },
  {
    name: "Uniswap",
    ticker: "UNI",
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    color: "#ec4899",
    weight: 0.10,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.5 },
    privacyTech: 0.2,
    sepoliaToken: "USDC",
    mainnetToken: "UNI",
    github: "Uniswap/v4-core",
    audits: 4, auditRep: 0.90, lossM: 0,
    privacyTeamPct: 0.02,
    contributors: 120,
    mockAuditMemo: "Internal audit Q1 2026: no critical findings. 3 medium issues patched. Treasury multisig rotation pending. v4 hooks architecture review: composability surface expanded significantly.",
  },
  {
    name: "Aave",
    ticker: "AAVE",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    color: "#14b8a6",
    weight: 0.10,
    cr: { cr1: 0.7, cr2: 0.5, cr3: 0.5 },
    privacyTech: 0.2,
    sepoliaToken: "USDC",
    mainnetToken: "AAVE",
    github: "aave/aave-v3-core",
    audits: 8, auditRep: 0.95, lossM: 0.5,
    privacyTeamPct: 0.03,
    contributors: 85,
    mockAuditMemo: "Confidential disclosure: $500K bad debt absorbed silently in Jan 2026. Risk team flagged single borrower concentration risk. GHO stablecoin peg mechanisms under review. Security score slightly reduced.",
  },
  {
    name: "ENS",
    ticker: "ENS",
    address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
    color: "#3b82f6",
    weight: 0.075,
    cr: { cr1: 1.0, cr2: 1.0, cr3: 0.7 },
    privacyTech: 0.2,
    sepoliaToken: "WETH",
    mainnetToken: "ENS",
    github: "ensdomains/ens-contracts",
    audits: 5, auditRep: 0.88, lossM: 0,
    privacyTeamPct: 0.05,
    contributors: 95,
    mockAuditMemo: "DNS root DNSSEC bridge audit complete: no vulnerabilities in ENS-DNS integration. DAO treasury composition disclosed privately: 85% ETH, 15% stables. Governance participation rate stable at 12%.",
  },
  {
    name: "Rocket Pool",
    ticker: "RPL",
    address: "0xae78736Cd615f374D3085123A210448E74Fc6393",
    color: "#f59e0b",
    weight: 0.075,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.7 },
    privacyTech: 0.2,
    sepoliaToken: "WETH",
    mainnetToken: "RPL",
    github: "rocket-pool/rocketpool",
    audits: 6, auditRep: 0.88, lossM: 0,
    privacyTeamPct: 0.05,
    contributors: 48,
    mockAuditMemo: "Node operator insurance mechanism audit: slash coverage adequate at current RPL price. Atlas upgrade post-audit: LEB8 minipools performing as expected. No centralization concerns in top-20 node operators.",
  },
  {
    name: "Gnosis Safe",
    ticker: "SAFE",
    address: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
    color: "#22c55e",
    weight: 0.05,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 1.0 },
    privacyTech: 0.2,
    sepoliaToken: "WETH",
    mainnetToken: "SAFE",
    github: "safe-global/safe-contracts",
    audits: 12, auditRep: 0.95, lossM: 0,
    privacyTeamPct: 0.08,
    contributors: 120,
    mockAuditMemo: "Safe{Core} protocol audit: modular architecture review complete. 12 audits total, zero critical findings in 4 years. Confidential security report: guard module pattern robust against reentrancy.",
  },
  {
    name: "Lido",
    ticker: "LDO",
    address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    color: "#eab308",
    weight: 0.025,
    cr: { cr1: 0.3, cr2: 0.5, cr3: 0.5 },
    privacyTech: 0.2,
    sepoliaToken: "WETH",
    mainnetToken: "LDO",
    github: "lidofinance/lido-dao",
    audits: 10, auditRep: 0.90, lossM: 0,
    privacyTeamPct: 0.02,
    contributors: 110,
    mockAuditMemo: "Validator set composition disclosed privately: top-5 operators control 38% of stake (above 33% threshold). Dual governance proposal in progress. Security strong but centralization risk is primary concern.",
  },
  {
    name: "Curve",
    ticker: "CRV",
    address: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    color: "#ef4444",
    weight: 0.025,
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.5 },
    privacyTech: 0.2,
    sepoliaToken: "USDC",
    mainnetToken: "CRV",
    github: "curvefi/curve-contract",
    audits: 8, auditRep: 0.85, lossM: 6.2,
    privacyTeamPct: 0.02,
    contributors: 75,
    mockAuditMemo: "Post-reentrancy incident review: vyper compiler vulnerability patched across all affected pools. $6.2M loss in 2023 fully noted in exploit penalty. Current codebase clean, new audits confirm no residual risk.",
  },
];

// ── CROPS scoring ────────────────────────────────────────────────────────────
function calcCR(p: any): number {
  return 0.4 * p.cr.cr1 + 0.3 * p.cr.cr2 + 0.3 * p.cr.cr3;
}

function calcOS(p: any): number {
  return Math.min((p.contributors * 0.8) / 500, 1.0);
}

function calcPrivacy(p: any): number {
  return 0.5 * p.privacyTech + 0.5 * p.privacyTeamPct;
}

function calcSecurity(p: any): number {
  const base = Math.min((p.audits * p.auditRep) / 10, 1.0);
  const penalty = Math.min(p.lossM / 10, 1.0);
  return base * (1 - penalty);
}

// ── Venice private inference ─────────────────────────────────────────────────
async function getVeniceDelta(protocol: string, privateMemo: string): Promise<{ delta: number; reasoning: string }> {
  try {
    const privateDocument = privateMemo; // never logged
    const result = await venice.chat.completions.create({
      model: "qwen3-4b",
      messages: [
        {
          role: "system",
          content: 'You are a DeFi security analyst. Extract a security score delta [-0.2, +0.2] from the private audit document. Return only raw JSON with no markdown: {"delta": number, "reasoning": string}',
        },
        {
          role: "user",
          content: `Private audit memo for ${protocol}:\n${privateDocument}`, // never logged
        },
      ],
    });
    const rawText = result.choices[0].message.content ?? '{"delta": 0, "reasoning": "no data"}';
    const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const parsed = JSON.parse(text);
    return { delta: parsed.delta ?? 0, reasoning: parsed.reasoning ?? "" };
  } catch (e) {
    console.error(`  Venice error:`, (e as Error).message);
    return { delta: 0, reasoning: "inference unavailable" };
  }
}

// ── On-chain score commit ────────────────────────────────────────────────────
async function commitScoreOnChain(address: string, score: number): Promise<string | null> {
  try {
    const scoreOnChain = Math.round(score * 10000);
    const tx = await vault.updateScore(address, scoreOnChain);
    await tx.wait();
    return tx.hash;
  } catch (e) {
    console.error(`  On-chain error:`, (e as Error).message);
    return null;
  }
}

// ── Simulated swap (for tokens without Sepolia liquidity) ───────────────────
function simulateSwap(ticker: string, ethAmount: number): object {
  const prices: Record<string, number> = {
    RAIL: 0.85, AZTEC: 2.10, RLC: 1.45, UNI: 8.20, AAVE: 92.0,
    ENS: 18.5, RPL: 14.2, SAFE: 1.20, LDO: 1.85, CRV: 0.52,
    WETH: 3200, USDC: 1.0,
  };
  const ethPrice = prices["WETH"] ?? 3200;
  const tokenPrice = prices[ticker] ?? 1.0;
  const usdValue = ethAmount * ethPrice;
  const tokensOut = usdValue / tokenPrice;
  return {
    simulated: true,
    note: `Production swap: ${ethAmount.toFixed(6)} ETH → ${tokensOut.toFixed(4)} ${ticker} @ $${tokenPrice}`,
    estimatedUSD: usdValue.toFixed(2),
    estimatedTokens: tokensOut.toFixed(4),
    sepoliaNote: `${ticker} pool not available on Sepolia testnet — real execution on mainnet`,
  };
}

// ── Real Uniswap swap (WETH/USDC only on Sepolia) ───────────────────────────
async function realUniswapSwap(tokenOut: string, amountWei: string): Promise<string | null> {
  const TOKEN_ADDRESSES: Record<string, string> = {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  };
  const tokenAddr = TOKEN_ADDRESSES[tokenOut];
  if (!tokenAddr) return null;

  const API_URL = "https://trade-api.gateway.uniswap.org/v1";
  const headers: Record<string, string> = {
    "x-api-key": process.env.UNISWAP_API_KEY!,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const quoteRes = await fetch(`${API_URL}/quote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tokenIn: "0x0000000000000000000000000000000000000000",
      tokenOut: tokenAddr,
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      type: "EXACT_INPUT",
      amount: amountWei,
      swapper: agentWallet.address,
      routingPreference: "BEST_PRICE",
      slippageTolerance: 0.5,
    }),
  });

  const quoteData = await quoteRes.json();
  if (!quoteRes.ok) return null;

  const { quote, permitData, routing } = quoteData;
  if (routing !== "CLASSIC") return null;

  let signature: string | undefined;
  if (permitData) {
    signature = await agentWallet.signTypedData(
      permitData.domain, permitData.types, permitData.values
    );
  }

  const swapRes = await fetch(`${API_URL}/swap`, {
    method: "POST",
    headers,
    body: JSON.stringify({ signature, quote, ...(permitData ? { permitData } : {}) }),
  });
  const swapData = await swapRes.json();
  if (!swapRes.ok) return null;

  const txObj = swapData.swap;
  const tx = await agentWallet.sendTransaction({
    to: txObj.to,
    data: txObj.data,
    value: txObj.value ? BigInt(txObj.value) : BigInt(amountWei),
    gasLimit: BigInt(500000),
  });
  await tx.wait();
  return tx.hash;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  CROPSmaster Agent — DEMO MODE (10 protocols)");
  console.log("  Venice: real inference | Scores: on-chain | Swaps: hybrid");
  console.log("═══════════════════════════════════════════════════════\n");
  console.log(`Vault:  ${process.env.VAULT_ADDRESS}`);
  console.log(`Agent:  ${agentWallet.address}\n`);

  const results = [];

  for (const p of PROTOCOLS) {
    console.log(`\n▶ ${p.name} (${p.ticker}) — weight: ${(p.weight * 100).toFixed(1)}%`);

    // Public scores
    const cr = calcCR(p);
    const os = calcOS(p);
    const privacy = calcPrivacy(p);
    let s = calcSecurity(p);

    // Venice private inference (real API call, no retention)
    const { delta, reasoning } = await getVeniceDelta(p.name, p.mockAuditMemo);
    s = Math.min(Math.max(s + delta, 0), 1.0);
    console.log(`  Venice Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(2)} | ${reasoning.slice(0, 80)}...`);

    const crops = 0.3 * cr + 0.25 * os + 0.25 * privacy + 0.2 * s;
    console.log(`  CR=${cr.toFixed(3)} OS=${os.toFixed(3)} P=${privacy.toFixed(3)} S=${s.toFixed(3)} → CROPS=${crops.toFixed(4)}`);

    // Commit score on-chain (real tx for all 10 protocols)
    const scoreTx = await commitScoreOnChain(p.address, crops);
    if (scoreTx) console.log(`  ✅ Score on-chain: ${scoreTx}`);

    results.push({ ...p, cr, os, privacy, s, crops, scoreTx, reasoning, delta });
  }

  // Sort by CROPS score
  results.sort((a, b) => b.crops - a.crops);

  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  CROPS RANKINGS");
  console.log("═══════════════════════════════════════════════════════");
  results.forEach((r, i) => {
    const bar = "█".repeat(Math.round(r.crops * 20));
    console.log(`  ${i + 1}. ${r.name.padEnd(14)} ${bar.padEnd(20)} ${r.crops.toFixed(4)}`);
  });

  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  REBALANCING (hybrid: real swaps where possible)");
  console.log("═══════════════════════════════════════════════════════");

  const ethBalance = await provider.getBalance(agentWallet.address);
  const GAS_RESERVE = ethers.parseEther("0.005");
  const available = ethBalance > GAS_RESERVE ? ethBalance - GAS_RESERVE : 0n;
  console.log(`\n  Available ETH: ${ethers.formatEther(available)}\n`);

  const swapResults: Record<string, any> = {};

  for (const r of results) {
    const ethForProtocol = (available * BigInt(Math.round(r.weight * 10000))) / 10000n;
    const ethFloat = parseFloat(ethers.formatEther(ethForProtocol));

    if (r.sepoliaToken === "WETH" || r.ticker === "RAIL") {
      console.log(`  ${r.name}: ETH base asset — hold`);
      swapResults[r.name] = { type: "hold", note: "Base asset (ETH)" };
      continue;
    }

    console.log(`  ${r.name}: target ${ethers.formatEther(ethForProtocol)} ETH → ${r.ticker}`);

    if (r.sepoliaToken === "USDC") {
      // Attempt real swap via Uniswap API
      const txHash = await realUniswapSwap("USDC", ethForProtocol.toString());
      if (txHash) {
        console.log(`  ✅ Real swap (Uniswap API): ${txHash}`);
        swapResults[r.name] = { type: "real", txHash, token: "USDC" };
      } else {
        const sim = simulateSwap(r.ticker, ethFloat);
        console.log(`  🔵 Simulated: ${(sim as any).note}`);
        swapResults[r.name] = { type: "simulated", ...sim };
      }
    } else {
      // Simulate for tokens not on Sepolia
      const sim = simulateSwap(r.ticker, ethFloat);
      console.log(`  🔵 Simulated: ${(sim as any).note}`);
      swapResults[r.name] = { type: "simulated", ...sim };
    }
  }

  // Save rich output for dashboard
  const output = {
    timestamp: new Date().toISOString(),
    mode: "demo",
    agentWallet: agentWallet.address,
    vaultAddress: process.env.VAULT_ADDRESS,
    scores: results.map(r => ({
      name: r.name,
      ticker: r.ticker,
      address: r.address,
      color: r.color,
      weight: r.weight,
      cr: r.cr,
      os: r.os,
      privacy: r.privacy,
      s: r.s,
      crops: r.crops,
      delta: r.delta,
      veniceReasoning: r.reasoning,
      scoreTx: r.scoreTx,
      swap: swapResults[r.name] ?? null,
    })),
    portfolioFactors: {
      cr: results.reduce((s, r) => s + r.cr * r.weight, 0),
      os: results.reduce((s, r) => s + r.os * r.weight, 0),
      privacy: results.reduce((s, r) => s + r.privacy * r.weight, 0),
      s: results.reduce((s, r) => s + r.s * r.weight, 0),
    },
    top3: results.slice(0, 3).map(r => r.address),
  };

  fs.writeFileSync("crops-scores-demo.json", JSON.stringify(output, null, 2));
  console.log("\n\n✅ Demo results saved to crops-scores-demo.json");
  console.log("   Open dashboard/app.html to visualize all 10 protocols.\n");
}

main().catch(console.error);
