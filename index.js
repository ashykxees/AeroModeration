require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  OverwriteType,
} = require('discord.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1531847605645082664';
const ALLOWED_ROLE_IDS = (process.env.ALLOWED_ROLE_IDS || '1531861205470416936,1531860536193450174,1531860022814965902')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1531861708187111615';
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1531865262989774908';
const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID || '1531868413658534010';
const JOIN_LOG_CHANNEL_ID = process.env.JOIN_LOG_CHANNEL_ID || '1532058349632491641';
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID || '1532058419610259596';
const BOT_FILTER_CHANNEL_ID = process.env.BOT_FILTER_CHANNEL_ID || '1531847608744546416';
const MESSAGE_LOG_CHANNEL_ID = process.env.MESSAGE_LOG_CHANNEL_ID || '1532238739886309456';

const DATA_FILE = path.join(__dirname, 'data.json');
let db = { verificationMessageId: null, recentRemovals: {}, filterOffenders: {}, whitelisted: {} };

function loadData() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.recentRemovals = db.recentRemovals || {};
    db.filterOffenders = db.filterOffenders || {};
    db.whitelisted = db.whitelisted || {};
    if (!db.verificationMessageId && db.verificationMessageId !== null) db.verificationMessageId = null;
  } catch {
    db = { verificationMessageId: null, recentRemovals: {}, filterOffenders: {}, whitelisted: {} };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

loadData();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function inAllowedGuild(guildId) {
  return guildId === GUILD_ID;
}

function hasAllowedRole(member) {
  if (!member || !member.roles) return false;
  if (member.id === member.guild.ownerId) return true;
  return ALLOWED_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function isManager(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function botHighestPosition(guild) {
  return guild.members.me?.roles?.highest?.position ?? 0;
}

function canModerateActor(actor, target) {
  if (actor.id === actor.guild.ownerId) return true;
  if (target.id === target.guild.ownerId) return false;
  const actorPos = actor.roles.highest.position;
  const targetPos = target.roles?.highest?.position ?? 0;
  return actorPos > targetPos;
}

function canBotAct(guild, targetMember) {
  const botPos = botHighestPosition(guild);
  if (!targetMember || !targetMember.roles) return true;
  if (targetMember.id === guild.ownerId) return false;
  return botPos > targetMember.roles.highest.position;
}

function parseDuration(input) {
  const str = String(input || '').trim();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
  };
  const ms = multipliers[unit] || 60000;
  return Math.round(value * ms);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (hr) parts.push(`${hr}h`);
  if (min) parts.push(`${min}m`);
  if (s && !parts.length) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

async function safeReply(interaction, payload, ephemeral = true) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({ ...payload, ephemeral });
    }
    return await interaction.reply({ ...payload, ephemeral });
  } catch (err) {
    console.error('Reply error:', err.message);
  }
}

async function logToChannel(channelId, payload) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await channel.send(payload);
  } catch (err) {
    console.error(`Failed to send to channel ${channelId}:`, err.message);
  }
}

function recordRemoval(guildId, userId, action, reason) {
  if (!db.recentRemovals[guildId]) db.recentRemovals[guildId] = {};
  db.recentRemovals[guildId][userId] = { action, reason, timestamp: Date.now() };
  saveData();
}

function getRemoval(guildId, userId) {
  return db.recentRemovals[guildId]?.[userId] || null;
}

function clearRemoval(guildId, userId) {
  if (db.recentRemovals[guildId]?.[userId]) {
    delete db.recentRemovals[guildId][userId];
    saveData();
  }
}

