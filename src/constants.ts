export const validIntervals = new Set(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M'])

// CCXT uses lowercase 'd'/'w'/'M' for timeframes; TradingView-style intervals map as below.
export const intervalToCcxt: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '1D': '1d',
    '1W': '1w',
    '1M': '1M'
}

// Typical spot taker fee per exchange (decimal — e.g. 0.001 = 0.1%)
export const EXCHANGE_FEES: Record<string, number> = {
    binance: 0.001,
    bybit: 0.001,
    okx: 0.001,
    kraken: 0.0026,
    coinbase: 0.004,
    kucoin: 0.001,
    bitfinex: 0.002
}

export const validCommands = new Set(['analyze', 'simulate', 'write'])

// Minimum candles required to compute every indicator in the panel.
// Longest lookback is SMA/EMA 200, so 250 gives a small buffer.
export const OHLCV_LIMIT = 250
