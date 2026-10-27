#!/usr/bin/env node
// GIT_ASKPASS helper (A-5.4): sends git's prompt and the command's one-time
// token to the broker and prints the answer. Holds no secret of its own.
// Plain Node with no imports but node:net: it ships next to the server and
// runs on its own.
'use strict';
const net = require('node:net');

const socketPath = process.env.FB_BROKER_SOCK;
const token = process.env.FB_BROKER_TOKEN;
const prompt = process.argv[2] ?? '';
if (!socketPath || !token) {
  process.exit(1);
}

const connection = net.createConnection(socketPath);
let answer = '';
connection.setEncoding('utf8');
connection.on('connect', () => connection.end(`${JSON.stringify({ token, prompt })}\n`));
connection.on('data', chunk => (answer += chunk));
connection.on('error', () => process.exit(1));
connection.on('close', () => {
  const end = answer.indexOf('\n');
  if (!answer.startsWith('ok ') || end < 0) {
    process.exit(1);
  }
  process.stdout.write(`${answer.slice(3, end)}\n`);
});
