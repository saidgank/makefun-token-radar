# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/saidgank/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/saidgank/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar built from the sealed DefiLlama snapshot of 2026-11-14. The program fits a launch-value model to the snapshot's own tokenized protocols — category market-cap/TVL multiples shrunk toward the global median, a log-log size slope learned from the same peers, and momentum, maturity and breadth factors — then ranks the launch candidates among the 342 protocols that record no token by implied value, the 40-protocol house watchlist included. Records whose value already has a market — wrapped, staked or bridged records of assets that already trade, liquid staking and restaking products, exchange records and versioned duplicate deployments — are tracked separately on the dashboard instead of ranked. Every row carries a five-step farm plan with costs and times, and the offline dashboard shows the board, a factor-by-factor detail view for each protocol, filters and sorts, the tracked-not-ranked list with its reasons, and the already-trading comparables the multiples were learned from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only; nothing is installed and no network is touched. The input is the competition kit's sealed `input/snapshot.json`. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, byte-identically on every run.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kvcj2dy8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
