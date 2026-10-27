#!/usr/bin/env node
// ssh ProxyCommand helper (A-5.7): opens a SOCKS5 tunnel through the egress
// proxy and joins it to stdin and stdout. The target comes from the environment
// that the broker set from the parsed remote URL, not from ssh's %h/%p, so a
// host name never passes through the shell that runs ProxyCommand.
// Plain Node with no imports but node:net: it ships next to the server and
// runs on its own.
'use strict';
const net = require('node:net');

const socketPath = process.env.FB_EGRESS_SOCK;
const token = Buffer.from(process.env.FB_BROKER_TOKEN ?? '');
const [ host, portText ] = (process.env.FB_EGRESS_TARGET ?? '').split(/:(?=\d+$)/);
const port = Number(portText);
if (!socketPath || !token.length || token.length > 255 || !host || !(port > 0 && port < 65536)) {
  process.exit(2);
}

const user = Buffer.from('fb');
const name = Buffer.from(host.replace(/^\[|\]$/g, ''));
if (name.length > 255) {
  process.exit(2);
}
// Greeting, authentication and request in one write: one round trip on the socket.
const hello = Buffer.concat([
  Buffer.from([ 5, 1, 2 ]),
  Buffer.from([ 1, user.length ]),
  user,
  Buffer.from([ token.length ]),
  token,
  Buffer.from([ 5, 1, 0, 3, name.length ]),
  name,
  Buffer.from([ port >> 8, port & 255 ])
]);

// Method choice (2 bytes), authentication status (2) and the reply (10).
const ANSWER_LENGTH = 14;

const connection = net.createConnection(socketPath);
let open = false;
connection.on('error', () => process.exit(1));
connection.on('close', () => !open && process.exit(1));
connection.on('connect', () => connection.write(hello));
let received = Buffer.alloc(0);
const onData = chunk => {
  received = Buffer.concat([ received, chunk ]);
  if (received[1] !== undefined && received[1] !== 2 || received[3] !== undefined && received[3] !== 0) {
    process.stderr.write('egress proxy refused the authentication\n');
    process.exit(1);
  }
  if (received.length < ANSWER_LENGTH) {
    return;
  }
  if (received[5] !== 0) {
    process.stderr.write(`egress proxy refused the connection (code ${received[5]})\n`);
    process.exit(1);
  }
  connection.removeListener('data', onData);
  open = true;
  if (received.length > ANSWER_LENGTH) {
    process.stdout.write(received.subarray(ANSWER_LENGTH));
  }
  process.stdin.pipe(connection);
  connection.pipe(process.stdout);
};
connection.on('data', onData);
