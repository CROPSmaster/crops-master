import * as fs from "fs";

// ── CROPS scores (current, used as historical proxy) ─────────────
const PROTOCOLS = [
  {
    name: "Railgun",
    ticker: "RAIL",
    crops: 0.5685,
    weight: 0.25,
  },
  {
    name: "Uniswap V4",
    ticker: "UNI",
    crops: 0.3865,
    weight: 0.10,
  },
  {
    name: "Aave V3",
    ticker: "AAVE",
    crops: 0.3412,
    weight: 0.10,
  },
];

const ETH_ID = "ETH";

// ── Fetch daily prices from CryptoCompare (free, no key) ─────────
async function fetchWeeklyPrices(
  symbol: string,
  days: number = 365
): Promise<{ timestamp: number; price: number }[]> {
  const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${symbol}&tsym=USD&limit=${days}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CryptoCompare error for ${symbol}: ${res.status}`);
  const data = await res.json() as { Data: { Data: { time: number; close: number }[] } };
  const daily = data.Data.Data;
  // Sample every 7 days to get weekly data points
  return daily
    .filter((_, i) => i % 7 === 0)
    .map((d) => ({ timestamp: d.time * 1000, price: d.close }));
}

// ── Compute CROPS portfolio weights from scores ───────────────────
function computeWeights(): Record<string, number> {
  const totalScore = PROTOCOLS.reduce((s, p) => s + p.crops, 0);
  const weights: Record<string, number> = {};
  PROTOCOLS.forEach((p) => {
    weights[p.ticker] = p.crops / totalScore;
  });
  return weights;
}

// ── Run backtest ─────────────────────────────────────────────────
async function runBacktest() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  CROPSmaster Backtest — CROPS Index vs ETH Hodl");
  console.log("  Period: 52 weeks | Rebalance: every 2 weeks");
  console.log("═══════════════════════════════════════════════════════\n");

  const DAYS = 365;
  const REBALANCE_INTERVAL = 2; // weeks
  const INITIAL_VALUE = 10000; // USD

  // Fetch all prices
  console.log("Fetching historical prices from CoinGecko...");
  const priceMap: Record<string, { timestamp: number; price: number }[]> = {};

  try {
    priceMap[ETH_ID] = await fetchWeeklyPrices(ETH_ID, DAYS);
    console.log(`  ETH: ${priceMap[ETH_ID].length} weekly data points`);

    for (const p of PROTOCOLS) {
      await new Promise((r) => setTimeout(r, 500)); // rate limit
      priceMap[p.ticker] = await fetchWeeklyPrices(p.ticker, DAYS);
      console.log(`  ${p.ticker}: ${priceMap[p.ticker].length} weekly data points`);
    }
  } catch (e) {
    console.error("Price fetch error:", (e as Error).message);
    process.exit(1);
  }

  // Align timestamps to ETH data points
  const ethPrices = priceMap[ETH_ID];
  const weeks = ethPrices.length;

  // CROPS portfolio simulation
  const weights = computeWeights();
  let cropsValue = INITIAL_VALUE;
  let ethValue = INITIAL_VALUE;

  // Track holdings (in token units)
  const holdings: Record<string, number> = {};

  // Initialize at week 0
  const week0Eth = ethPrices[0].price;
  PROTOCOLS.forEach((p) => {
    const alloc = INITIAL_VALUE * weights[p.ticker];
    const price0 = priceMap[p.ticker][0]?.price ?? week0Eth;
    holdings[p.ticker] = alloc / price0;
  });

  const ethHoldings = INITIAL_VALUE / week0Eth;

  const weeklyResults: any[] = [];

  for (let w = 0; w < weeks; w++) {
    const ethTs = ethPrices[w].timestamp;
    const ethPrice = ethPrices[w].price;

    // Get current prices for all tokens (closest timestamp)
    const tokenPrices: Record<string, number> = {};
    PROTOCOLS.forEach((p) => {
      const pts = priceMap[p.ticker];
      const closest = pts.reduce((prev, curr) =>
        Math.abs(curr.timestamp - ethTs) < Math.abs(prev.timestamp - ethTs) ? curr : prev
      );
      tokenPrices[p.ticker] = closest.price;
    });

    // Compute current CROPS portfolio value
    cropsValue = PROTOCOLS.reduce((sum, p) => {
      return sum + holdings[p.ticker] * tokenPrices[p.ticker];
    }, 0);

    // ETH hodl value
    ethValue = ethHoldings * ethPrice;

    // Rebalance every 2 weeks
    if (w > 0 && w % REBALANCE_INTERVAL === 0) {
      PROTOCOLS.forEach((p) => {
        const targetAlloc = cropsValue * weights[p.ticker];
        holdings[p.ticker] = targetAlloc / tokenPrices[p.ticker];
      });
    }

    weeklyResults.push({
      week: w,
      date: new Date(ethTs).toISOString().split("T")[0],
      ethPrice,
      cropsValue: parseFloat(cropsValue.toFixed(2)),
      ethValue: parseFloat(ethValue.toFixed(2)),
      cropsReturn: parseFloat(((cropsValue / INITIAL_VALUE - 1) * 100).toFixed(2)),
      ethReturn: parseFloat(((ethValue / INITIAL_VALUE - 1) * 100).toFixed(2)),
    });
  }

  // ── Compute metrics ─────────────────────────────────────────────
  const finalCrops = weeklyResults[weeks - 1].cropsValue;
  const finalEth = weeklyResults[weeks - 1].ethValue;
  const cropsReturn = (finalCrops / INITIAL_VALUE - 1) * 100;
  const ethReturn = (finalEth / INITIAL_VALUE - 1) * 100;
  const alpha = cropsReturn - ethReturn;

  // Sharpe ratio (weekly returns, risk-free = 0)
  const cropsWeeklyReturns = weeklyResults.slice(1).map((w, i) =>
    (w.cropsValue - weeklyResults[i].cropsValue) / weeklyResults[i].cropsValue
  );
  const meanReturn = cropsWeeklyReturns.reduce((s, r) => s + r, 0) / cropsWeeklyReturns.length;
  const stdReturn = Math.sqrt(
    cropsWeeklyReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / cropsWeeklyReturns.length
  );
  const sharpe = (meanReturn / stdReturn) * Math.sqrt(52); // annualized

  // Max drawdown
  let peak = INITIAL_VALUE;
  let maxDrawdown = 0;
  weeklyResults.forEach((w) => {
    if (w.cropsValue > peak) peak = w.cropsValue;
    const dd = (peak - w.cropsValue) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  });

  // ── Print results ───────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Initial value:    $${INITIAL_VALUE.toLocaleString()}`);
  console.log(`  Final CROPS:      $${finalCrops.toLocaleString("en", { maximumFractionDigits: 0 })}`);
  console.log(`  Final ETH hodl:   $${finalEth.toLocaleString("en", { maximumFractionDigits: 0 })}`);
  console.log(`\n  CROPS return:     ${cropsReturn >= 0 ? "+" : ""}${cropsReturn.toFixed(1)}%`);
  console.log(`  ETH hodl return:  ${ethReturn >= 0 ? "+" : ""}${ethReturn.toFixed(1)}%`);
  console.log(`  Alpha:            ${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}%`);
  console.log(`\n  Sharpe ratio:     ${sharpe.toFixed(2)}`);
  console.log(`  Max drawdown:     -${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`  Rebalances:       ${Math.floor(weeks / REBALANCE_INTERVAL)}`);

  const weights_display = computeWeights();
  console.log("\n  Portfolio weights (CROPS-derived):");
  PROTOCOLS.forEach((p) => {
    const bar = "█".repeat(Math.round(weights_display[p.ticker] * 20));
    console.log(`    ${p.ticker.padEnd(6)} ${bar} ${(weights_display[p.ticker] * 100).toFixed(1)}%`);
  });

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    period: `${weeklyResults[0].date} → ${weeklyResults[weeks - 1].date}`,
    initialValue: INITIAL_VALUE,
    metrics: {
      cropsReturn: parseFloat(cropsReturn.toFixed(2)),
      ethReturn: parseFloat(ethReturn.toFixed(2)),
      alpha: parseFloat(alpha.toFixed(2)),
      sharpe: parseFloat(sharpe.toFixed(2)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      rebalances: Math.floor(weeks / REBALANCE_INTERVAL),
    },
    weights,
    weeklyData: weeklyResults,
  };

  fs.writeFileSync("backtest-results.json", JSON.stringify(output, null, 2));
  console.log("\n✅ Results saved to backtest-results.json");
  console.log("   Open dashboard/app.html to visualize the performance chart.\n");
}

runBacktest().catch(console.error);
