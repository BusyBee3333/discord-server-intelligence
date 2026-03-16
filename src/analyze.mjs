#!/usr/bin/env node
/**
 * analyze.mjs
 * Weekly Discord server health analysis.
 * Reads configuration from config.json in the project root.
 *
 * Design principle: the server should grow with biological sentience —
 * it reads context, notices what's actually alive, and surfaces
 * actionable nudges (not just raw stats).
 *
 * Usage: node src/analyze.mjs
 *        npm run analyze
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getChannels, getMessages, sendEmbed } from './utils/discord.mjs';
import { extractTopics, inferChannelIntent } from './utils/topics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config loading ───────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = join(ROOT, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'config.json not found. Run `bash scripts/setup.sh` and fill in your credentials.'
    );
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

const config = loadConfig();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || config.discord.botToken;
const GUILD_ID = config.discord.guildId;
const REPORT_CHANNEL = config.discord.reportChannelId;

const HOT_THRESHOLD_DAYS = config.analysis?.hotThresholdDays ?? 2;
const HOT_THRESHOLD_MSGS = config.analysis?.hotThresholdMessages ?? 5;
const DEAD_THRESHOLD_DAYS = config.analysis?.deadThresholdDays ?? 30;
const LOOKBACK_MESSAGES = config.analysis?.lookbackMessages ?? 50;

const OUTPUT_DIR = join(ROOT, 'output');
const STATE_FILE = join(OUTPUT_DIR, 'state.json');

// ─── Analysis helpers ─────────────────────────────────────────────────────────

function msAgo(ms) {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function categorizeActivity(lastMsgMs, msgCount7d) {
  const daysSince = (Date.now() - lastMsgMs) / 86400000;
  if (daysSince <= HOT_THRESHOLD_DAYS && msgCount7d >= HOT_THRESHOLD_MSGS) return 'HOT';
  if (daysSince <= 7 && msgCount7d >= 2) return 'WARM';
  if (daysSince <= DEAD_THRESHOLD_DAYS) return 'COOL';
  return 'DEAD';
}

// ─── Recommendation engine ────────────────────────────────────────────────────

function generateRecommendations(channelAnalysis, previousState) {
  const recs = [];

  // 1. Archive candidates: dead for DEAD_THRESHOLD_DAYS+ days
  const deadChannels = channelAnalysis.filter(c => c.activity === 'DEAD' && c.type === 0);
  if (deadChannels.length > 0) {
    recs.push({
      priority: 'medium',
      type: 'archive',
      title: `Archive ${deadChannels.length} dead channels`,
      detail: deadChannels.map(c => `#${c.name}`).join(', '),
      action: `These channels have had no activity in ${DEAD_THRESHOLD_DAYS}+ days and are cluttering the sidebar`,
    });
  }

  // 2. New activity patterns: channels getting HOT that were previously COOL/WARM
  if (previousState?.channels) {
    const newlyHot = channelAnalysis.filter(c => {
      const prev = previousState.channels[c.id];
      return c.activity === 'HOT' && prev && prev.activity !== 'HOT';
    });
    if (newlyHot.length > 0) {
      recs.push({
        priority: 'info',
        type: 'trending',
        title: `${newlyHot.length} channels heating up`,
        detail: newlyHot.map(c => `#${c.name} (${c.topics.join(', ') || 'general'})`).join('\n'),
        action: 'Consider pinning important messages or creating a dedicated space if traffic grows',
      });
    }
  }

  // 3. Hot channels with no category — orphans
  const orphanHot = channelAnalysis.filter(c => c.activity === 'HOT' && !c.categoryId && c.type === 0);
  if (orphanHot.length > 0) {
    recs.push({
      priority: 'medium',
      type: 'organize',
      title: `${orphanHot.length} active channels without a category`,
      detail: orphanHot.map(c => `#${c.name}`).join(', '),
      action: 'These channels are floating loose — slot them into an appropriate category',
    });
  }

  // 4. Categories with mostly dead channels (>70% dead)
  const categoryGroups = {};
  for (const c of channelAnalysis) {
    if (c.categoryName) {
      if (!categoryGroups[c.categoryName]) categoryGroups[c.categoryName] = { hot: 0, dead: 0, total: 0 };
      categoryGroups[c.categoryName].total++;
      if (c.activity === 'HOT' || c.activity === 'WARM') categoryGroups[c.categoryName].hot++;
      if (c.activity === 'DEAD') categoryGroups[c.categoryName].dead++;
    }
  }
  for (const [cat, stats] of Object.entries(categoryGroups)) {
    if (stats.total >= 3 && stats.dead / stats.total > 0.7) {
      recs.push({
        priority: 'high',
        type: 'prune',
        title: `"${cat}" category is ${Math.round(stats.dead / stats.total * 100)}% dead`,
        detail: `${stats.dead}/${stats.total} channels inactive, ${stats.hot} active`,
        action: 'Consider collapsing this category or archiving its empty channels',
      });
    }
  }

  // 5. Agent workspace sprawl detection
  const agentChannels = channelAnalysis.filter(c =>
    ['buba', 'oogie2', 'oogie-s-corner', "oogie's-corner", 'bot-talk', 'off-topic'].includes(c.name.toLowerCase()) ||
    c.topics.includes('Agent/bot work')
  );
  const agentInWrongPlace = agentChannels.filter(c => c.categoryName === 'Text Channels');
  if (agentInWrongPlace.length > 0) {
    recs.push({
      priority: 'low',
      type: 'organize',
      title: 'Agent workspace channels in generic Text Channels category',
      detail: agentInWrongPlace.map(c => `#${c.name}`).join(', '),
      action: "Create an \"Agent Workspace\" category so humans can collapse it when they don't need it",
    });
  }

  // 6. All good fallback
  if (recs.length === 0) {
    recs.push({
      priority: 'info',
      type: 'healthy',
      title: 'Server looks healthy',
      detail: `${channelAnalysis.filter(c => c.activity === 'HOT').length} hot channels, organic usage patterns stable`,
      action: 'No action needed this week',
    });
  }

  return recs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Starting Discord server weekly analysis...');

  if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_DISCORD_BOT_TOKEN') {
    throw new Error('No Discord bot token configured. Set DISCORD_BOT_TOKEN env var or fill in config.json.');
  }
  if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID') {
    throw new Error('No Guild ID configured. Fill in config.json.');
  }

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load previous state for delta analysis
  let previousState = null;
  if (existsSync(STATE_FILE)) {
    try {
      previousState = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      console.log(`📂 Loaded previous state from ${new Date(previousState.timestamp).toLocaleDateString()}`);
    } catch { /* fresh start */ }
  }

  // Get all channels
  const rawChannels = await getChannels(GUILD_ID, BOT_TOKEN);
  console.log(`📋 Found ${rawChannels.length} channels`);

  // Build category map
  const categories = {};
  for (const ch of rawChannels) {
    if (ch.type === 4) categories[ch.id] = ch.name;
  }

  // Analyze text channels (type 0 = text, type 15 = forum)
  const textChannels = rawChannels.filter(c => c.type === 0 || c.type === 15);
  console.log(`📊 Analyzing ${textChannels.length} text/forum channels...`);

  const channelAnalysis = [];
  const sevenDaysAgo = Date.now() - 7 * 86400000;

  for (const ch of textChannels) {
    let lastMsgMs = 0;
    let msgCount7d = 0;
    let recentMessages = [];
    let topics = [];

    if (ch.last_message_id) {
      const msgs = await getMessages(ch.id, BOT_TOKEN, LOOKBACK_MESSAGES);
      recentMessages = msgs;
      if (msgs.length > 0) {
        lastMsgMs = new Date(msgs[0].timestamp).getTime();
        msgCount7d = msgs.filter(m => new Date(m.timestamp).getTime() > sevenDaysAgo).length;
        topics = extractTopics(msgs);
      }
    }

    const activity = categorizeActivity(lastMsgMs, msgCount7d);
    const intent = inferChannelIntent(ch.name, recentMessages);

    channelAnalysis.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      categoryId: ch.parent_id || null,
      categoryName: ch.parent_id ? categories[ch.parent_id] : null,
      lastMsgMs,
      lastMsgRelative: lastMsgMs ? msAgo(lastMsgMs) : 'never',
      msgCount7d,
      activity,
      topics,
      intent,
    });

    // Respectful rate-limit delay
    await new Promise(r => setTimeout(r, 300));
  }

  // Generate recommendations
  const recs = generateRecommendations(channelAnalysis, previousState);

  // Build summary stats
  const stats = {
    hot: channelAnalysis.filter(c => c.activity === 'HOT').length,
    warm: channelAnalysis.filter(c => c.activity === 'WARM').length,
    cool: channelAnalysis.filter(c => c.activity === 'COOL').length,
    dead: channelAnalysis.filter(c => c.activity === 'DEAD').length,
    total: channelAnalysis.length,
  };

  // Save state for next week's delta
  const newState = {
    timestamp: Date.now(),
    stats,
    channels: Object.fromEntries(
      channelAnalysis.map(c => [c.id, { name: c.name, activity: c.activity, topics: c.topics, msgCount7d: c.msgCount7d }])
    ),
    recommendations: recs,
  };
  writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
  console.log(`💾 State saved to output/state.json`);

  // Format recommendations as Discord embed fields
  const priorityEmoji = { high: '🔴', medium: '🟡', low: '🔵', info: '⚪' };
  const typeEmoji = { archive: '🗃️', trending: '📈', organize: '🏗️', prune: '✂️', healthy: '✅' };

  const recFields = recs.slice(0, 5).map(r => ({
    name: `${priorityEmoji[r.priority]} ${typeEmoji[r.type]} ${r.title}`,
    value: `${r.detail}\n*${r.action}*`,
    inline: false,
  }));

  // Top active channels
  const hotList = channelAnalysis
    .filter(c => c.activity === 'HOT')
    .sort((a, b) => b.msgCount7d - a.msgCount7d)
    .slice(0, 6)
    .map(c => `**#${c.name}** — ${c.msgCount7d} msgs/7d${c.topics.length ? ` · ${c.topics[0]}` : ''}`)
    .join('\n');

  const deadList = channelAnalysis
    .filter(c => c.activity === 'DEAD')
    .slice(0, 8)
    .map(c => `~~#${c.name}~~ — ${c.lastMsgRelative}`)
    .join('\n');

  // Delta line
  let deltaLine = '';
  if (previousState?.stats) {
    const prev = previousState.stats;
    const hotDelta = stats.hot - prev.hot;
    const deadDelta = stats.dead - prev.dead;
    deltaLine = `vs last week: HOT ${hotDelta >= 0 ? '+' : ''}${hotDelta}, DEAD ${deadDelta >= 0 ? '+' : ''}${deadDelta}`;
  }

  const embed = {
    title: '🧠 Weekly Server Intelligence Report',
    description: `Server analyzed **${stats.total}** channels. Here's what the data is telling us this week.${deltaLine ? `\n*${deltaLine}*` : ''}`,
    color: 0xF5A623, // gold
    fields: [
      {
        name: '📊 Activity Overview',
        value: `🔥 **${stats.hot}** Hot  •  🌡️ **${stats.warm}** Warm  •  🧊 **${stats.cool}** Cool  •  💀 **${stats.dead}** Dead`,
        inline: false,
      },
      {
        name: '🔥 Most Active This Week',
        value: hotList || 'No hot channels detected',
        inline: true,
      },
      {
        name: '💀 Archive Candidates',
        value: deadList || 'None — everything is active!',
        inline: true,
      },
      ...recFields,
    ],
    footer: {
      text: `discord-server-intelligence · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    },
    timestamp: new Date().toISOString(),
  };

  if (REPORT_CHANNEL && REPORT_CHANNEL !== 'YOUR_CHANNEL_ID') {
    await sendEmbed(REPORT_CHANNEL, BOT_TOKEN, embed, '📋 **Weekly server intelligence report:**');
    console.log(`✅ Report posted to channel ${REPORT_CHANNEL}`);
  } else {
    console.log('⚠️  No report channel configured — skipping Discord post. Set reportChannelId in config.json.');
    console.log('\nEmbed preview:');
    console.log(JSON.stringify(embed, null, 2));
  }

  console.log(`\nStats: ${stats.hot} hot, ${stats.warm} warm, ${stats.cool} cool, ${stats.dead} dead`);
  console.log(`Recommendations: ${recs.length}`);
}

main().catch(err => {
  console.error('❌ Analysis failed:', err);
  process.exit(1);
});
