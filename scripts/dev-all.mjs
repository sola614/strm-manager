import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function startProcess(command, args, label, color) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    env: process.env,
  });

  const prefix = `\u001b[${color}m[${label}]\u001b[0m`;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`);
  });

  child.on('exit', (code) => {
    if (!shuttingDown) {
      shuttingDown = true;
      stopAll();
      const normalizedCode = code === null ? 1 : code;
      process.exit(normalizedCode);
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

startProcess('npm', ['run', 'dev:client'], 'client', '36');
startProcess('npm', ['run', 'dev:server'], 'server', '33');
