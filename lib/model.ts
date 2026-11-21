// The launch-radar model: one sealed DefiLlama snapshot in, one ranked board of pre-token
// protocols out. Every number on the board is derived from the snapshot's own figures at run
// time; no protocol name is ever special-cased and no value is written down by hand.
//
// The model, in plain words. A protocol that records no token gets the value its token would
// plausibly carry if it were issued at the protocol's current record:
//
//   implied = tvl x category_multiple x size_factor x momentum_factor
//                 x maturity_factor x breadth_factor
//
// - category_multiple: the median market-cap / TVL ratio of the category's own tokenized
//   protocols in this same snapshot, shrunk toward the global median when a category has
//   few tokenized peers (weight n / (n + 5) on the log scale). The category's quartiles,
//   shrunk the same way, give the low / high ends of the value range.
// - size_factor: the snapshot's own tokenized protocols say how the multiple moves with
//   size: an ordinary least-squares fit of log(mcap / tvl) on log(tvl). The fitted slope
//   (bounded to [-0.5, 0]) is applied around the peers' geometric-mean TVL, and the factor
//   itself is clamped to [0.3, 3] so no protocol is carried away by the line.
// - momentum_factor: the week's TVL change, clamped to [-60%, +120%], scaled by 0.75 and
//   the result clamped to [0.55, 1.9]. A protocol with no reported change is neutral.
// - maturity_factor: 0.75 + 0.5 x min(age_days, 1460) / 1460, the age read from listed_at
//   against the snapshot's as_of day. A long tokenless record earns a premium; a protocol
//   with no listed day is given the snapshot's median age.
// - breadth_factor: 1 + 0.04 for each chain past the first, capped at eight extra chains.
//
// The board ranks the launch candidates among the protocols that record no token (342 in
// this snapshot): the ones that could still issue a token of their own. A no-token record
// whose value already has a market is tracked, not ranked (see trackedReason): a wrapped,
// staked or bridged record of an asset that already trades, a liquid staking or restaking
// product of a tokenized protocol, an exchange record, or a versioned deployment of a
// protocol family. Watchlist members are always ranked, whatever the rules say.
// Tokenized protocols never appear as rows either: they are the comparables the multiples
// are learned from, and the dashboard shows the largest of them separately as the market's
// own reference points.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's learned multiples: the shrunk median and the shrunk quartiles around it. */
export interface CategoryFit {
  category: string | null;
  peers: number;
  multiple: number;
  low_multiple: number;
  high_multiple: number;
}

/** Everything the model learned from the snapshot's tokenized protocols. */
export interface ModelFit {
  peer_count: number;
  global_multiple: number;
  global_low_multiple: number;
  global_high_multiple: number;
  size_slope: number;
  size_center_tvl: number;
  median_age_days: number;
  categories: CategoryFit[];
}

/** The factors one protocol's implied value is built from, kept for the detail view. */
export interface ValueFactors {
  category_multiple: number;
  size_factor: number;
  momentum_factor: number;
  maturity_factor: number;
  breadth_factor: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: ValueFactors;
  farm_steps: string[];
}

/** One row as the dashboard carries it: the board row plus nothing it cannot recompute. */
export interface RadarRow extends BoardRow {}

/** A no-token record the board tracks but does not rank, with the reason in plain words. */
export interface TrackedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A tokenized protocol shown as a market reference: its own traded value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  symbol: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  counts: { scanned: number; pre_token: number; candidates: number; tracked: number; watchlist: number; tokenized: number };
  fit: ModelFit;
  rows: RadarRow[];
  tracked: TrackedRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
/** Peers a category needs before its own median outweighs the global one. */
const SHRINK_K = 5;
/** The maturity factor's horizon: four years of tokenless record earns the full premium. */
const MATURITY_DAYS = 1460;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The exchanges whose name at the head of a record marks it as the exchange's own record. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** A whole word in a name that marks a wrapped or staked product of another asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A version marker at the end of a name: a space, then V2, v3, 2.0 and the like. */
const VERSION_SUFFIX = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

