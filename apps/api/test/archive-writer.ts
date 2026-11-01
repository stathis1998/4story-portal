// Writes the MFC CArchive encoding the client's chart files use.
export class ArchiveWriter {
  private readonly parts: Buffer[] = [];

  private add(size: number, write: (b: Buffer) => void): this {
    const b = Buffer.alloc(size);
    write(b);
    this.parts.push(b);
    return this;
  }

  u8 = (v: number) => this.add(1, (b) => b.writeUInt8(v));
  u16 = (v: number) => this.add(2, (b) => b.writeUInt16LE(v));
  u32 = (v: number) => this.add(4, (b) => b.writeUInt32LE(v));
  f32 = (v: number) => this.add(4, (b) => b.writeFloatLE(v));

  str(s: string): this {
    if (s.length < 0xff) this.u8(s.length);
    else this.u8(0xff).u16(s.length);
    this.parts.push(Buffer.from(s, 'latin1'));
    return this;
  }

  toBuffer = () => Buffer.concat(this.parts);
}
