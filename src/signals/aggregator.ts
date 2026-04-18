import { IndicatorReading, CompositeSignal, SignalValue } from '../types'
import { allReadings } from './indicators'
import { OhlcvCandle } from '../types'

// Maps a score in [-1, 1] to a SignalValue using TradingView's published bands.
// >  0.5         → STRONG BUY
// >  0.1  ≤ 0.5  → BUY
// ≥ -0.1 ≤ 0.1   → NEUTRAL
// ≥ -0.5 < -0.1  → SELL
// < -0.5         → STRONG SELL
export function scoreToSignal(score: number): SignalValue {
    if(score >  0.5) return 'STRONG BUY'
    if(score >  0.1) return 'BUY'
    if(score < -0.5) return 'STRONG SELL'
    if(score < -0.1) return 'SELL'
    return 'NEUTRAL'
}

function mean(values: number[]): number {
    if(values.length === 0) return 0
    let total = 0
    for(const value of values)
        total += value
    return total / values.length
}

export function aggregate(readings: IndicatorReading[]): CompositeSignal {
    const maVotes     = readings.filter(reading => reading.group === 'ma').map(reading => reading.vote)
    const oscVotes    = readings.filter(reading => reading.group === 'oscillator').map(reading => reading.vote)
    const exoticVotes = readings.filter(reading => reading.group === 'exotic').map(reading => reading.vote)

    const maRating     = mean(maVotes)
    const oscRating    = mean(oscVotes)
    const exoticRating = exoticVotes.length > 0 ? mean(exoticVotes) : null
    const score = exoticRating === null
        ? (maRating + oscRating) / 2
        : (maRating + oscRating + exoticRating) / 3

    return {
        signal: scoreToSignal(score),
        score,
        maRating,
        oscRating,
        exoticRating,
        readings
    }
}

export function computeComposite(candles: OhlcvCandle[], options: { exotic?: boolean } = {}): CompositeSignal {
    return aggregate(allReadings(candles, options))
}
