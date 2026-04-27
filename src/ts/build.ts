import { rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';

// Define the root and target directories
const DIST_PATH = path.resolve(process.cwd(), 'dist');

/**
 * Executes the build process:
 * 1. Cleans the /dist directory.
 * 2. Compiles TypeScript via local tsc.
 */
function runBuild(): void {
    console.log('🚀 Starting build process...');

    try {
        // 1. Clean up
        if (existsSync(DIST_PATH)) {
            console.log(`🧹 Cleaning: ${DIST_PATH}`);
            rmSync(DIST_PATH, { recursive: true, force: true });
        }

        // 2. Compile TypeScript
        console.log('📦 Compiling TypeScript...');
        
        // execSync will throw an error automatically if 'tsc' fails, 
        execSync('npx tsc', { stdio: 'inherit' });
        console.log('✅ Build completed successfully!');
    } catch (error) {
        // Ensure error is handled safely
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Build failed: ${message}`);
        process.exit(1);
    }
}

// Invoke the build
runBuild();