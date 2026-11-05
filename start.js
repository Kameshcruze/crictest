import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxCli = path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverFile = path.join(__dirname, 'server.ts');

console.log('🚀 Starting Crex Live Scorer Server...');

const child = spawn(process.execPath, [tsxCli, serverFile], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
