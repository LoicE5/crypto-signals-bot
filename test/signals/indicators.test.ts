import { describe, expect, test } from 'bun:test'
import { movingAverageReadings, oscillatorReadings, allReadings } from '../../src/signals/indicators'
import { aggregate } from '../../src/signals/aggregator'
import { OhlcvCandle } from '../../src/types'

// Accelerating uptrend with sinusoidal jitter — produces realistic divergence
// between short/long MAs and keeps MACD line above its signal most of the time.
function buildUptrend(length: number): OhlcvCandle[] {
    const candles: OhlcvCandle[] = []
    for(let i = 0; i < length; i++) {
        const trend = 100 + i * 0.5 + Math.pow(i, 1.3) * 0.01
        const jitter = Math.sin(i / 4) * 1.5
        const close = trend + jitter
        const high = close + 0.8
        const low  = close - 0.8
        candles.push({
            unix_time: i * 60_000,
            open: close - 0.3,
            high,
            low,
            close,
            volume: 1000 + (i % 50)
        })
    }
    return candles
}

function buildDowntrend(length: number): OhlcvCandle[] {
    return buildUptrend(length).map((candle, index, array) => {
        const flipped = array.at(array.length - 1 - index)
        if(flipped === undefined) return candle
        return { ...flipped, unix_time: candle.unix_time }
    })
}

function flatCandles(length: number, price = 100): OhlcvCandle[] {
    return Array.from({ length }, (_, i) => ({
        unix_time: i * 60_000,
        open: price, high: price + 0.01, low: price - 0.01, close: price, volume: 100
    }))
}

describe('movingAverageReadings', () => {
    test('emits all 15 MA readings on a long series', () => {
        const readings = movingAverageReadings(buildUptrend(250))
        expect(readings.length).toBe(15)
        const names = new Set(readings.map(reading => reading.name))
        for(const expected of ['SMA10', 'SMA200', 'EMA10', 'EMA200', 'HMA9', 'VWMA20', 'Ichimoku'])
            expect(names.has(expected)).toBe(true)
    })

    test('on an uptrend most MAs vote bullish', () => {
        const readings = movingAverageReadings(buildUptrend(250))
        const bullish = readings.filter(reading => reading.vote === 1).length
        expect(bullish).toBeGreaterThanOrEqual(10) // 10 of 15 is already overwhelming
    })

    test('on a downtrend most MAs vote bearish', () => {
        const readings = movingAverageReadings(buildDowntrend(250))
        const bearish = readings.filter(reading => reading.vote === -1).length
        expect(bearish).toBeGreaterThanOrEqual(10)
    })

    test('short series returns 0-votes with undefined values', () => {
        const readings = movingAverageReadings(buildUptrend(5))
        for(const reading of readings)
            expect(reading.vote).toBe(0)
    })
})

describe('oscillatorReadings', () => {
    test('emits all 11 oscillator readings', () => {
        const readings = oscillatorReadings(buildUptrend(250))
        expect(readings.length).toBe(11)
        const expected = ['RSI14', 'MACD', 'ADX14', 'Stoch', 'StochRSI', 'Williams%R', 'CCI20', 'AO', 'MOM10', 'BBP13', 'UO']
        const names = new Set(readings.map(reading => reading.name))
        for(const name of expected)
            expect(names.has(name)).toBe(true)
    })

    test('short series returns all 0 votes', () => {
        for(const reading of oscillatorReadings(buildUptrend(5)))
            expect(reading.vote).toBe(0)
    })

    test('flat series gives ADX below 20 → 0 vote (no trend strength)', () => {
        const adx = oscillatorReadings(flatCandles(250)).find(reading => reading.name === 'ADX14')
        expect(adx?.vote).toBe(0)
    })

    test('ADX + DI on a clear uptrend → bullish vote (+DI dominates)', () => {
        const adx = oscillatorReadings(buildUptrend(250)).find(reading => reading.name === 'ADX14')
        expect(adx?.vote).toBe(1)
    })
})

describe('allReadings + aggregate', () => {
    test('returns 26 readings total', () => {
        expect(allReadings(buildUptrend(250)).length).toBe(26)
    })

    test('clear uptrend → positive composite score', () => {
        const result = aggregate(allReadings(buildUptrend(250)))
        expect(result.score).toBeGreaterThan(0)
        expect(result.signal === 'BUY' || result.signal === 'STRONG BUY').toBe(true)
    })

    test('clear downtrend → negative composite score', () => {
        const result = aggregate(allReadings(buildDowntrend(250)))
        expect(result.score).toBeLessThan(0)
        expect(result.signal === 'SELL' || result.signal === 'STRONG SELL').toBe(true)
    })

    test('flat series → neutral composite score', () => {
        const result = aggregate(allReadings(flatCandles(250)))
        expect(Math.abs(result.score)).toBeLessThanOrEqual(0.1)
        expect(result.signal).toBe('NEUTRAL')
    })
})
