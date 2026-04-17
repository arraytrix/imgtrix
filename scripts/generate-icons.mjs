import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'resources/icon.png');
const icnsOut = resolve(root, 'resources/icon.icns');
const icoOut = resolve(root, 'resources/icon.ico');

const input = readFileSync(src);

const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
if (!icns) throw new Error('Failed to generate icon.icns');
writeFileSync(icnsOut, icns);
console.log(`wrote ${icnsOut} (${icns.length} bytes)`);

const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true);
if (!ico) throw new Error('Failed to generate icon.ico');
writeFileSync(icoOut, ico);
console.log(`wrote ${icoOut} (${ico.length} bytes)`);