async function logModerationAction(interaction, action, details = {}) {
  const target = details.target ? `<@${details.target.id}> (\`${details.target.tag}\`)` : 'N/A';
  const fields = [
    { name: 'Command', value: action, inline: true },
    { name: 'Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
    { name: 'Target', value: target, inline: true },
  ];
  if (details.reason) fields.push({ name: 'Reason', value: details.reason.slice(0, 1024) });
  if (details.duration) fields.push({ name: 'Duration', value: details.duration, inline: true });

  const embed = new EmbedBuilder()
    .setTitle('Moderation Action')
    .setColor(0x5865f2)
    .addFields(fields)
    .setTimestamp();

  await logToChannel(MOD_LOG_CHANNEL_ID, { embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user and DM them the reason.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to ban.').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Ban reason.').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user and DM them the reason.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to kick.').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Kick reason.').setRequired(true)),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a user and DM them the reason and duration.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to timeout.').setRequired(true))
    .addStringOption((opt) => opt.setName('duration').setDescription('Duration like 1h, 30m, 1d.').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Timeout reason.').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('View the bot latency.'),
  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist a user by mention or ID so they bypass the 24h account-age check.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to whitelist.').setRequired(false))
    .addStringOption((opt) => opt.setName('user_id').setDescription('User ID to whitelist (used if the user is not in the server).').setRequired(false)),
  new SlashCommandBuilder()
    .setName('unwhitelist')
    .setDescription('Remove a user from the account-age whitelist.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to unwhitelist.').setRequired(false))
    .addStringOption((opt) => opt.setName('user_id').setDescription('User ID to unwhitelist.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('appaccept')
    .setDescription('Send an application acceptance DM to a user.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to accept.').setRequired(true)),
].map((cmd) => cmd.toJSON());

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Registered slash commands for the allowed guild.');
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
  ensureVerificationMessage();
});

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
  }
});

