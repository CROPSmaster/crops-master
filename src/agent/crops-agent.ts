import OpenAI from "openai";
import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

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

// Sepolia token addresses
const TOKENS = {
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  UNI:  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
};

const CHAIN_ID = 11155111; // Ethereum Sepolia

const PROTOCOLS = [
  {
    name: "Uniswap V4",
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    token: TOKENS.USDC,
    tokenSymbol: "USDC",
    github: "Uniswap/v4-core",
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.5 },
    privacyTech: 0.2,
    mockAuditMemo: "Internal audit Q1 2026: no critical findings. 3 medium issues patched. Treasury multisig rotation pending.",
  },
  {
    name: "Aave V3",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    token: TOKENS.USDC, // stablecoin component
    tokenSymbol: "USDC",
    github: "aave/aave-v3-core",
    cr: { cr1: 0.7, cr2: 0.5, cr3: 0.5 },
    privacyTech: 0.2,
    mockAuditMemo: "Confidential disclosure: $500K bad debt absorbed silently in Jan 2026. Security score slightly reduced.",
  },
  {
    name: "Railgun",
    address: "0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405",
    token: TOKENS.WETH, // ETH component (privacy-aligned)
    tokenSymbol: "WETH",
    github: "Railgun-Privacy/railgun-smart-contracts",
    cr: { cr1: 1.0, cr2: 1.0, cr3: 1.0 },
    privacyTech: 1.0,
    mockAuditMemo: "ZK circuit audit complete. No vulnerabilities found. Privacy guarantees verified by third party.",
  },
];

async function getSecurityScore(name: string): Promise<number> {
  const fallback: Record<string, { audits: number; rep: number; lossM: number }> = {
    "Uniswap V4": { audits: 4, rep: 0.9,  lossM: 0   },
    "Aave V3":    { audits: 8, rep: 0.95, lossM: 0.5 },
    "Railgun":    { audits: 3, rep: 0.85, lossM: 0   },
  };
  const d = fallback[name] ?? { audits: 1, rep: 0.7, lossM: 0 };
  const penalty = Math.min(d.lossM / 10, 1.0);
  return Math.min((d.audits * d.rep) / 10, 1.0) * (1 - penalty);
}

async function getGithubScore(repo: string): Promise<{ os: number; privacyPct: number }> {
  const fallback: Record<string, { contributors: number; privacyPct: number }> = {
    "Uniswap/v4-core":                        { contributors: 120, privacyPct: 0.02 },
    "aave/aave-v3-core":                       { contributors: 85,  privacyPct: 0.03 },
    "Railgun-Privacy/railgun-smart-contracts": { contributors: 22,  privacyPct: 0.35 },
  };
  const data = fallback[repo] ?? { contributors: 30, privacyPct: 0.05 };
  return {
    os: Math.min((data.contributors * 0.8) / 500, 1.0),
    privacyPct: data.privacyPct,
  };
}

async function getVeniceDelta(protocol: string, privateMemo: string): Promise<number> {
  try {
    const privateDocument = privateMemo; // never logged
    const result = await venice.chat.completions.create({
      model: "qwen3-4b",
      messages: [
        {
          role: "system",
          content: 'You are a DeFi security analyst. Extract a security score delta [-0.2, +0.2] from the private audit document. Return only raw JSON with no markdown, no backticks, no code blocks. Your response must start with { and end with }. Format: {"delta": number, "reasoning": string}',
        },
        {
          role: "user",
          content: `Private audit memo for ${protocol}:\n${privateDocument}`, // never logged
        },
      ],
    });
    const rawText = result.choices[0].message.content ?? '{"delta": 0}';
    const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const parsed = JSON.parse(text);
    console.log(`  Venice delta: ${parsed.delta} | ${parsed.reasoning}`);
    return parsed.delta ?? 0;
  } catch (e) {
    console.error(`  Venice error (delta=0):`, (e as Error).message);
    return 0;
  }
}

async function commitScoreOnChain(address: string, score: number, name: string) {
  try {
    const scoreOnChain = Math.round(score * 10000);
    const tx = await vault.updateScore(address, scoreOnChain);
    await tx.wait();
    console.log(`  ✅ Score on-chain: ${tx.hash}`);
    return tx.hash;
  } catch (e) {
    console.error(`  ❌ On-chain failed:`, (e as Error).message);
    return null;
  }
}

