import OpenAI from "openai";
import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

// Venice client — private inference, no data retention
const venice = new OpenAI({
  baseURL: "https://api.venice.ai/api/v1",
  apiKey: process.env.VENICE_API_KEY!,
});

// On-chain setup — Base Sepolia
const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const agentWallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);
const VAULT_ABI = [
  "function updateScore(address protocol, uint256 score) external",
  "function cropsScore(address) view returns (uint256)",
];
const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, agentWallet);

const PROTOCOLS = [
  {
    name: "Uniswap V4",
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    github: "Uniswap/v4-core",
    cr: { cr1: 0.7, cr2: 1.0, cr3: 0.5 },
    privacyTech: 0.2,
    mockAuditMemo: "Internal audit Q1 2026: no critical findings. 3 medium issues patched. Treasury multisig rotation pending.",
  },
  {
    name: "Aave V3",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    github: "aave/aave-v3-core",
    cr: { cr1: 0.7, cr2: 0.5, cr3: 0.5 },
    privacyTech: 0.2,
    mockAuditMemo: "Confidential disclosure: $500K bad debt absorbed silently in Jan 2026. Security score slightly reduced.",
  },
  {
    name: "Railgun",
    address: "0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405",
    github: "Railgun-Privacy/railgun-smart-contracts",
    cr: { cr1: 1.0, cr2: 1.0, cr3: 1.0 },
    privacyTech: 1.0,
    mockAuditMemo: "ZK circuit audit complete. No vulnerabilities found. Privacy guarantees verified by third party.",
  },
];

async function getSecurityScore(name: string): Promise<number> {
  const fallback: Record<string, { audits: number; rep: number; lossM: number }> = {
    "Uniswap V4": { audits: 4, rep: 0.9, lossM: 0 },
    "Aave V3":    { audits: 8, rep: 0.95, lossM: 0.5 },
    "Railgun":    { audits: 3, rep: 0.85, lossM: 0 },
  };
  const d = fallback[name] ?? { audits: 1, rep: 0.7, lossM: 0 };
  const penalty = Math.min(d.lossM / 10, 1.0);
  return Math.min((d.audits * d.rep) / 10, 1.0) * (1 - penalty);
}

async function getGithubScore(repo: string): Promise<{ os: number; privacyPct: number }> {
  const fallback: Record<string, { contributors: number; privacyPct: number }> = {
    "Uniswap/v4-core":                         { contributors: 120, privacyPct: 0.02 },
    "aave/aave-v3-core":                        { contributors: 85,  privacyPct: 0.03 },
    "Railgun-Privacy/railgun-smart-contracts":  { contributors: 22,  privacyPct: 0.35 },
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
      model: "venice-uncensored",
      messages: [
        {
          role: "system",
          content: 'You are a DeFi security analyst. Extract a security score delta [-0.2, +0.2] from the private audit document. Return only JSON: {"delta": number, "reasoning": string}',
        },
        {
          role: "user",
          content: `Private audit memo for ${protocol}:\n${privateDocument}`, // never logged
        },
      ],
    });
    const text = result.choices[0].message.content ?? '{"delta": 0}';
    const parsed = JSON.parse(text);
    console.log(`  Venice delta for ${protocol}: ${parsed.delta} | reasoning: ${parsed.reasoning}`);
    return parsed.delta ?? 0;
  } catch (e) {
    console.error(`  Venice error for ${protocol} (using delta=0):`, (e as Error).message);
    return 0;
  }
}

async function commitScoreOnChain(protocolAddress: string, cropsScore: number, name: string) {
  try {
    // Convert 0-1 score to 0-10000 for on-chain storage
    const scoreOnChain = Math.round(cropsScore * 10000);
    console.log(`  Committing ${name} score on-chain: ${scoreOnChain}/10000...`);
    const nonce = await provider.getTransactionCount(agentWallet.address, "latest");
    const tx = await vault.updateScore(protocolAddress, scoreOnChain, { nonce });
    await tx.wait();
    await new Promise(r => setTimeout(r, 3000));
    console.log(`  ✅ ${name} score committed: ${tx.hash}`);
    return tx.hash;
  } catch (e) {
    console.error(`  ❌ On-chain commit failed for ${name}:`, (e as Error).message);
    return null;
  }
}

async function main() {
  console.log("CROPSmaster Agent — starting evaluation");
  console.log(`Vault: ${process.env.VAULT_ADDRESS}`);
  console.log(`Agent wallet: ${agentWallet.address}\n`);

  const results = [];

  for (const p of PROTOCOLS) {
    console.log(`\nEvaluating ${p.name}...`);

    const cr = 0.4 * p.cr.cr1 + 0.3 * p.cr.cr2 + 0.3 * p.cr.cr3;
    const { os, privacyPct } = await getGithubScore(p.github);
    const privacy = 0.5 * p.privacyTech + 0.5 * privacyPct;
    let s = await getSecurityScore(p.name);

    // Venice private inference — document never logged, only delta propagated
    const delta = await getVeniceDelta(p.name, p.mockAuditMemo);
    s = Math.min(Math.max(s + delta, 0), 1.0);

    const crops = 0.3 * cr + 0.25 * os + 0.25 * privacy + 0.2 * s;
    console.log(`  CR=${cr.toFixed(3)} OS=${os.toFixed(3)} P=${privacy.toFixed(3)} S=${s.toFixed(3)} → CROPS=${crops.toFixed(4)}`);

    // Commit score on-chain — public consequence of private cognition
    const txHash = await commitScoreOnChain(p.address, crops, p.name);

    results.push({ name: p.name, address: p.address, cr, os, privacy, s, crops, txHash });
  }

  results.sort((a, b) => b.crops - a.crops);

  console.log("\n=== CROPS Rankings ===");
  results.forEach((r, i) =>
    console.log(`${i + 1}. ${r.name}: ${r.crops.toFixed(4)} | tx: ${r.txHash ?? "failed"}`)
  );

  const top3 = results.slice(0, 3).map(r => r.address);
  console.log("\nProposed vault allocation (top-3):", top3);

  fs.writeFileSync(
    "crops-scores.json",
    JSON.stringify({ timestamp: new Date().toISOString(), scores: results, top3 }, null, 2)
  );
  console.log("\nResults saved to crops-scores.json");
}

main().catch(console.error);