async function handleSlashCommand(interaction) {
  if (!inAllowedGuild(interaction.guildId)) {
    return safeReply(interaction, { content: 'This bot is restricted to the AeroPulse Studios server.' });
  }

  const { commandName } = interaction;
  const member = interaction.member;
  const guild = interaction.guild;

  if (commandName === 'ping') {
    return safeReply(interaction, { content: `Pong! ${Math.round(client.ws.ping)}ms` });
  }

  if (commandName === 'whitelist' || commandName === 'unwhitelist') {
    if (!isManager(member)) {
      return safeReply(interaction, { content: 'Only server managers can use this command.' });
    }

    const targetUser = interaction.options.getUser('user');
    const userId = interaction.options.getString('user_id')?.trim();
    const id = targetUser?.id || userId;

    if (!id || !/^\d{17,20}$/.test(id)) {
      return safeReply(interaction, { content: 'Provide a valid user mention or user ID.' });
    }

    if (commandName === 'whitelist') {
      db.whitelisted[id] = true;
      saveData();
      return safeReply(interaction, { content: `Whitelisted <@${id}> (\`${id}\`) — they will bypass the 24h account-age check.` });
    }

    delete db.whitelisted[id];
    saveData();
    return safeReply(interaction, { content: `Removed <@${id}> (\`${id}\`) from the whitelist.` });
  }

  if (!hasAllowedRole(member)) {
    return safeReply(interaction, { content: 'You do not have permission to use this command.' });
  }

  try {
    switch (commandName) {
      case 'ban': {
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (targetUser.id === guild.ownerId) {
          return safeReply(interaction, { content: 'I cannot ban the server owner.' });
        }
        if (targetMember && !canModerateActor(member, targetMember)) {
          return safeReply(interaction, { content: 'You cannot ban this user due to role hierarchy.' });
        }
        if (targetMember && !canBotAct(guild, targetMember)) {
          return safeReply(interaction, { content: 'My role is too low to ban this user.' });
        }

        const dmEmbed = new EmbedBuilder()
          .setTitle('You have been banned')
          .setColor(0xed4245)
          .setDescription(`You were banned from **${guild.name}**.`)
          .addFields({ name: 'Reason', value: reason })
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        recordRemoval(guild.id, targetUser.id, 'Banned', reason);
        await guild.members.ban(targetUser, { reason });
        await logModerationAction(interaction, '/ban', { target: targetUser, reason });
        return safeReply(interaction, { content: `Banned ${targetUser.tag}.` });
      }

      case 'kick': {
        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
          return safeReply(interaction, { content: 'That user is not in the server.' });
        }
        if (targetMember.id === guild.ownerId) {
          return safeReply(interaction, { content: 'I cannot kick the server owner.' });
        }
        if (!canModerateActor(member, targetMember)) {
          return safeReply(interaction, { content: 'You cannot kick this user due to role hierarchy.' });
        }
        if (!canBotAct(guild, targetMember)) {
          return safeReply(interaction, { content: 'My role is too low to kick this user.' });
        }

        const dmEmbed = new EmbedBuilder()
          .setTitle('You have been kicked')
          .setColor(0xed4245)
          .setDescription(`You were kicked from **${guild.name}**.`)
          .addFields({ name: 'Reason', value: reason })
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        recordRemoval(guild.id, targetUser.id, 'Kicked', reason);
        await targetMember.kick(reason);
        await logModerationAction(interaction, '/kick', { target: targetUser, reason });
        return safeReply(interaction, { content: `Kicked ${targetUser.tag}.` });
      }

      case 'timeout': {
        const targetUser = interaction.options.getUser('user', true);
        const durationInput = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason', true);
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        const ms = parseDuration(durationInput);

        if (!ms || ms <= 0) {
          return safeReply(interaction, { content: 'Invalid duration. Use a format like `1h`, `30m`, or `1d`.' });
        }
        if (ms < 10000) {
          return safeReply(interaction, { content: 'Timeout must be at least 10 seconds.' });
        }
        if (ms > 28 * 24 * 60 * 60 * 1000) {
          return safeReply(interaction, { content: 'Timeout cannot exceed 28 days.' });
        }
        if (!targetMember) {
          return safeReply(interaction, { content: 'That user is not in the server.' });
        }
        if (targetMember.id === guild.ownerId) {
          return safeReply(interaction, { content: 'I cannot timeout the server owner.' });
        }
        if (!canModerateActor(member, targetMember)) {
          return safeReply(interaction, { content: 'You cannot timeout this user due to role hierarchy.' });
        }
        if (!canBotAct(guild, targetMember)) {
          return safeReply(interaction, { content: 'My role is too low to timeout this user.' });
        }

        const dmEmbed = new EmbedBuilder()
          .setTitle('You have been timed out')
          .setColor(0xfaa61a)
          .setDescription(`You were timed out in **${guild.name}**.`)
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Duration', value: formatDuration(ms) },
          )
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        await targetMember.timeout(ms, reason);
        await logModerationAction(interaction, '/timeout', { target: targetUser, reason, duration: formatDuration(ms) });
        return safeReply(interaction, { content: `Timed out ${targetUser.tag} for ${formatDuration(ms)}.` });
      }

      case 'appaccept': {
        const targetUser = interaction.options.getUser('user', true);
        const dmEmbed = new EmbedBuilder()
          .setTitle('AeroPulse Staff Application Acceptance')
          .setColor(0x5865f2)
          .setDescription(
            `Hello ${targetUser.toString()}\n\n` +
            '> We have brought you some good news today on behalf of the AeroPulse Studios Moderation Leadership.\n\n' +
            'Your application for Staff/Moderation Team member at AeroPulse Studios has been accepted. We are excited to welcome you to our team, but there is one final step.\n\n' +
            'We require **all** Staff Team members to take an assesment to assure our safety inside of AeroPulse. For your last step to become a staff member, we request you to complete the following assessment.\n\n' +
            '> You will be guided through easy steps on this assessment. If you have experience as a moderator or server manager, this should be easy-peasy. \n\n' +
            'We wish you best of luck.\n\n' +
            '***Signed,***\n' +
            '**AeroPulse Studios Moderation Team**',
          );
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Assessment')
            .setStyle(ButtonStyle.Link)
            .setURL('https://aeropulse-studio.com/staff-application'),
        );

        try {
          await targetUser.send({ embeds: [dmEmbed], components: [row] });
          return safeReply(interaction, { content: `Sent application acceptance DM to ${targetUser}.` });
        } catch (err) {
          console.error('Failed to send appaccept DM:', err.message);
          return safeReply(interaction, { content: `Failed to DM ${targetUser}. They may have DMs disabled.` });
        }
      }

      default:
        return safeReply(interaction, { content: 'Unknown command.' });
    }
  } catch (err) {
    console.error(`Command error (${commandName}):`, err);
    return safeReply(interaction, { content: 'An error occurred while running that command.' });
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
async function ensureVerificationMessage() {
  if (!VERIFICATION_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(VERIFICATION_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn('Verification channel not found or not a text channel.');
      return;
    }

    if (db.verificationMessageId) {
      try {
        const existing = await channel.messages.fetch(db.verificationMessageId);
        if (existing) {
          console.log(`Verification message already exists: ${existing.id}`);
          return;
        }
      } catch {
        // message deleted or inaccessible; continue
      }
    }

    const messages = await channel.messages.fetch({ limit: 100 });
    const existing = messages.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title === 'AeroPulse Verification' &&
        m.embeds[0]?.description?.includes('React with ✅'),
    );
    if (existing) {
      db.verificationMessageId = existing.id;
      saveData();
      console.log(`Found existing verification message: ${existing.id}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('AeroPulse Verification')
      .setColor(0x5865f2)
      .setDescription('React with ✅ to gain access to the server.');
    const sent = await channel.send({ embeds: [embed] });
    await sent.react('✅');
    db.verificationMessageId = sent.id;
    saveData();
    console.log(`Sent verification message: ${sent.id}`);
  } catch (err) {
    console.error('Failed to ensure verification message:', err.message);
  }
}

async function handleButton(interaction) {
  // not used currently; verification is reaction-based
  if (interaction.customId === 'verify') {
    await interaction.deferReply({ ephemeral: true });
    await assignVerifiedRole(interaction.member, interaction);
  }
}

async function assignVerifiedRole(member, interactionOrUser) {
  try {
    if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
      const msg = 'You are already verified.';
      if (interactionOrUser.reply) await safeReply(interactionOrUser, { content: msg });
      return;
    }
    await member.roles.add(VERIFIED_ROLE_ID, 'Verification');

    if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
      await member.roles.remove(UNVERIFIED_ROLE_ID, 'Verification').catch((err) => {
        console.error('Failed to remove unverified role:', err.message);
      });
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('Verified')
      .setColor(0x57f287)
      .setDescription(`You have been verified and given access to **${member.guild.name}**.`)
      .setTimestamp();
    await member.user.send({ embeds: [dmEmbed] }).catch(() => {});

    if (interactionOrUser.reply) {
      await safeReply(interactionOrUser, { content: 'You have been verified! Check your DMs.' });
    }
  } catch (err) {
    console.error('Failed to assign verified role:', err.message);
    if (interactionOrUser.reply) {
      await safeReply(interactionOrUser, { content: 'Failed to verify you. Please contact staff.' });
    }
  }
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (!db.verificationMessageId || reaction.message.id !== db.verificationMessageId) return;
  if (reaction.emoji.name !== '✅') return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.channel.partial) await reaction.message.channel.fetch();

    const guild = reaction.message.guild;
    if (!guild) return;
    if (!inAllowedGuild(guild.id)) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await assignVerifiedRole(member, user);
  } catch (err) {
    console.error('Verification reaction error:', err.message);
  }
});

// ---------------------------------------------------------------------------
// Join / leave logs
// ---------------------------------------------------------------------------
client.on('guildMemberAdd', async (member) => {
  if (!inAllowedGuild(member.guild.id)) return;

  const createdAt = member.user.createdAt;
  const accountAgeMs = Date.now() - createdAt.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (accountAgeMs < oneDay && !db.whitelisted[member.user.id]) {
    const reason = 'Account created less than 24 hours ago.';
    recordRemoval(member.guild.id, member.user.id, 'Kicked', reason);
    try {
      await member.kick(reason);
    } catch (err) {
      console.error('Failed to kick new account:', err.message);
    }

    const embed = new EmbedBuilder()
      .setTitle('User Kicked — Suspicious Account')
      .setColor(0xed4245)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'User', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: 'User ID', value: member.user.id, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(createdAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await logToChannel(JOIN_LOG_CHANNEL_ID, { embeds: [embed] });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('User Joined')
    .setColor(0x57f287)
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'User', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true },
      { name: 'User ID', value: member.user.id, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(createdAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();
  await logToChannel(JOIN_LOG_CHANNEL_ID, { embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
  if (!inAllowedGuild(member.guild.id)) return;

  const removal = getRemoval(member.guild.id, member.user.id);
  const fields = [
    { name: 'User', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true },
    { name: 'User ID', value: member.user.id, inline: true },
  ];

  let title = 'User Left';
  let color = 0x747f8d;
  if (removal) {
    title = `User ${removal.action}`;
    color = removal.action === 'Banned' ? 0xed4245 : 0xfaa61a;
    fields.push({ name: 'Action', value: removal.action, inline: true });
    fields.push({ name: 'Reason', value: removal.reason || 'No reason provided.' });
    clearRemoval(member.guild.id, member.user.id);
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .addFields(fields)
    .setTimestamp();
  await logToChannel(JOIN_LOG_CHANNEL_ID, { embeds: [embed] });
});

// ---------------------------------------------------------------------------
// Bot filter channel
// ---------------------------------------------------------------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!inAllowedGuild(message.guildId)) return;
  if (message.channelId !== BOT_FILTER_CHANNEL_ID) return;

  try {
    await message.delete();
  } catch (err) {
    console.error('Failed to delete filtered message:', err.message);
  }

  const member = message.member || (await message.guild?.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const isRepeat = db.filterOffenders[message.author.id];
  const dmKick = new EmbedBuilder()
    .setTitle('Kicked')
    .setColor(0xed4245)
    .setDescription('You were kicked from the server for talking inside of the bot filter channel, next time you will be banned.')
    .setTimestamp();
  const dmBan = new EmbedBuilder()
    .setTitle('Banned')
    .setColor(0xed4245)
    .setDescription('You were banned from the server for talking inside of the bot filter channel after being warned.')
    .setTimestamp();

  try {
    if (isRepeat) {
      await message.author.send({ embeds: [dmBan] }).catch(() => {});
      recordRemoval(message.guildId, message.author.id, 'Banned', 'Talked in bot filter channel after previous kick.');
      await message.guild.members.ban(message.author, { reason: 'Repeat bot filter channel violation.' });
    } else {
      await message.author.send({ embeds: [dmKick] }).catch(() => {});
      db.filterOffenders[message.author.id] = true;
      saveData();
      recordRemoval(message.guildId, message.author.id, 'Kicked', 'Talked in bot filter channel.');
      await member.kick('Talked in bot filter channel.');
    }
  } catch (err) {
    console.error('Bot filter action failed:', err.message);
  }
});

// ---------------------------------------------------------------------------
// Message edit / delete logs
// ---------------------------------------------------------------------------
async function resolveMessageContent(message) {
  if (!message) return null;
  try {
    if (message.partial) await message.fetch();
    return message.content || '*Content unavailable*';
  } catch {
    return '*Content unavailable*';
  }
}

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (newMessage.author?.bot) return;
  if (!inAllowedGuild(newMessage.guildId)) return;
  if (newMessage.channelId === MESSAGE_LOG_CHANNEL_ID) return;

  const oldContent = await resolveMessageContent(oldMessage);
  const newContent = await resolveMessageContent(newMessage);

  const embed = new EmbedBuilder()
    .setTitle('Message Edited')
    .setColor(0xfaa61a)
    .setAuthor({ name: newMessage.author?.tag || 'Unknown', iconURL: newMessage.author?.displayAvatarURL({ size: 128 }) })
    .addFields(
      { name: 'User', value: `<@${newMessage.author?.id}> (\`${newMessage.author?.tag}\`)`, inline: true },
      { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
      { name: 'Before', value: oldContent.slice(0, 1024) },
      { name: 'After', value: newContent.slice(0, 1024) },
    )
    .setTimestamp();
  await logToChannel(MESSAGE_LOG_CHANNEL_ID, { embeds: [embed] });
});

client.on('messageDelete', async (message) => {
  if (message.author?.bot) return;
  if (!inAllowedGuild(message.guildId)) return;
  if (message.channelId === MESSAGE_LOG_CHANNEL_ID) return;

  const content = await resolveMessageContent(message);

  const embed = new EmbedBuilder()
    .setTitle('Message Deleted')
    .setColor(0xed4245)
    .setAuthor({ name: message.author?.tag || 'Unknown', iconURL: message.author?.displayAvatarURL({ size: 128 }) })
    .addFields(
      { name: 'User', value: `<@${message.author?.id}> (\`${message.author?.tag}\`)`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Content', value: content.slice(0, 1024) },
    )
    .setTimestamp();
  await logToChannel(MESSAGE_LOG_CHANNEL_ID, { embeds: [embed] });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing. Set it in your .env file or environment.');
  process.exit(1);
}

client.login(DISCORD_TOKEN);

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('AeroModeration is running');
  })
  .listen(port, () => console.log(`Health server listening on port ${port}`));
