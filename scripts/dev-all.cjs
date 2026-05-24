const { spawn } = require('node:child_process');
const path = require('node:path');

const children = [];
let shuttingDown = false;

function startProcess(command, args, label, color) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    env: process.env,
  });

  const prefix = `\u001b[${color}m[${label}]\u001b[0m`;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`);
  });

  child.on('error', (error) => {
    if (!shuttingDown) {
      shuttingDown = true;
      process.stderr.write(`${prefix} ${error.message}\n`);
      stopAll();
      process.exit(1);
    }
  });

  child.on('exit', (code) => {
    if (!shuttingDown) {
      shuttingDown = true;
      stopAll();
      process.exit(code === null ? 1 : code);
    }
  });

  children.push(child);
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }
}

process.on('SIGINT', () => {
  if (!shuttingDown) {
    shuttingDown = true;
    stopAll();
    setTimeout(() => process.exit(0), 200);
  }
});

process.on('SIGTERM', () => {
  if (!shuttingDown) {
    shuttingDown = true;
    stopAll();
    setTimeout(() => process.exit(0), 200);
  }
});

const nodeCommand = process.execPath;
const viteBin = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const serverEntry = path.resolve(__dirname, '..', 'server.js');

startProcess(nodeCommand, [viteBin], 'client', '36');
startProcess(nodeCommand, [serverEntry], 'server', '33');
