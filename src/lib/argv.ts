export function getValueFromArgv(param: string, argv: string[]): string | null {
    for(const arg of argv) {
        if(arg.startsWith(`${param}=`))
            return arg.slice(param.length + 1)
    }
    return null
}

export function isArgv(param: string, argv: string[]): boolean {
    return argv.includes(param) || argv.includes(`${param}=true`)
}

// Returns the first argument after the command that doesn't start with "--".
// Used as a positional shortcut for --pair (simulate/write) and --path (analyze).
// `commandIndex` is the 0-based index of the command itself in argv (e.g. 2 when
// called as `bun src/index.ts simulate BTCUSDT`).
export function getPositionalArg(argv: string[], commandIndex: number): string | null {
    const candidate = argv.at(commandIndex + 1)
    if(candidate === undefined)
        return null
    if(candidate.startsWith('--'))
        return null
    return candidate
}
