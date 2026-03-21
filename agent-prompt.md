Create a TypeScript file `src/agent/crops-agent.ts` that does the following:

## CROPS Score Calculator Agent

### Protocols to evaluate (hardcoded for PoC):
- Uniswap V4: 0x1F98431c8aD98523631AE4a59f267346ea31F984
- Aave V3: 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
- Railgun: 0xd47a3b1C8823C94e9bf67c7Bd8df5E0c4cCBcD5

### For each protocol, calculate CROPS score:

**CR (Censorship Resistance) = 0.4*CR1 + 0.3*CR2 + 0.3*CR3**
- CR1: admin key risk (0=EOA, 0.3=multisig no lock, 0.7=multisig+timelock, 1=DAO+timelock>7d)
- CR2: permissionless access (0=KYC, 0.5=partial, 1=full permissionless)
- CR3: exit guarantees (0=none, 0.5=multisig emergency, 1=trustless withdraw)

**OS (Open Source) = min((unique_contributors * mean_pct_OS) / 500, 1.0)**
- Fetch from GitHub GraphQL API top-20 contributors

**P (Privacy) = 0.5 * Tech_Level + 0.5 * Privacy_Team_Pct**
- Tech_Level: 0.2=no privacy, 0.5=FHE/MPC, 0.7=ZK single, 1.0=ZK+encrypted balances
- Privacy_Team_Pct: % of top-20 contributors who contributed to Aztec/Zcash/Semaphore/Noir

**S (Security) = min((Audits * Avg_Rep) / 10, 1.0) * (1 - exploit_penalty)**
- Fetch from DefiLlama /audits and /hacks endpoints
- exploit_penalty = min(Total_Loss_USD_M / 10, 1.0)

**CROPS = 0.3*CR + 0.25*OS + 0.25*P + 0.2*S**

### Venice API — Private Inference step:
For each protocol, load a mock "private audit memo" (hardcoded string) and send it to Venice API:
- baseURL: https://api.venice.ai/api/v1
- model: "venice-uncensored" 
- System prompt: "You are a DeFi security analyst. Extract a security score delta [-0.2, +0.2] from the private audit document. Return only JSON: {delta: number, reasoning: string}"
- The private document is NEVER logged — only the delta is saved // never logged
- Apply delta to S score

### Output:
- Print ranked protocols with CROPS scores
- Save results to `crops-scores.json`
- Propose top-3 for vault rebalancing

### Tech:
- Use node-fetch for HTTP calls
- Use dotenv for VENICE_API_KEY and GITHUB_TOKEN env vars
- Use static JSON fallback if APIs fail
- Add // never logged comment where private document is used
