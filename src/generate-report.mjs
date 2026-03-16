#!/usr/bin/env node
/**
 * generate-report.mjs
 * Reads the latest output/state.json, builds an AI prompt from the data,
 * calls nano-banana-pro to generate a 2K infographic, and posts it to Discord.
 *
 * Usage: node src/generate-report.mjs
 *        npm run report
 *
 * Requires:
 *   - output/state.json  (produced by analyze.mjs)
 *   - config.json with nanoBananaPro.path set (or NANO_BANANA_PRO_PATH env var)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { sendFile } from './utils/discord.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = join(ROOT, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('config.json not found. Run `bash scripts/setup.sh`.');
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

const config = loadConfig();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || config.discord.botToken;
const REPORT_CHANNEL = config.discord.reportChannelId;
const NANO_BANANA_PATH = process.env.NANO_BANANA_PRO_PATH || config.nanoBananaPro?.path;

const STATE_FILE = join(ROOT, 'output', 'state.json');
const OUTPUT_DIR = join(ROOT, 'output');

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(state) {
  const { stats, channels, recommendations, timestamp } = state;

  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Top HOT channels
  const hotChannels = Object.values(channels)
    .filter(c => c.activity === 'HOT')
    .sort((a, b) => b.msgCount7d - a.msgCount7d)
    .slice(0, 5);

  const hotLine = hotChannels.length > 0
    ? hotChannels.map(c => `#${c.name} (${c.msgCount7d} msgs/week${c.topics[0] ? ', ' + c.topics[0] : ''})`).join(', ')
    : 'none';

  // Dead channels
  const deadChannels = Object.values(channels)
    .filter(c => c.activity === 'DEAD')
    .slice(0, 5)
    .map(c => `#${c.name}`).join(', ') || 'none';

  // Top recommendation
  const topRec = recommendations?.[0];
  const recLine = topRec
    ? `Key recommendation: ${topRec.title} — ${topRec.action}`
    : 'Server is healthy, no critical actions needed.';

  return [
    `Create a sleek, modern Discord server health infographic for the week of ${dateStr}.`,
    `Title: "Weekly Server Intelligence Report"`,
    ``,
    `Server stats:`,
    `• ${stats.hot} HOT channels (actively used this week)`,
    `• ${stats.warm} WARM channels (some recent activity)`,
    `• ${stats.cool} COOL channels (slowing down)`,
    `• ${stats.dead} DEAD channels (30+ days silent)`,
    `• ${stats.total} total channels analyzed`,
    ``,
    `Most active channels: ${hotLine}`,
    `Archive candidates: ${deadChannels}`,
    ``,
    `${recLine}`,
    ``,
    `Style: dark background (Discord dark theme colors), orange/gold accents (#F5A623), clean data visualization.`,
    `Include a channel activity heatmap-style bar chart showing HOT/WARM/COOL/DEAD proportions.`,
    `Use icons: 🔥 for HOT, 🌡️ for WARM, 🧊 for COOL, 💀 for DEAD.`,
    `Make it professional but slightly playful — this is an AI-powered server intelligence tool.`,
  ].join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎨 Generating server intelligence infographic...');

  // Load state
  if (!existsSync(STATE_FILE)) {
    throw new Error('output/state.json not found. Run `npm run analyze` first.');
  }
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  console.log(`📂 Loaded state from ${new Date(state.timestamp).toLocaleDateString()}`);

  // Build prompt
  const prompt = buildPrompt(state);
  console.log('\n📝 Generated prompt:\n');
  console.log(prompt);
  console.log('\n');

  // Determine output filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = join(OUTPUT_DIR, `report-${timestamp}.png`);

  // Check nano-banana-pro
  if (!NANO_BANANA_PATH) {
    console.warn('⚠️  nanoBananaPro.path not configured in config.json and NANO_BANANA_PRO_PATH not set.');
    console.warn('    Add "nanoBananaPro": { "path": "/path/to/nano-banana-pro" } to config.json.');
    console.warn('    Skipping image generation.');
    return;
  }

  const generateScript = join(NANO_BANANA_PATH, 'generate_image.py');
  if (!existsSync(generateScript)) {
    throw new Error(`nano-banana-pro generate_image.py not found at: ${generateScript}`);
  }

  // Call nano-banana-pro
  const safePrompt = prompt.replace(/"/g, '\\"');
  const cmd = `uv run "${generateScript}" --prompt "${safePrompt}" --filename "${outFile}" --resolution 2K`;
  console.log(`🚀 Running: ${cmd.slice(0, 100)}...`);

  try {
    execSync(cmd, { stdio: 'inherit', cwd: NANO_BANANA_PATH });
  } catch (err) {
    throw new Error(`Image generation failed: ${err.message}`);
  }

  if (!existsSync(outFile)) {
    throw new Error(`Image was not created at expected path: ${outFile}`);
  }
  console.log(`✅ Image generated: ${outFile}`);

  // Send to Discord
  if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_DISCORD_BOT_TOKEN') {
    console.warn('⚠️  No bot token configured — skipping Discord post.');
    return;
  }
  if (!REPORT_CHANNEL || REPORT_CHANNEL === 'YOUR_CHANNEL_ID') {
    console.warn('⚠️  No report channel configured — skipping Discord post.');
    return;
  }

  console.log(`📤 Posting infographic to channel ${REPORT_CHANNEL}...`);
  const { readFileSync: rfs } = await import('fs');
  const imageBuffer = rfs(outFile);
  const filename = `server-intelligence-${timestamp}.png`;

  await sendFile(
    REPORT_CHANNEL,
    BOT_TOKEN,
    imageBuffer,
    filename,
    '📊 **Weekly Server Intelligence — Infographic**'
  );

  console.log('✅ Infographic posted to Discord.');
}

main().catch(err => {
  console.error('❌ Report generation failed:', err);
  process.exit(1);
});
