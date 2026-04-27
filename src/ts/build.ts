import { rmSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';

const DIST_PATH = path.resolve(process.cwd(), 'dist');

function runBuild(): void {
    console.log('🚀 Starting build process...');

    try {
        // PHASE 1: Full Type Check (Respecting tsconfig.json)
        // By not passing --ignoreConfig, we ensure @types/chrome and other settings are loaded.
        // We use --noEmit to only check for errors.
        console.log('🔍 Checking for type errors (validating environment)...');
        execSync('npx tsc --noEmit', { stdio: 'inherit' });
        console.log('✅ Type check passed.');
        
        // PHASE 2: Clean
        if (existsSync(DIST_PATH)) {
            console.log(`🧹 Cleaning: ${DIST_PATH}`);
            rmSync(DIST_PATH, { recursive: true, force: true });
        }

        mkdirSync(DIST_PATH);

        // PHASE 3: Compile
        console.log('📦 Compiling project to /dist...');
        execSync('npx tsc', { stdio: 'inherit' });
        console.log('✅ Build completed successfully!');
    } catch (error) {
        // This will now catch genuine type errors in your code, 
        // as well as any configuration issues.
        console.error(`\n❌ Build process failed due to errors.`);
        process.exit(1);
    }
}

runBuild();