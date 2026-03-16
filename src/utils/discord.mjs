/**
 * discord.mjs
 * Discord REST API v10 helpers for the server intelligence tool.
 */

/**
 * Make an authenticated GET request to the Discord API.
 * @param {string} path - API path (e.g. /guilds/123/channels)
 * @param {string} botToken - Discord bot token
 * @returns {Promise<any>} Parsed JSON response
 */
export async function discordGet(path, botToken) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  if (!res.ok) throw new Error(`Discord API ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Fetch all channels in a guild.
 * @param {string} guildId
 * @param {string} botToken
 */
export async function getChannels(guildId, botToken) {
  return discordGet(`/guilds/${guildId}/channels`, botToken);
}

/**
 * Fetch recent messages from a channel.
 * Returns empty array on permission errors.
 * @param {string} channelId
 * @param {string} botToken
 * @param {number} limit - Max messages to fetch (max 100)
 */
export async function getMessages(channelId, botToken, limit = 50) {
  try {
    return await discordGet(`/channels/${channelId}/messages?limit=${limit}`, botToken);
  } catch {
    return [];
  }
}

/**
 * Send a Discord embed (optionally with a content message) to a channel.
 * @param {string} channelId
 * @param {string} botToken
 * @param {object} embed - Discord embed object
 * @param {string} [content] - Optional text content above the embed
 */
export async function sendEmbed(channelId, botToken, embed, content = '') {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, embeds: [embed] })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to send embed: ${err}`);
  }
  return res.json();
}

/**
 * Send a file attachment to a Discord channel.
 * @param {string} channelId
 * @param {string} botToken
 * @param {Buffer} fileBuffer - File content as Buffer
 * @param {string} filename - Filename to send (e.g. report.png)
 * @param {string} [content] - Optional text content with the attachment
 */
export async function sendFile(channelId, botToken, fileBuffer, filename, content = '') {
  const formData = new FormData();
  if (content) formData.append('content', content);
  formData.append('file', new Blob([fileBuffer]), filename);

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to send file: ${err}`);
  }
  return res.json();
}
