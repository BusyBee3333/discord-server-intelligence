/**
 * topics.mjs
 * Keyword-based topic extractor for Discord message content.
 *
 * Extend the PATTERNS array to add new topic categories.
 * Each pattern is [RegExp, label] where the regexp is tested against
 * the lowercased concatenation of all message content in a channel.
 * A topic is surfaced if it matches 2+ times.
 */

export const PATTERNS = [
  [/upwork|gig|client|proposal/g, 'Upwork/freelancing'],
  [/settlement|anthropic.*book|publisher|isbn|claim/g, 'Book Settlement'],
  [/signet|memory|embed/g, 'Signet/memory'],
  [/agent|bot|buba|oogie/g, 'Agent/bot work'],
  [/github|repo|pr|commit/g, 'GitHub/code'],
  [/discord|channel|server|category/g, 'Server organization'],
  [/smart.contract|solidity|blockchain|nft/g, 'Blockchain/NFT'],
  [/svg|design|image|visual/g, 'Design/visuals'],
  [/contribution|points|leaderboard/g, 'Contribution system'],
  [/marketing|campaign|funnel|lead/g, 'Marketing'],
  [/crm|pipeline|deal|sales/g, 'CRM/Sales'],
  [/deploy|docker|server|vps|hosting/g, 'DevOps/Hosting'],
  [/ai|llm|gpt|claude|gemini|openai/g, 'AI/LLM'],
  [/figma|ui|ux|wireframe|mockup/g, 'UI/UX Design'],
  [/billing|invoice|stripe|payment/g, 'Billing/Payments'],
];

/**
 * Extract the top topics from a list of Discord message objects.
 * @param {object[]} messages - Array of Discord message objects
 * @param {number} [topN=3] - Max number of topics to return
 * @returns {string[]} Array of topic labels
 */
export function extractTopics(messages, topN = 3) {
  const text = messages.map(m => m.content || '').join(' ').toLowerCase();
  const topics = [];

  for (const [pattern, label] of PATTERNS) {
    // Reset lastIndex in case the regexp is stateful
    pattern.lastIndex = 0;
    const matches = text.match(pattern) || [];
    if (matches.length >= 2) topics.push(label);
  }

  return topics.slice(0, topN);
}

/**
 * Infer whether a channel's actual usage matches its declared name.
 * @param {string} name - Channel name
 * @param {object[]} messages - Recent messages in the channel
 * @returns {{ match: string, signal: string }}
 */
export function inferChannelIntent(name, messages) {
  const topics = extractTopics(messages);
  const nameLower = name.toLowerCase();

  if (messages.length === 0) {
    return { match: 'empty', signal: 'No messages — likely never used' };
  }

  // Simple mismatch detection (extend as needed)
  if (nameLower.includes('marketing') && !topics.includes('Marketing')) {
    return { match: 'mismatch', signal: 'Named for marketing but not being used for it' };
  }
  if (nameLower.includes('crm') && topics.length === 0) {
    return { match: 'mismatch', signal: 'CRM channel with no CRM activity detected' };
  }

  return { match: 'aligned', signal: topics.join(', ') || 'General discussion' };
}
