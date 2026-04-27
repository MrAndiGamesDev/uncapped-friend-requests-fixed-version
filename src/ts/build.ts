import { rmSync, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

import * as path from 'path';

/**
 * Types
 */
type Task = {
    name: string;
    run: (ctx: Context) => Promise<void>;
    parallel?: boolean;
};

type Context = {
    startTime: number;
};

class BuildSystem {
    private static readonly DIST_PATH = path.resolve(process.cwd(), 'dist');

    private static readonly LOCAL_TSC = path.resolve(
        process.cwd(),
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
    );

    private static readonly USE_NPX = !existsSync(BuildSystem.LOCAL_TSC);

    /**
     * Logger
     */
    private static log = {
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
    private static runProcess(cmd: string, args: string[] = []): Promise<void> {
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
            proc.on('close', (code: number) => {code === 0 ? resolve(): reject(new Error(`${cmd} exited with code ${code}`))});
        });
    }

    /**
     * Measured task runner
     */
    private static async runMeasured(task: Task, ctx: Context) {
        this.log.startInline(task.name);
        const start = performance.now();
        await task.run(ctx);
        this.log.doneInline(task.name, performance.now() - start);
    }

    private static async runTasks(tasks: Task[], ctx: Context): Promise<void> {
        for (const task of tasks) {
            try {
                await this.runMeasured(task, ctx);
            } catch (err: any) {
                this.log.fail(task.name, err);
                throw err;
            }
        }
    }

    /**
     * Tasks
     */
    private static typeCheck: Task = {
        name: 'Type checking',
        run: () => this.USE_NPX ? this.runProcess('npx', ['tsc', '--noEmit']) : this.runProcess(this.LOCAL_TSC, ['--noEmit'])
    };

    private static clean: Task = {
        name: 'Cleaning dist',
        run: async () => {
            if (existsSync(this.DIST_PATH)) {
                rmSync(this.DIST_PATH, { recursive: true, force: true });
            }
            mkdirSync(this.DIST_PATH);
        }
    };

    private static compile: Task = {
        name: 'Compiling',
        run: () => this.USE_NPX ? this.runProcess('npx', ['tsc']) : this.runProcess(this.LOCAL_TSC)
    };

    /**
     * Build entry
     */
    public static async build(): Promise<void> {
        const ctx: Context = { startTime: performance.now() };
        console.log('🚀 Build started');
        try {
            await this.runTasks(
                [this.typeCheck, this.clean, this.compile],
                ctx
            );
            const total = performance.now() - ctx.startTime;
            this.log.summary(total);
        } catch (err: any) {
            this.log.fail('Build failed', err);
            process.exit(1);
        }
    }
}

// Run build
BuildSystem.build();