/**
 * Why a protocol that records no token is tracked but not ranked, or null when it is a
 * launch candidate: a protocol that could still issue a token of its own. The rules read
 * only the snapshot's own fields - the record's category and name - and mirror the shape
 * of the house watchlist's own exclusions. A wrapped, staked or bridged record's value is
 * the underlying asset's, which already trades; an exchange record is a balance sheet,
 * not a protocol awaiting a launch; a versioned deployment is one protocol family counted
 * twice. Watchlist membership overrides every rule here: buildBoard ranks those regardless.
 */
export function trackedReason(p: SnapshotProtocol): string | null {
  const c = p.category ?? '';
  if (c === 'Bridge' || c === 'Canonical Bridge') return 'bridged record of an asset that already trades';
  if (c === 'Liquid Staking') return 'liquid staking product of a tokenized protocol';
  if (c === 'Liquid Restaking') return 'liquid restaking product of a tokenized protocol';
  if (c === 'Restaked BTC') return 'restaked BTC product of an asset that already trades';
  if (c === 'CEX') return 'exchange record';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product of an asset that already trades';
  if (VERSION_SUFFIX.test(p.name)) return 'a versioned deployment record, not a protocol of its own';
  const lower = p.name.toLowerCase();
  for (const ex of EXCHANGE_PREFIXES) {
    if (lower.startsWith(ex.toLowerCase())) return 'exchange record';
  }
  return null;
}

/** The median of a sorted, non-empty list. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile of a sorted, non-empty list, linear between closest ranks. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** A category's statistic shrunk toward the global one, on the log scale, weight n / (n + K). */
function shrink(value: number, global: number, n: number): number {
  const w = n / (n + SHRINK_K);
  return Math.exp(w * Math.log(value) + (1 - w) * Math.log(global));
}

