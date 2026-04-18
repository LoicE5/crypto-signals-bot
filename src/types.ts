export type SignalValue = 'BUY' | 'SELL' | 'NEUTRAL' | 'STRONG BUY' | 'STRONG SELL' | 'ERROR'

// -1 = bearish vote, 0 = neutral, +1 = bullish vote
export type IndicatorVote = -1 | 0 | 1

export interface IndicatorReading {
    name: string
    group: 'ma' | 'oscillator'
    value: number | undefined
    vote: IndicatorVote
}

export interface CompositeSignal {
    signal: SignalValue
    score: number
    maRating: number
    oscRating: number
    readings: IndicatorReading[]
}

export interface TickerRow {
    pair: string
    interval: string
    unix_time: number
    price: number | undefined
    signal: SignalValue | undefined
    indicators?: IndicatorReading[]
}

export interface AnalysisResult {
    profit_per_transaction: number[]
    sum: number
    var: string
}

export interface OhlcvCandle {
    unix_time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
}
