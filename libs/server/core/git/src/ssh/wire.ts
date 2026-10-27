/** SSH wire encoding (RFC 4251 section 5), for the agent and signatures. */

export function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/** A `string`: a 4-byte length and the bytes. */
export function sshString(value: Buffer | string): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([ uint32(bytes.length), bytes ]);
}

/** An `mpint` of an unsigned big-endian number. */
export function mpint(value: Buffer): Buffer {
  let start = 0;
  while (start < value.length && value[start] === 0) {
    start++;
  }
  const bytes = value.subarray(start);
  return sshString((bytes[0] ?? 0) & 0x80 ? Buffer.concat([ Buffer.from([ 0 ]), bytes ]) : bytes);
}

/** Reads SSH values in order; every read throws on truncated input. */
export class WireReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get done(): boolean {
    return this.offset === this.buffer.length;
  }

  byte(): number {
    this.need(1);
    return this.buffer[this.offset++] ?? 0;
  }

  uint32(): number {
    this.need(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  string(): Buffer {
    const length = this.uint32();
    this.need(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private need(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new RangeError('truncated SSH data');
    }
  }
}
