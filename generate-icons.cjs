const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, r, g, b) {
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      const cr = Math.round(r * (1 - t) + 34 * t);
      const cg = Math.round(g * (1 - t) + 197 * t);
      const cb = Math.round(b * (1 - t) + 94 * t);
      raw.push(cr, cg, cb);
    }
  }

  const rawData = Buffer.from(raw);
  const compressed = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let cc = n;
      for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
      table[n] = cc;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
    return Buffer.concat([len, typeB, data, crcB]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, 'src-tauri', 'icons');
fs.mkdirSync(dir, { recursive: true });

const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

for (const { name, size } of sizes) {
  fs.writeFileSync(path.join(dir, name), createPNG(size, size, 59, 130, 246));
  console.log(`Created ${name} (${size}x${size})`);
}

// Create .ico (just copy the 32x32 as ico - Windows accepts it)
fs.copyFileSync(path.join(dir, '32x32.png'), path.join(dir, 'icon.ico'));
console.log('Created icon.ico');

// Create .icns placeholder (copy 128x128)
fs.copyFileSync(path.join(dir, '128x128.png'), path.join(dir, 'icon.icns'));
console.log('Created icon.icns');

console.log('All icons generated!');
