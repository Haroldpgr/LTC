const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'src-tauri', 'icons', '32x32.png');
const icoPath = path.join(__dirname, 'src-tauri', 'icons', 'icon.ico');

const pngData = fs.readFileSync(pngPath);

// ICO header: 6 bytes
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);    // reserved
header.writeUInt16LE(1, 2);    // type: 1 = ICO
header.writeUInt16LE(1, 4);    // count: 1 image

// Image directory entry: 16 bytes
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);       // width: 32
entry.writeUInt8(32, 1);       // height: 32
entry.writeUInt8(0, 2);        // color palette: 0
entry.writeUInt8(0, 3);        // reserved: 0
entry.writeUInt16LE(1, 4);     // color planes: 1
entry.writeUInt16LE(32, 6);    // bits per pixel: 32
entry.writeUInt32LE(pngData.length, 8);  // size of image data
entry.writeUInt32LE(22, 12);   // offset: 6 (header) + 16 (entry) = 22

const ico = Buffer.concat([header, entry, pngData]);
fs.writeFileSync(icoPath, ico);
console.log(`Created valid ICO: ${ico.length} bytes`);
