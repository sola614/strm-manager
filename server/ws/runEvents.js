import crypto from 'node:crypto';

export function createRunEventHub({ getSetting, getRunById, hashValue, sanitizeText }) {
  const runSubscribers = new Map();

  function handleWebSocketUpgrade(req, socket) {
    if (!req.url?.startsWith('/ws/runs')) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = sanitizeText(url.searchParams.get('token'));
    const tokenHash = getSetting('session_token_hash');
    if (!token || !tokenHash || tokenHash !== hashValue(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    const client = {
      socket,
      runId: '',
    };

    socket.on('data', (buffer) => {
      const message = decodeWebSocketFrame(buffer);
      if (!message) return;

      try {
        const payload = JSON.parse(message);
        if (payload?.type !== 'subscribeRun') return;

        const runId = sanitizeText(payload.runId);
        if (!runId) return;

        unsubscribeRunClient(client);
        client.runId = runId;
        if (!runSubscribers.has(runId)) {
          runSubscribers.set(runId, new Set());
        }
        runSubscribers.get(runId).add(client);

        const run = getRunById(runId);
        if (run) {
          sendWebSocketJson(socket, {
            type: 'runSnapshot',
            run,
          });
        }
      } catch {
        // Ignore malformed client messages.
      }
    });

    socket.on('close', () => unsubscribeRunClient(client));
    socket.on('error', () => unsubscribeRunClient(client));
  }

  function unsubscribeRunClient(client) {
    if (!client.runId) return;

    const subscribers = runSubscribers.get(client.runId);
    if (subscribers) {
      subscribers.delete(client);
      if (!subscribers.size) {
        runSubscribers.delete(client.runId);
      }
    }
    client.runId = '';
  }

  function broadcastRunSnapshot(runId) {
    const subscribers = runSubscribers.get(runId);
    if (!subscribers?.size) return;

    const run = getRunById(runId);
    if (!run) return;

    for (const client of subscribers) {
      sendWebSocketJson(client.socket, {
        type: 'runSnapshot',
        run,
      });
    }
  }

  return {
    handleWebSocketUpgrade,
    broadcastRunSnapshot,
  };
}

function sendWebSocketJson(socket, payload) {
  if (socket.destroyed) return;
  socket.write(encodeWebSocketFrame(JSON.stringify(payload)));
}

function encodeWebSocketFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketFrame(buffer) {
  if (buffer.length < 6) return '';

  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return '';
  if (opcode !== 0x1) return '';

  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return '';
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return '';
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) return '';
    length = Number(bigLength);
    offset += 8;
  }

  if (!masked || buffer.length < offset + 4 + length) return '';

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = buffer[offset + index] ^ mask[index % 4];
  }

  return payload.toString('utf8');
}
