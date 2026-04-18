# Crypto Signals Bot

> **Alpha** — Missing features, use at your own risk. Contributions welcome.

A Bun + TypeScript CLI that fetches OHLCV candles from Binance (via `ccxt`),
computes **26 technical indicators** locally, and aggregates them into a
composite `STRONG BUY` / `BUY` / `NEUTRAL` / `SELL` / `STRONG SELL` verdict
using TradingView's published "Technical Rating" formula.

Three commands:

- **simulate** — print live price + composite signal + per-indicator breakdown on a loop
- **write** — record price, signal and per-indicator readings over time into a `.ndjson` file (one JSON object per line, always valid, safe through crashes)
- **analyze** — estimate ROI from a previously written `.ndjson` file using the `signal` field:
  - `STRONG BUY` → long ×2
  - `BUY` → long ×1
  - `NEUTRAL` → exit market
  - `SELL` → short ×1
  - `STRONG SELL` → short ×2

An `--inverted` flag reverses all positions.

## Setup

```bash
bun install
```

No browser or headless Chrome required — signals are computed from Binance
OHLCV using the [`technicalindicators`](https://www.npmjs.com/package/technicalindicators)
package.

## Usage

Run without arguments for an interactive CLI with arrow navigation:

```bash
bun start
```

Or pass a command directly. Every command accepts its primary input either as
a **first positional argument** or via the equivalent `--pair` / `--path` flag
(whichever is easier to type).

### simulate

Print price and signal for a pair on a 1-second loop:

```bash
# Positional pair
bun start simulate BTCUSDT
bun start simulate ETHUSDT --interval=4h
bun start simulate SOLUSDT --interval=1D

# Flag form (equivalent)
bun start simulate --pair=BTCUSDT --interval=1h
```

### write

Record price + signal + per-indicator breakdown to a `.ndjson` file in `./output/`:

```bash
# Positional pair
bun start write BTCUSDT --delay=10
bun start write ETHUSDT --interval=15m --delay=30

# Flag form
bun start write --pair=ADAUSDT --interval=1h --delay=300

# Include the full 26-indicator breakdown on every row
bun start write BTCUSDT --interval=1h --delay=10 --indicators
```

### analyze

Estimate profit from a previously written file:

```bash
# Positional path
bun start analyze ./output/BTCUSDT_1m_18-4-2026.ndjson
bun start analyze ./output/BTCUSDT_4h_18-4-2026.ndjson --inverted
bun start analyze ./output/BTCUSDT_1h_18-4-2026.ndjson --fee=0.001 --slippage=0.0005

# Flag form
bun start analyze --path=./output/BTCUSDT_1m_18-4-2026.ndjson --inverted

# Per-trade investment sizing (profits expressed in quote currency)
bun start analyze ./output/BTCUSDT_1m_18-4-2026.ndjson --amount=100
```

#### Estimating slippage

The `--slippage` flag charges a per-leg execution cost on top of `--fee`,
mimicking the price impact of crossing the spread or walking the book. Sensible
starting values for **market orders** of small size on Binance spot:

| Pair tier                         | Suggested `--slippage` (per leg) |
|-----------------------------------|----------------------------------|
| BTC, ETH (top liquidity)          | `0.0001` – `0.0003`              |
| BNB, SOL, XRP (top-20 alts)       | `0.0003` – `0.0008`              |
| Lower-liquidity alts              | `0.001`+                         |
| Order size > $100k or thin books  | scale up — measure your fills    |

## Arguments

| Option | Commands | Description | Allowed values | Default |
|---|---|---|---|---|
| *positional* or `--pair` | simulate, write | Cryptocurrency pair | Any valid Binance pair (e.g. `BTCUSDT`) | required |
| `--interval` | simulate, write | Candle interval | `1m` `5m` `15m` `30m` `1h` `2h` `4h` `1D` `1W` `1M` | `1m` |
| `--delay` | write | Seconds between each fetch and write | Any positive number | `10` |
| `--indicators` | write | Embed the full per-indicator breakdown inside each NDJSON row (bigger files, enables per-indicator post-hoc ROI) | flag or `=true` | `false` |
| *positional* or `--path` | analyze | Path to a `.ndjson` file | Any valid file path | required |
| `--inverted` | analyze | Invert all positions (short on BUY, long on SELL) | flag or `=true` | `false` |
| `--amount` | analyze | Investment per trade in quote currency | Any positive number | omitted |
| `--fee` | analyze | Per-leg taker fee, applied on both legs | Decimal in `[0, 1)` | `0.001` (Binance default) |
| `--slippage` | analyze | Per-leg execution slippage, added to fee | Decimal in `[0, 1)` | `0` |

## How the signal is computed

Each tick:

1. Fetch the last 250 candles for `pair` at `interval` from Binance.
2. Compute **15 moving-average indicators** (SMA & EMA at 10/20/30/50/100/200, Hull MA 9, VWMA 20, Ichimoku).
3. Compute **11 oscillator indicators** (RSI 14, Stochastic 14/3/3, CCI 20, ADX 14 + DI, Awesome Oscillator, Momentum 10, MACD 12/26/9, Stochastic RSI 3/3/14/14, Williams %R 14, Bull Bear Power 13, Ultimate Oscillator 7/14/28).
4. Each indicator emits `+1` (bullish), `0` (neutral), or `−1` (bearish) per TradingView's published rules.
5. Group ratings: `maRating = mean(MA votes)`, `oscRating = mean(osc votes)`, then `score = (maRating + oscRating) / 2` — a number in `[-1, 1]`.
6. Map score to verdict: `>0.5`→STRONG BUY, `>0.1…≤0.5`→BUY, `[-0.1,0.1]`→NEUTRAL, `[-0.5,-0.1)`→SELL, `<-0.5`→STRONG SELL.

The composite signal is always written to NDJSON in `write` mode. Pass
`--indicators` to additionally embed every indicator's value and vote on each
row — useful for later per-indicator ROI analysis at the cost of larger files.

## Development

```bash
bun run dev simulate --pair=BTCUSDT --interval=1m   # hot-reload
bun test                                            # run tests
bun run lint                                        # ESLint
bun run typecheck                                   # tsc --noEmit
bun run build:linux-x64                             # standalone binaries
```

## Docker

**Note**: the Docker image still references the v1.x (Puppeteer/Chromium)
toolchain and needs to be rebuilt for v2.0 — there is no browser dependency
anymore.

```bash
bun run docker:build
bun run docker:up
```

Output `.ndjson` files are persisted to `docker/volumes/output/` on the host.

## Contribute

Clone the repo and open a pull request. Any contribution is appreciated.
