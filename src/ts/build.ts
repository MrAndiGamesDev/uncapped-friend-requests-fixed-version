import { rmSync, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

import * as path from 'path';

const DIST_PATH = path.resolve(
    process.cwd(),
    'dist'
);

const LOCAL_TSC = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
);

const USE_NPX = !existsSync(LOCAL_TSC);

/**
 * Task definition
 */
type Task = {
    name: string;
    run: (ctx: Context) => Promise<void>;
    parallel?: boolean;
};

type Context = {
    startTime: number;
};

/**
 * Logger with timing
 */
const log = {
    startInline: (msg: string) => process.stdout.write(`⏳ ${msg}...`),
    doneInline: (msg: string, time: number) => process.stdout.write(`\r✔ ${msg} (${time.toFixed(0)}ms)\n`),
    fail: (msg: string, err?: unknown) => {
        process.stdout.write('\n');
        console.error(`❌ ${msg}`);
        if (err instanceof Error) console.error(err.message);
    },
    summary: (total: number) => console.log(`\n🎉 Build finished in (${total.toFixed(0)}ms)`)
};

/**
 * Process runner
 */
function runProcess(cmd: string, args: string[] = []): Promise<void> {
    return new Promise((resolve: () => void, reject: (err: Error) => void) => {
        const isWindows = process.platform === 'win32';
        const proc = spawn(
            isWindows ? 'cmd.exe' : cmd, 
            isWindows ? ['/c', cmd, ...args] : args, 
            {
                stdio: 'inherit',
                shell: false
            }
        );
        proc.on('error', reject);
        proc.on('close', (code: number) => {
            code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`));
        });
    });
}

/**
 * Build pipeline
 */
async function runMeasured(task: Task, ctx: Context) {
    log.startInline(task.name);
    const start = performance.now();
    await task.run(ctx);
    log.doneInline(task.name, performance.now() - start);
}

async function runTasks(tasks: Task[], ctx: Context): Promise<void> {
    for (const task of tasks) {
        try {
            await runMeasured(task, ctx);
        } catch (err: any) {
            log.fail(task.name, err);
            throw err;
        }
    }
}

const typeCheck: Task = {
    name: 'Type checking',
    run: () => USE_NPX ? runProcess('npx', ['tsc', '--noEmit']) : runProcess(LOCAL_TSC, ['--noEmit'])
};

const clean: Task = {
    name: 'Cleaning dist',
    run: async () => {
        if (existsSync(DIST_PATH)) rmSync(DIST_PATH, { recursive: true, force: true });
        mkdirSync(DIST_PATH);
    }
};

const compile: Task = {
    name: 'Compiling',
    run: () => USE_NPX ? runProcess('npx', ['tsc']) : runProcess(LOCAL_TSC)
};

/**
 * Build Execution
 */
async function build(): Promise<void> {
    const ctx: Context = { startTime: performance.now() };
    console.log('🚀 Build started');
    try {
        // Run core tasks
        await runTasks([typeCheck, clean, compile], ctx);
        const total = performance.now() - ctx.startTime;
        log.summary(total);
    } catch (err: any) {
        log.fail('Build failed', err);
        process.exit(1);
    }
}

build();