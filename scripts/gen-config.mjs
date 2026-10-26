// Vercel build step: point the static frontend at the Render backend (API_BASE env var).
import fs from "node:fs";
const base = process.env.API_BASE ?? "";
fs.writeFileSync("public/config.js", `window.API_BASE = ${JSON.stringify(base)};\n`);
console.log("API_BASE =", base || "(same origin)");