async function uniswapSwap(tokenOut: string, tokenSymbol: string, amountInWei: string): Promise<string | null> {
  try {
    const API_URL = "https://trade-api.gateway.uniswap.org/v1";
    const headers: Record<string, string> = {
      "x-api-key": process.env.UNISWAP_API_KEY!,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    console.log(`  Requesting Uniswap API quote: ETH -> ${tokenSymbol}...`);
    const quoteRes = await fetch(`${API_URL}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tokenIn: "0x0000000000000000000000000000000000000000",
        tokenOut,
        tokenInChainId: CHAIN_ID,
        tokenOutChainId: CHAIN_ID,
        type: "EXACT_INPUT",
        amount: amountInWei,
        swapper: agentWallet.address,
        routingPreference: "BEST_PRICE",
        slippageTolerance: 0.5,
      }),
    });

    const quoteData = await quoteRes.json();
    if (!quoteRes.ok) {
      console.error(`  Uniswap API error:`, JSON.stringify(quoteData).slice(0, 300));
      return null;
    }

    const { quote, permitData, routing } = quoteData;
    console.log(`  Quote routing=${routing}`);

    let signature: string | undefined;
    if (permitData) {
      signature = await agentWallet.signTypedData(
        permitData.domain,
        permitData.types,
        permitData.values
      );
    }

    let txObj: any;
    if (routing === "CLASSIC" || routing === "WRAP" || routing === "UNWRAP" || routing === "BRIDGE") {
      const swapRes = await fetch(`${API_URL}/swap`, {
        method: "POST",
        headers,
        body: JSON.stringify({ signature, quote, ...(permitData ? { permitData } : {}) }),
      });
      const swapData = await swapRes.json();
      if (!swapRes.ok) {
        console.error(`  Swap API error:`, JSON.stringify(swapData).slice(0, 300));
        return null;
      }
      txObj = swapData.swap;
    } else {
      const orderRes = await fetch(`${API_URL}/order`, {
        method: "POST",
        headers,
        body: JSON.stringify({ signature, quote, ...(permitData ? { permitData } : {}) }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        console.error(`  Order API error:`, JSON.stringify(orderData).slice(0, 300));
        return null;
      }
      console.log(`  UniswapX order: ${orderData.orderId}`);
      return orderData.orderId ?? "uniswapx-order";
    }

    const tx = await agentWallet.sendTransaction({
      to: txObj.to,
      data: txObj.data,
      value: txObj.value ? BigInt(txObj.value) : BigInt(amountInWei),
      gasLimit: txObj.gasLimit ? BigInt(txObj.gasLimit) : BigInt(500000),
    });
    await tx.wait();
    console.log(`  Swap ETH->${tokenSymbol} via Uniswap API: ${tx.hash}`);
    return tx.hash;

  } catch (e) {
    console.error(`  Swap error:`, (e as Error).message);
    return null;
  }
}




// ── Portfolio state ──────────────────────────────────────────────
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function getPortfolioState() {
  const usdc = new ethers.Contract(TOKENS.USDC, USDC_ABI, provider);
  const [ethBalance, usdcBalance, decimals] = await Promise.all([
    provider.getBalance(agentWallet.address),
    usdc.balanceOf(agentWallet.address),
    usdc.decimals(),
  ]);
  return { ethBalance, usdcBalance, decimals };
}

// ── Sell token → ETH via Uniswap API ────────────────────────────
async function uniswapSell(tokenIn: string, tokenSymbol: string, amountIn: bigint): Promise<string | null> {
  try {
    const API_URL = "https://trade-api.gateway.uniswap.org/v1";
    const headers: Record<string, string> = {
      "x-api-key": process.env.UNISWAP_API_KEY!,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    console.log(`  Requesting Uniswap API quote: ${tokenSymbol} -> ETH...`);
    const quoteRes = await fetch(`${API_URL}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tokenIn,
        tokenOut: "0x0000000000000000000000000000000000000000",
        tokenInChainId: CHAIN_ID,
        tokenOutChainId: CHAIN_ID,
        type: "EXACT_INPUT",
        amount: amountIn.toString(),
        swapper: agentWallet.address,
        routingPreference: "BEST_PRICE",
        slippageTolerance: 0.5,
      }),
    });

    const quoteData = await quoteRes.json();
    if (!quoteRes.ok) {
      console.error(`  Sell quote error:`, JSON.stringify(quoteData).slice(0, 200));
      return null;
    }

    const { quote, permitData, routing } = quoteData;
    console.log(`  Sell quote: routing=${routing}`);

    let signature: string | undefined;
    if (permitData) {
      signature = await agentWallet.signTypedData(
        permitData.domain,
        permitData.types,
        permitData.values
      );
    }

    const swapRes = await fetch(`${API_URL}/swap`, {
      method: "POST",
      headers,
      body: JSON.stringify({ signature, quote, ...(permitData ? { permitData } : {}) }),
    });
    const swapData = await swapRes.json();
    if (!swapRes.ok) {
      console.error(`  Sell swap error:`, JSON.stringify(swapData).slice(0, 200));
      return null;
    }

    const txObj = swapData.swap;
    const tx = await agentWallet.sendTransaction({
      to: txObj.to,
      data: txObj.data,
      value: txObj.value ? BigInt(txObj.value) : 0n,
      gasLimit: txObj.gasLimit ? BigInt(txObj.gasLimit) : BigInt(500000),
    });
    await tx.wait();
    console.log(`  Sell ${tokenSymbol}->ETH via Uniswap API: ${tx.hash}`);
    return tx.hash;
  } catch (e) {
    console.error(`  Sell error:`, (e as Error).message);
    return null;
  }
}

