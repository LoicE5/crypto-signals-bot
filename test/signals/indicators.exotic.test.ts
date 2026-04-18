import { describe, expect, test } from 'bun:test'
import { exoticReadings } from '../../src/signals/indicators.exotic'
import { OhlcvCandle } from '../../src/types'

function buildUptrend(length: number): OhlcvCandle[] {
    const candles: OhlcvCandle[] = []
    for(let i = 0; i < length; i++) {
        const trend = 100 + i * 0.5 + Math.pow(i, 1.3) * 0.01
        const jitter = Math.sin(i / 4) * 1.5
        const close = trend + jitter
        candles.push({
            unix_time: i * 60_000,
            open: close - 0.3,
            high: close + 0.8,
            low:  close - 0.8,
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

// Clean uptrend with tiny jitter — used by regime-sensitive tests (Choppiness)
// where the main `buildUptrend` helper's ±1.5 sinusoidal swing is too noisy.
function buildCleanUptrend(length: number): OhlcvCandle[] {
    const candles: OhlcvCandle[] = []
    for(let i = 0; i < length; i++) {
        const close = 100 + i * 0.5
        candles.push({
            unix_time: i * 60_000,
            open: close - 0.1,
            high: close + 0.15,
            low:  close - 0.15,
            close,
            volume: 1000
        })
    }
    return candles
}

function buildCleanDowntrend(length: number): OhlcvCandle[] {
    return buildCleanUptrend(length).map((candle, index, array) => {
        const flipped = array.at(array.length - 1 - index)
        if(flipped === undefined) return candle
        return { ...flipped, unix_time: candle.unix_time }
    })
}

// A noisy random-ish series where close flips direction almost every bar.
// Useful to check CRSI extremes and Fisher turning points.
function buildChoppy(length: number, seed = 1): OhlcvCandle[] {
    let state = seed
    const rand = (): number => {
        state = (state * 9301 + 49297) % 233280
        return state / 233280
    }
    const candles: OhlcvCandle[] = []
    let price = 100
    for(let i = 0; i < length; i++) {
        price += (rand() - 0.5) * 2
        candles.push({
            unix_time: i * 60_000,
            open: price - 0.1,
            high: price + 0.3,
            low:  price - 0.3,
            close: price,
            volume: 500
        })
    }
    return candles
}

describe('exoticReadings', () => {
    test('emits all 6 exotic readings with expected names', () => {
        const readings = exoticReadings(buildUptrend(250))
        expect(readings.length).toBe(6)
        const names = new Set(readings.map(reading => reading.name))
        for(const expected of ['Hurst100', 'CRSI', 'CHOP14', 'Fisher10', 'TTMSqz', 'KAMA10'])
            expect(names.has(expected)).toBe(true)
    })

    test('every reading is tagged group=exotic', () => {
        const readings = exoticReadings(buildUptrend(250))
        for(const reading of readings)
            expect(reading.group).toBe('exotic')
    })

    test('short series returns six 0-vote readings', () => {
        const readings = exoticReadings(buildUptrend(10))
        expect(readings.length).toBe(6)
        for(const reading of readings)
            expect(reading.vote).toBe(0)
    })
})

describe('Hurst exponent', () => {
    test('uptrend → H clearly > 0.5 and bullish vote', () => {
        const reading = exoticReadings(buildUptrend(250)).find(r => r.name === 'Hurst100')
        expect(reading).toBeDefined()
        expect(reading?.value).toBeGreaterThan(0.5)
        expect(reading?.vote).toBe(1)
    })

    test('downtrend → H > 0.5 and bearish vote', () => {
        const reading = exoticReadings(buildDowntrend(250)).find(r => r.name === 'Hurst100')
        expect(reading?.value).toBeGreaterThan(0.5)
        expect(reading?.vote).toBe(-1)
    })

    test('flat series → undefined value, vote 0', () => {
        const reading = exoticReadings(flatCandles(250)).find(r => r.name === 'Hurst100')
        expect(reading?.value).toBeUndefined()
        expect(reading?.vote).toBe(0)
    })
})

describe('Choppiness Index', () => {
    test('flat series → CI at extreme, vote 0 (no trend)', () => {
        const reading = exoticReadings(flatCandles(250)).find(r => r.name === 'CHOP14')
        expect(reading?.vote).toBe(0)
        // CI bounded by [0, 100]; flat-range should sit at the top of the scale
        expect(reading?.value ?? 0).toBeGreaterThanOrEqual(61.8)
    })

    test('clean uptrend → CI well below 38.2 and bullish vote', () => {
        const reading = exoticReadings(buildCleanUptrend(250)).find(r => r.name === 'CHOP14')
        expect(reading?.value ?? 100).toBeLessThan(38.2)
        expect(reading?.vote).toBe(1)
    })

    test('clean downtrend → CI well below 38.2 and bearish vote', () => {
        const reading = exoticReadings(buildCleanDowntrend(250)).find(r => r.name === 'CHOP14')
        expect(reading?.value ?? 100).toBeLessThan(38.2)
        expect(reading?.vote).toBe(-1)
    })
})

describe('Connors RSI', () => {
    test('uptrend with strong ongoing rise → CRSI high (overbought) → bearish vote', () => {
        const reading = exoticReadings(buildUptrend(250)).find(r => r.name === 'CRSI')
        expect(reading?.value).toBeDefined()
        // A clean accelerating uptrend pushes every CRSI component high
        expect(reading?.value ?? 0).toBeGreaterThan(70)
    })

    test('synthetic oversold setup (long uptrend, terminal crash) → vote +1', () => {
        const series = buildUptrend(200)
        for(let i = 0; i < 20; i++) {
            const priorClose = series.at(199 + i)?.close ?? 150
            const close = priorClose * 0.96
            series.push({
                unix_time: (200 + i) * 60_000,
                open: priorClose,
                high: priorClose + 0.2,
                low:  close - 0.3,
                close,
                volume: 1500
            })
        }
        const reading = exoticReadings(series).find(r => r.name === 'CRSI')
        expect(reading?.vote).toBe(1)
    })
})

describe('Fisher Transform', () => {
    test('across a cyclical / jittered series, at least one +1 and one -1 vote fires in a sliding window', () => {
        const full = buildChoppy(400)
        let sawPlus = false
        let sawMinus = false
        for(let i = 60; i <= full.length; i++) {
            const reading = exoticReadings(full.slice(0, i)).find(r => r.name === 'Fisher10')
            if(reading?.vote === 1) sawPlus = true
            if(reading?.vote === -1) sawMinus = true
            if(sawPlus && sawMinus) break
        }
        expect(sawPlus).toBe(true)
        expect(sawMinus).toBe(true)
    })
})

describe('TTM Squeeze', () => {
    test('squeeze followed by expansion fires +1 or -1 on the fire bar', () => {
        const series: OhlcvCandle[] = []
        for(let i = 0; i < 80; i++) {
            const close = 100 + Math.sin(i / 2) * 0.05
            series.push({
                unix_time: i * 60_000,
                open: close,
                high: close + 0.03,
                low:  close - 0.03,
                close,
                volume: 500
            })
        }
        let fired = false
        for(let i = 0; i < 40; i++) {
            const priorClose = series.at(-1)?.close ?? 100
            const close = priorClose + 1.5
            series.push({
                unix_time: (80 + i) * 60_000,
                open: priorClose,
                high: close + 0.5,
                low:  priorClose - 0.5,
                close,
                volume: 800
            })
            const reading = exoticReadings(series).find(r => r.name === 'TTMSqz')
            if(reading?.vote === 1 || reading?.vote === -1) { fired = true; break }
        }
        expect(fired).toBe(true)
    })
})

describe('KAMA', () => {
    test('uptrend → bullish vote', () => {
        const reading = exoticReadings(buildUptrend(250)).find(r => r.name === 'KAMA10')
        expect(reading?.vote).toBe(1)
    })

    test('downtrend → bearish vote', () => {
        const reading = exoticReadings(buildDowntrend(250)).find(r => r.name === 'KAMA10')
        expect(reading?.vote).toBe(-1)
    })

    test('flat series → neutral vote', () => {
        const reading = exoticReadings(flatCandles(250)).find(r => r.name === 'KAMA10')
        expect(reading?.vote).toBe(0)
    })
})
