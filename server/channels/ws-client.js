"use strict";

const crypto = require("crypto");
const tls = require("tls");
const { EventEmitter } = require("events");

class WebSocketClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = new URL(url);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshakeDone = false;
    this.closeRequested = false;
    this.fragments = [];
    this.fragmentOpcode = null;
  }

  connect() {
    const port = this.url.port ? Number(this.url.port) : 443;
    const path = `${this.url.pathname || "/"}${this.url.search || ""}`;
    const key = crypto.randomBytes(16).toString("base64");
    this.expectedAccept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    this.socket = tls.connect(
      {
        host: this.url.hostname,
        port,
        servername: this.url.hostname,
      },
      () => {
        this.socket.write(
          [
            `GET ${path} HTTP/1.1`,
            `Host: ${this.url.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "",
            "",
          ].join("\r\n"),
        );
      },
    );

    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.emit("error", error));
    this.socket.on("close", () => this.emit("close"));
    return this;
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(String(text), "utf8"));
  }

  close() {
    this.closeRequested = true;
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch {
      // Socket may already be closed.
    }
    if (this.socket) this.socket.end();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshakeDone) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4);
      this.verifyHandshake(header);
      this.handshakeDone = true;
      this.emit("open");
    }
    this.processFrames();
  }

  verifyHandshake(header) {
    const lines = header.split(/\r?\n/);
    if (!/^HTTP\/1\.1 101\b/.test(lines[0] || "")) {
      throw new Error(`WebSocket upgrade failed: ${lines[0] || "missing response"}`);
    }
    const headers = Object.fromEntries(
      lines
        .slice(1)
        .map((line) => line.split(/:\s*/))
        .filter((parts) => parts.length >= 2)
        .map(([key, ...rest]) => [key.toLowerCase(), rest.join(": ")]),
    );
    if (headers["sec-websocket-accept"] !== this.expectedAccept) {
      throw new Error("WebSocket upgrade failed: invalid Sec-WebSocket-Accept");
    }
  }

  processFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const longLength = this.buffer.readBigUInt64BE(offset);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
        length = Number(longLength);
        offset += 8;
      }

      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;

      let payload = this.buffer.slice(offset, offset + length);
      this.buffer = this.buffer.slice(offset + length);
      if (mask) payload = unmask(payload, mask);
      this.handleFrame({ fin, opcode, payload });
    }
  }

  handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      if (!this.closeRequested) this.sendFrame(0x8, Buffer.alloc(0));
      if (this.socket) this.socket.end();
      return;
    }
    if (opcode === 0x9) {
      this.sendFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) return;

    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        if (opcode === 0x1) this.emit("message", payload.toString("utf8"));
        else this.emit("binary", payload);
        return;
      }
      this.fragmentOpcode = opcode;
      this.fragments = [payload];
      return;
    }

    if (opcode === 0x0) {
      this.fragments.push(payload);
      if (!fin) return;
      const body = Buffer.concat(this.fragments);
      const originalOpcode = this.fragmentOpcode;
      this.fragments = [];
      this.fragmentOpcode = null;
      if (originalOpcode === 0x1) this.emit("message", body.toString("utf8"));
      else this.emit("binary", body);
    }
  }

  sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) throw new Error("WebSocket is not connected");
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "");
    const mask = crypto.randomBytes(4);
    const headerLength = body.length < 126 ? 2 : body.length <= 0xffff ? 4 : 10;
    const header = Buffer.alloc(headerLength);
    header[0] = 0x80 | opcode;
    if (body.length < 126) {
      header[1] = 0x80 | body.length;
    } else if (body.length <= 0xffff) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    this.socket.write(Buffer.concat([header, mask, maskPayload(body, mask)]));
  }
}

function maskPayload(payload, mask) {
  const output = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) output[i] = payload[i] ^ mask[i % 4];
  return output;
}

function unmask(payload, mask) {
  return maskPayload(payload, mask);
}

module.exports = { WebSocketClient };