// ── True rebalancing ─────────────────────────────────────────────
async function rebalanceVault(results: any[]) {
  console.log("\n=== REBALANCING VAULT via Uniswap ===");

  // Load previous allocations
  let prevAllocations: Record<string, string> = {};
  if (fs.existsSync("crops-scores.json")) {
    try {
      const prev = JSON.parse(fs.readFileSync("crops-scores.json", "utf8"));
      prevAllocations = prev.allocations ?? {};
    } catch {}
  }

  const { ethBalance, usdcBalance, decimals } = await getPortfolioState();
  const GAS_RESERVE = ethers.parseEther("0.005");
  const availableEth = ethBalance > GAS_RESERVE ? ethBalance - GAS_RESERVE : 0n;

  console.log(`  ETH balance: ${ethers.formatEther(ethBalance)} (reserve: 0.005)`);
  console.log(`  USDC balance: ${ethers.formatUnits(usdcBalance, decimals)}`);
  console.log(`  Available for rebalancing: ${ethers.formatEther(availableEth)} ETH\n`);

  const totalScore = results.reduce((sum: number, r: any) => sum + r.crops, 0);
  const DELTA_THRESHOLD = ethers.parseEther("0.0001"); // min swap ~$0.30

  for (const r of results) {
    if (r.tokenSymbol === "WETH") {
      console.log(`  ${r.name}: base asset (ETH) — hold`);
      continue;
    }

    const weight = r.crops / totalScore;
    const targetEth = (availableEth * BigInt(Math.round(weight * 10000))) / 10000n;
    const prevEth = BigInt(prevAllocations[r.name] ?? "0");
    const delta = targetEth - prevEth;

    console.log(`  ${r.name}: target=${ethers.formatEther(targetEth)} ETH, prev=${ethers.formatEther(prevEth)} ETH, delta=${ethers.formatEther(delta)} ETH`);

    if (delta > DELTA_THRESHOLD) {
      console.log(`  → Buying (weight increased): ${ethers.formatEther(delta)} ETH → ${r.tokenSymbol}`);
      r.swapTx = await uniswapSwap(r.token, r.tokenSymbol, delta.toString());
    } else if (delta < -DELTA_THRESHOLD) {
      // Estimate USDC amount to sell proportional to delta
      const sellRatio = Number(-delta) / Number(prevEth);
      const usdcToSell = (usdcBalance * BigInt(Math.round(sellRatio * 10000))) / 10000n;
      console.log(`  -> Selling (weight decreased): ${ethers.formatUnits(usdcToSell, decimals)} ${r.tokenSymbol} -> ETH`);
      r.swapTx = await uniswapSell(r.token, r.tokenSymbol, usdcToSell);
    } else {
      console.log(`  -> Hold (delta below threshold)`);
    }

    r.allocatedEth = targetEth.toString();
  }

  // Save allocations for next run
  const allocations: Record<string, string> = {};
  results.forEach((r: any) => {
    if (r.allocatedEth) allocations[r.name] = r.allocatedEth;
  });

  return allocations;
}

async function main() {
  console.log("CROPSmaster Agent — starting evaluation");
  console.log(`Vault: ${process.env.VAULT_ADDRESS}`);
  console.log(`Agent: ${agentWallet.address}\n`);

  const results = [];

  for (const p of PROTOCOLS) {
    console.log(`\nEvaluating ${p.name}...`);
    const cr = 0.4 * p.cr.cr1 + 0.3 * p.cr.cr2 + 0.3 * p.cr.cr3;
    const { os, privacyPct } = await getGithubScore(p.github);
    const privacy = 0.5 * p.privacyTech + 0.5 * privacyPct;
    let s = await getSecurityScore(p.name);
    const delta = await getVeniceDelta(p.name, p.mockAuditMemo);
    s = Math.min(Math.max(s + delta, 0), 1.0);
    const crops = 0.3 * cr + 0.25 * os + 0.25 * privacy + 0.2 * s;
    console.log(`  CR=${cr.toFixed(3)} OS=${os.toFixed(3)} P=${privacy.toFixed(3)} S=${s.toFixed(3)} → CROPS=${crops.toFixed(4)}`);

    const txHash = await commitScoreOnChain(p.address, crops, p.name);
    results.push({ ...p, cr, os, privacy, s, crops, txHash });
  }

  results.sort((a, b) => b.crops - a.crops);

  console.log("\n=== CROPS Rankings ===");
  results.forEach((r, i) => console.log(`${i + 1}. ${r.name}: ${r.crops.toFixed(4)}`));

  const allocations = await rebalanceVault(results);

  fs.writeFileSync("crops-scores.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    scores: results.map(r => ({
      name: r.name, address: r.address, token: r.tokenSymbol,
      cr: r.cr, os: r.os, privacy: r.privacy, s: r.s, crops: r.crops,
      scoreTx: r.txHash, swapTx: r.swapTx ?? null
    })),
    top3: results.slice(0, 3).map(r => r.address),
    allocations,
  }, null, 2));

  console.log("\nResults saved to crops-scores.json");
}

main().catch(console.error);
