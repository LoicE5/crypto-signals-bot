import { getValueFromArgv, isArgv, getPositionalArg } from '../lib/argv'
import { analyseNdjson } from '../analysis/roi'

export async function runAnalyze(argv: string[], commandIndex: number): Promise<void> {
    const flagPath = getValueFromArgv('--path', argv)
    const positional = getPositionalArg(argv, commandIndex)
    if(flagPath !== null && positional !== null)
        console.warn(`Both positional "${positional}" and --path="${flagPath}" supplied; using --path.`)
    const path = flagPath ?? positional

    const inverted = isArgv('--inverted', argv)
    const amountStr = getValueFromArgv('--amount', argv)
    const amount = amountStr !== null ? Number(amountStr) : undefined
    const feeStr = getValueFromArgv('--fee', argv)
    const fee = feeStr !== null ? Number(feeStr) : undefined
    const slippageStr = getValueFromArgv('--slippage', argv)
    const slippage = slippageStr !== null ? Number(slippageStr) : 0

    if(!path) {
        console.error('--path (or positional first argument) is required for the analyze command')
        process.exit(1)
    }

    if(amount !== undefined && (isNaN(amount) || amount <= 0)) {
        console.error('--amount must be a positive number')
        process.exit(1)
    }

    if(fee !== undefined && (isNaN(fee) || fee < 0 || fee >= 1)) {
        console.error('--fee must be a decimal in [0, 1) — e.g. 0.001 for 0.1% per leg')
        process.exit(1)
    }

    if(isNaN(slippage) || slippage < 0 || slippage >= 1) {
        console.error('--slippage must be a decimal in [0, 1) — e.g. 0.0005 for 5 bps per leg')
        process.exit(1)
    }

    try {
        console.info(await analyseNdjson(path, inverted, fee, amount, slippage))
    } catch(analyzeError: unknown) {
        console.error(`Failed to analyze file at "${path}": ${analyzeError}`)
        process.exit(1)
    }

    process.exit(0)
}