/** Learn the model from the snapshot's tokenized protocols: the ones with a recorded cap. */
export function fitModel(snapshot: Snapshot): ModelFit {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalMultiple = median(ratios);
  const globalLow = quantile(ratios, 0.25);
  const globalHigh = quantile(ratios, 0.75);

  // The size effect, learned: log(multiple) on log(tvl), ordinary least squares.
  const xs = peers.map((p) => Math.log(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const rawSlope = den > 0 ? num / den : 0;
  const sizeSlope = Math.min(0, Math.max(-0.5, rawSlope));
  const sizeCenterTvl = Math.exp(mx);

  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const categories: CategoryFit[] = [...byCategory.entries()].map(([key, list]) => {
    const sorted = list.sort((a, b) => a - b);
    const n = sorted.length;
    const multiple = shrink(median(sorted), globalMultiple, n);
    let low = shrink(quantile(sorted, 0.25), globalLow, n);
    let high = shrink(quantile(sorted, 0.75), globalHigh, n);
    low = Math.min(multiple, Math.max(low, multiple * 0.08));
    high = Math.max(multiple, Math.min(high, multiple * 8));
    return { category: key === '' ? null : key, peers: n, multiple, low_multiple: low, high_multiple: high };
  });
  categories.sort((a, b) => {
    if (b.peers !== a.peers) return b.peers - a.peers;
    const an = a.category ?? '';
    const bn = b.category ?? '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  const ages = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = ages.length > 0 ? Math.round(median(ages)) : 365;

  return {
    peer_count: peers.length,
    global_multiple: globalMultiple,
    global_low_multiple: globalLow,
    global_high_multiple: globalHigh,
    size_slope: sizeSlope,
    size_center_tvl: sizeCenterTvl,
    median_age_days: medianAge,
    categories,
  };
}

/** The fit for one category, or the global fit when the category has no tokenized peers. */
function categoryFit(fit: ModelFit, category: string | null): CategoryFit {
  const found = fit.categories.find((c) => c.category === category);
  if (found !== undefined) return found;
  return {
    category,
    peers: 0,
    multiple: fit.global_multiple,
    low_multiple: fit.global_low_multiple,
    high_multiple: fit.global_high_multiple,
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One protocol's implied value, its range and every factor, under the fitted model. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  fit: ModelFit,
): { implied: number; low: number; high: number; factors: ValueFactors; age: number | null } {
  const cat = categoryFit(fit, p.category);
  const size = clamp(Math.exp(fit.size_slope * (Math.log(p.tvl_usd) - Math.log(fit.size_center_tvl))), 0.3, 3);
  const momentum = p.change_7d === null ? 1 : clamp(1 + (clamp(p.change_7d, -60, 120) / 100) * 0.75, 0.55, 1.9);
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? fit.median_age_days;
  const maturity = 0.75 + 0.5 * (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS);
  const breadth = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 8);
  const rest = size * momentum * maturity * breadth;
  const implied = Math.max(1, Math.round(p.tvl_usd * cat.multiple * rest));
  const low = Math.min(implied, Math.max(1, Math.round(p.tvl_usd * cat.low_multiple * rest)));
  const high = Math.max(implied, Math.round(p.tvl_usd * cat.high_multiple * rest));
  return {
    implied,
    low,
    high,
    age,
    factors: {
      category_multiple: round4(cat.multiple),
      size_factor: round4(size),
      momentum_factor: round4(momentum),
      maturity_factor: round4(maturity),
      breadth_factor: round4(breadth),
    },
  };
}

// ------------------------------------------------------------------ farm plans

/** A small deterministic hash of a slug, so each protocol's wording varies on its own name. */
function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pick one of `options` by seed, deterministically; the seed is taken modulo the count, sign-safe. */
function pick<T>(options: readonly T[], seed: number): T {
  const i = ((seed % options.length) + options.length) % options.length;
  return options[i]!;
}

/** What a transaction costs on a chain, in the plain figures a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$5-$25 in ETH gas';
  if (c === 'solana') return 'under $0.05 in SOL fees';
  if (c === 'bitcoin') return '$1-$8 in BTC miner fees';
  if (c === 'binance') return '$0.10-$0.60 in BNB gas';
  if (c === 'avalanche') return '$0.10-$1.00 in AVAX gas';
  if (['arbitrum', 'base', 'optimism', 'polygon', 'linea', 'scroll', 'mantle', 'blast', 'mode', 'zksync era', 'taiko', 'starknet'].includes(c)) {
    return '$0.10-$1.50 in gas';
  }
  return 'roughly $0.10-$2 in native-token gas';
}

/** The capital band and first-test size a protocol's TVL tier suggests. */
function capitalFor(tvl: number): { band: string; test: number } {
  if (tvl >= 1_000_000_000) return { band: '$1,000-$5,000', test: 250 };
  if (tvl >= 250_000_000) return { band: '$500-$2,500', test: 150 };
  if (tvl >= 50_000_000) return { band: '$250-$1,000', test: 100 };
  if (tvl >= 10_000_000) return { band: '$100-$500', test: 50 };
  return { band: '$50-$250', test: 25 };
}

/** The farm families: how a category is actually worked, in verbs a farmer can follow. */
interface Playbook {
  /** The core position, with {name}, {chain} and {cap} filled in. */
  core: string;
  /** The second surface: another product of the same house. */
  second: string;
  /** Minutes the weekly round of this family takes. */
  weekly_minutes: number;
}

function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('collateral')) {
    return {
      core: 'Supply USDC to {name} on {chain}, then borrow a small amount against it and re-supply the borrow, keeping the health factor above 2.0; work {cap} in total.',
      second: 'Open a second market on {name} - a different collateral or the same market on another chain it serves - so the wallet shows more than one kind of use.',
      weekly_minutes: 20,
    };
  }
  if (c.includes('dex')) {
    return {
      core: 'Add {cap} of liquidity to {name}\'s busiest stable or blue-chip pool on {chain} and make two or three small swaps a week through the same interface.',
      second: 'Trade a second pair on {name} and, if it runs a points or volume program, keep the swaps spread across days rather than in one burst.',
      weekly_minutes: 30,
    };
  }
  if (c.includes('cdp') || c.includes('stable') || c.includes('algo-stables')) {
    return {
      core: 'Open a collateral position on {name} on {chain}: deposit ETH or a liquid staking token and mint about {cap} of its stablecoin against it, keeping the ratio well above liquidation.',
      second: 'Hold or deploy the minted stablecoin inside {name}\'s own ecosystem - its stability pool, savings rate or partner pool - rather than selling it at once.',
      weekly_minutes: 20,
    };
  }
  if (c.includes('deriv') || c.includes('option') || c.includes('synthetic') || c.includes('interest rate')) {
    return {
      core: 'Deposit {cap} of USDC margin on {name} on {chain} and run one small hedged trade at a time - a long and a short of near-equal size - so the account books volume without a directional bet.',
      second: 'Use a second instrument on {name} (another market, an options vault or its vault share) so the wallet is not a one-trade visitor.',
      weekly_minutes: 45,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: 'Fund {cap} on {name} and take small positions in three or four liquid markets on {chain}, favouring markets that settle within the month.',
      second: 'Provide liquidity or take the other side of a thin market on {name} once the first positions are open, so the account both trades and makes.',
      weekly_minutes: 30,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: 'Subscribe {cap} to one of {name}\'s tokenized real-world assets on {chain}, completing any allowlist or KYC step the asset asks for, and hold the position.',
      second: 'Add a second asset or a second tranche on {name} once the first settles, so the wallet holds more than the minimum ticket.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('restak') || c.includes('restaked')) {
    return {
      core: 'Restake {cap} of a liquid staking token (or BTC, where {name} takes it) on {chain} and delegate to one of its operators; keep the receipt token in the same wallet.',
      second: 'Spread a smaller second deposit across another operator or asset on {name}, which is the behaviour restaking points programs usually weight.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('staking') || c.includes('staking pool')) {
    return {
      core: 'Stake {cap} of the chain\'s native asset through {name} on {chain} and hold the liquid receipt; the stake itself is the qualifying position.',
      second: 'Put the receipt token to work in one of {name}\'s listed partners (a lending market or pool) so the position earns in two places at once.',
      weekly_minutes: 10,
    };
  }
  if (c.includes('bridge')) {
    return {
      core: 'Bridge {cap} of USDC or ETH through {name} to {chain}, then use the bridged funds in one app at the far end instead of bridging straight back.',
      second: 'Bridge a second asset or a second route through {name} on a later day; route variety and dwell time at the far end are what usually count.',
      weekly_minutes: 20,
    };
  }
  if (c.includes('basis')) {
    return {
      core: 'Deposit {cap} of USDC into {name}\'s basis-trade vault on {chain}; the vault runs the hedge, the deposit is the position.',
      second: 'If {name} offers more than one vault or tenor, split a smaller second deposit into another one rather than topping up the first.',
      weekly_minutes: 10,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager') || c.includes('indexes') || c.includes('index')) {
    return {
      core: 'Deposit {cap} into one of {name}\'s curated vaults on {chain} and keep the vault shares; curated-vault deposits are the activity these houses can see.',
      second: 'Hold a second vault on {name} with a different curator or strategy, so the wallet is diversified the way the product intends.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return {
      core: 'Deposit {cap} into {name}\'s main yield vault or farm on {chain} and leave the position to compound; claim and restake rewards rather than selling them.',
      second: 'Open a second vault or pool on {name} - a different asset or strategy - once the first has run for a week.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('cex') || c.includes('cedefi')) {
    return {
      core: 'Open an account with {name}, complete its verification, deposit {cap} and make a few spot trades on {chain}-listed pairs; keep a small balance on the venue.',
      second: 'Use a second product of the house - earn, convert or its card - so the account reads as a customer, not a signup.',
      weekly_minutes: 20,
    };
  }
  if (c.includes('chain')) {
    return {
      core: 'Bridge {cap} to {chain} and become a user of the chain itself: hold its native token, make swaps and use two or three of its native apps through {name}\'s ecosystem.',
      second: 'Keep a recurring weekly transaction on the chain - a swap, a mint or a vote - so the wallet\'s history is a habit, not a single visit.',
      weekly_minutes: 25,
    };
  }
  if (c.includes('nft') || c.includes('otc')) {
    return {
      core: 'Fund {cap} on {chain} and make two or three real trades on {name} - buy one listed item and list one of your own - rather than washing the same asset.',
      second: 'Use a second feature of {name} (an offer, a bundle or its OTC desk flow) so the account shows range.',
      weekly_minutes: 25,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: 'Buy about {cap} of cover from {name} on {chain} for a position you actually hold elsewhere, and keep the policy to term.',
      second: 'If {name} takes capital providers, place a small second sum in its capital pool once the policy is live.',
      weekly_minutes: 10,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      core: 'Sign up with {name}, deposit {cap} and route two or three real payments or card spends a month through it on {chain}.',
      second: 'Hold a balance between spends and use one extra feature (a virtual card, a transfer or a bill payment) so the account is active, not parked.',
      weekly_minutes: 10,
    };
  }
  if (c.includes('launchpad')) {
    return {
      core: 'Register on {name}, complete its tier or staking step if it has one, and take a small {cap} allocation in one live launch on {chain}.',
      second: 'Take part in a second launch or its refund/claim flow, and keep the vested tokens rather than dumping the first unlock.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('privacy')) {
    return {
      core: 'Deposit {cap} into {name}\'s shielded pool on {chain} and make one private transfer to a second wallet you control; keep amounts ordinary.',
      second: 'Use {name} a second time weeks later rather than in one burst - steady, unremarkable use is the pattern privacy tools reward.',
      weekly_minutes: 15,
    };
  }
  if (c.includes('locker')) {
    return {
      core: 'Lock a small position (about {cap}) through {name} on {chain} for a mid-length term; the lock itself is the recorded activity.',
      second: 'Extend or add a second smaller lock later instead of one maximum lock on day one.',
      weekly_minutes: 10,
    };
  }
  if (c.includes('ai')) {
    return {
      core: 'Create an account or agent on {name}, fund {cap} of credits or stake on {chain}, and run real tasks through it weekly.',
      second: 'Use a second capability of {name} (a second agent type, its API or its marketplace) so the usage is not one-dimensional.',
      weekly_minutes: 20,
    };
  }
  if (c.includes('btc') || c.includes('bitcoin')) {
    return {
      core: 'Deposit about {cap} of BTC (or its wrapped form on {chain}) into {name} and hold the position; BTC deposits are the activity it records.',
      second: 'Add a second smaller deposit on a later date, and use any yield or points view {name} offers to confirm both are counted.',
      weekly_minutes: 10,
    };
  }
  return {
    core: 'Deposit {cap} of USDC into {name}\'s main product on {chain} and keep the position open; a real, held position is what any future snapshot of users will see.',
    second: 'Use a second feature of {name} - another vault, market or chain it serves - so the wallet shows more than a single deposit.',
    weekly_minutes: 20,
  };
}

/** Fill a playbook sentence with the protocol's own figures. */
function fill(template: string, p: SnapshotProtocol, chain: string, cap: string): string {
  return template.split('{name}').join(p.name).split('{chain}').join(chain).split('{cap}').join(cap);
}

const clampStep = (s: string): string => {
  const t = s.trim();
  if (t.length > 600) return `${t.slice(0, 596)}...`;
  if (t.length < 20) return `${t} Keep the position open and check the protocol's own page weekly.`;
  return t;
};

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time, derived from the
 * protocol's own record - its category's playbook, its first chain's gas, its TVL tier's
 * capital band, its week's momentum and its age. Wording varies deterministically by slug.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const seed = hashSlug(p.slug);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasFor(chain);
  const { band, test } = capitalFor(p.tvl_usd);
  const book = playbookFor(p.category);
  const cat = p.category ?? 'DeFi';

  const openers = [
    `Set up a fresh wallet, fund it on ${chain}, and make a first test move of about $${test} inside ${p.name} before committing real size.`,
    `Start with a wallet you use only for farming, put funds on ${chain}, and test ${p.name} with about $${test} first.`,
    `Use a dedicated wallet, bridge or deposit about $${test} on ${chain}, and run one small transaction through ${p.name} to learn its interface.`,
  ];
  const step1 = `${pick(openers, seed)} Cost: ${gas} for the first transactions. Time: about 10 minutes.`;

  const step2 = `${fill(book.core, p, chain, band)} Cost: the ${band} position plus ${gas} to open it. Time: about 15 minutes to set up, then roughly ${book.weekly_minutes} minutes a week.`;

  const step3 = secondChain !== null
    ? `Repeat a smaller version of the position on ${secondChain}, ${p.name}'s second chain: multi-chain use is the clearest signal a wallet is a real user. Cost: about a quarter of the main position plus ${gasFor(secondChain)}. Time: about 10 minutes.`
    : `${fill(book.second, p, chain, band)} Cost: a smaller second position, about a quarter of the main one, plus ${gas}. Time: about 10 minutes.`;

  const step4 = pick(
    [
      `Check ${p.name}'s points, rewards or governance page every week and take part in any vote it runs; an unclaimed, inactive wallet is the first thing a distribution screens out. Cost: no fee to check, $0-$2 if a vote is onchain. Time: about 10 minutes a week.`,
      `Once a week, open ${p.name}'s app and confirm the position still shows, rewards still accrue and no migration or deadline has been announced. Cost: nothing to look; ${gas} only if you act. Time: about 10 minutes a week.`,
    ],
    seed >> 3,
  );

  let step5: string;
  if (p.change_7d !== null && p.change_7d <= -15) {
    step5 = `Caution first: ${p.name}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the week to this snapshot, so halve the position size, prefer the most liquid ${cat} market it offers, and re-check weekly. If a token is announced, claim from the protocol's own page only. Cost: nothing extra. Time: about 5 minutes a week.`;
  } else if (p.change_7d !== null && p.change_7d >= 40) {
    step5 = `Momentum is strong - TVL rose ${p.change_7d.toFixed(1)}% in the week to this snapshot - so keep the position steady rather than chasing size, and watch ${p.name}'s own announcements for a token or points launch. Claim only from the link the protocol itself publishes. Cost: nothing extra. Time: about 5 minutes a week.`;
  } else if (age !== null && age >= 730) {
    step5 = `${p.name} has run ${Math.floor(age / 365) >= 2 ? `${Math.floor(age / 365)} years` : 'over a year'} with no token on record, so the endgame to prepare for is a retroactive launch: keep the position open, keep records of dates and amounts, and claim from the protocol's own page if it announces one. Cost: nothing extra. Time: about 5 minutes a month.`;
  } else {
    step5 = `Stay liquid enough to act on launch day: keep the position open, note its start date and amounts in a farm log, and watch ${p.name}'s own announcements for a token, points or snapshot post. Claim only from the link the protocol itself publishes. Cost: nothing extra. Time: about 5 minutes a month.`;
  }

  return [step1, step2, step3, step4, step5].map(clampStep);
}

// ------------------------------------------------------------------ the board

/** The protocols the board ranks, strongest first, with ranks 1..n and strict order. */
export function buildBoard(snapshot: Snapshot, fit: ModelFit): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isPreToken(p) && (watch.has(p.slug) || trackedReason(p) === null))
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, fit);
      return { p, ...v };
    });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const rows: BoardRow[] = [];
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    let implied = s.implied;
    if (implied >= prev) implied = prev - 1;
    prev = implied;
    rows.push({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      watchlist: watch.has(s.p.slug),
      implied_value_usd: implied,
      implied_low_usd: Math.min(s.low, implied),
      implied_high_usd: Math.max(s.high, implied),
      model: s.factors,
      farm_steps: farmSteps(s.p, s.age),
    });
  }
  return rows;
}

/** The no-token records the board tracks but does not rank, largest TVL first, with reasons. */
export function trackedRows(snapshot: Snapshot): TrackedRow[] {
  const watch = new Set(snapshot.watchlist);
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !watch.has(p.slug))
    .map((p) => ({ p, reason: trackedReason(p) }))
    .filter((x): x is { p: SnapshotProtocol; reason: string } => x.reason !== null)
    .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .map(({ p, reason }) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason }));
}

/** The largest tokenized protocols, by market cap: the market's own reference points. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, 18)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      symbol: p.symbol,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** Everything the entry hands in: the board and the dashboard's data, from one fit. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const tracked = trackedRows(snapshot);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    counts: {
      scanned: snapshot.protocols.length,
      pre_token: preToken,
      candidates: board.length,
      tracked: tracked.length,
      watchlist: snapshot.watchlist.length,
      tokenized: snapshot.protocols.length - preToken,
    },
    fit,
    rows: board,
    tracked,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!known.has(r.slug)) return `slug ${r.slug} is not one of the snapshot's protocols`;
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} trimmed characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
