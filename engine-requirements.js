const major = parseInt(process.versions.node.split(".")[0], 10);

// ANSI color manual (RGB via 24-bit)
const rgb = (r, g, b, text) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
const bold = t => `\x1b[1m${t}\x1b[0m`;

const line = rgb(120, 120, 120, "────────────────────────────────────────");

if (major < 20) {
  console.error(`
${line}
${bold(rgb(255, 80, 80, "⛔ NODE VERSION ERROR"))}

${rgb(255, 200, 0, "Bahasa Indonesia:")}
${rgb(255, 120, 120, "Node.js kamu TERLALU TUA.")}
Versi terdeteksi : ${rgb(0, 200, 255, process.versions.node)}
Minimal versi     : ${rgb(0, 255, 150, "Node.js 20+")}

${rgb(0, 180, 255, "English:")}
${rgb(255, 120, 120, "Your Node.js version is NOT supported.")}
Detected version  : ${rgb(0, 200, 255, process.versions.node)}
Required version  : ${rgb(0, 255, 150, "Node.js 20+")}

${rgb(180, 180, 180, "Please upgrade Node.js and try again.")}
${rgb(180, 180, 180, "Silakan update Node.js lalu jalankan ulang.")}

${line}
`);
  process.exit(1);
}