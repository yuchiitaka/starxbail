import makeWASocket from './Socket/index.js';
export * from '../WAProto/index.js';
export * from './Utils/index.js';
export * from './Types/index.js';
export * from './Defaults/index.js';
export * from './WABinary/index.js';
export * from './WAM/index.js';
export * from './WAUSync/index.js';

// ANSI manual
const reset = '\x1b[0m';
const line = '\x1b[38;2;110;110;110m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m';

const gradientText = (text) => {
  const colors = [
    [255, 90, 90],
    [255, 160, 0],
    [255, 230, 80],
    [0, 220, 170],
    [0, 170, 255],
    [140, 120, 255]
  ];
  return text
    .split('')
    .map((c, i) => {
      const [r, g, b] = colors[i % colors.length];
      return `\x1b[38;2;${r};${g};${b}m${c}`;
    })
    .join('') + reset;
};

console.log('\n' + line);
console.log(gradientText('  🚀✨ Baileys Modified By StarX Teams ✨🚀  '));
console.log(line);
console.log('\x1b[38;2;210;210;210m💎 Thank You For Using Our Modified Baileys\x1b[0m');
console.log('\x1b[38;2;0;190;255m📡 Telegram : \x1b[38;2;0;255;190m@yuchii_oz\x1b[0m');
console.log(line + '\n');

export { makeWASocket };
export default makeWASocket;
