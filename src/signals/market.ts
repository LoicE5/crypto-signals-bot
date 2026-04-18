import ccxt, { Exchange } from "ccxt"
import { OhlcvCandle } from "../types"
import { intervalToCcxt, OHLCV_LIMIT } from "../constants"

export const defaultExchange: Exchange = new ccxt.binance()

export async function getLastPrice(pair: string, exchange: Exchange = defaultExchange): Promise<number | undefined> {
    const info = await exchange.fetchTicker(pair)
    return info.last
}

export async function fetchOhlcv(
    pair: string,
    interval: string,
    limit: number = OHLCV_LIMIT,
    exchange: Exchange = defaultExchange
): Promise<OhlcvCandle[]> {
    const timeframe = intervalToCcxt[interval]
    if(timeframe === undefined)
        throw new Error(`Unsupported interval "${interval}" for CCXT`)

    const raw = await exchange.fetchOHLCV(pair, timeframe, undefined, limit)
    return raw.map((row): OhlcvCandle => ({
        unix_time: Number(row.at(0)),
        open:      Number(row.at(1)),
        high:      Number(row.at(2)),
        low:       Number(row.at(3)),
        close:     Number(row.at(4)),
        volume:    Number(row.at(5))
    }))
}

export async function isPairValid(pair: string, exchange: Exchange = defaultExchange): Promise<boolean> {
    try {
        await getLastPrice(pair, exchange)
        return true
    } catch(pairError: unknown) {
        console.error(`Pair validation failed for "${pair}":`, pairError)
        return false
    }
}
