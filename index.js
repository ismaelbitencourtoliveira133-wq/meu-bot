require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
} = require('discord.js');
const express = require('express');

// ---------- CANAL DE LOG DE CONVITES ----------
const INVITE_LOG_CHANNEL_ID = '1518234479494299779';

// ---------- CONFIGURAÇÃO DO SISTEMA DE TICKETS ----------
const TICKET_PANEL_CHANNEL_ID = '1518234573203312700'; // canal onde fica a mensagem/painel para abrir ticket
const CATEGORY_ID = '1518361267071615148'; // categoria onde os canais de ticket serão criados
const STAFF_ROLE_ID = '1518234150627315762'; // cargo que será marcado e que tem acesso aos tickets
const SPOILER_ROLE_ID = '1518234095518482573'; // cargo autorizado a usar o /spoiler

// ---------- CONFIGURAÇÃO DOS TIPOS DE TICKET ----------
const TICKET_TYPES = {
  suporte: {
    label: 'Suporte',
    emoji: '🛠️',
    color: 0x3498db,
    style: ButtonStyle.Primary,
    description: 'Tirar dúvidas ou pedir ajuda com algo do servidor.',
  },
  parceria: {
    label: 'Parceria',
    emoji: '🤝',
    color: 0x9b59b6,
    style: ButtonStyle.Secondary,
    description: 'Propor uma parceria com o servidor.',
  },
  compras: {
    label: 'Compras',
    emoji: '🛒',
    color: 0x2ecc71,
    style: ButtonStyle.Success,
    description: 'Comprar algo disponível no servidor.',
  },
  denuncia: {
    label: 'Denúncia',
    emoji: '🚨',
    color: 0xe74c3c,
    style: ButtonStyle.Danger,
    description: 'Denunciar um membro que quebrou as regras.',
  },
};

// ---------- CLIENTE DO DISCORD ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // necessário para o !ping
    GatewayIntentBits.GuildMembers,   // necessário para detectar entradas (PRECISA ser ativado no Developer Portal)
    GatewayIntentBits.GuildInvites,   // necessário para rastrear convites
  ],
  partials: [Partials.Channel],
});

// =====================================================
// ---------- SISTEMA DE RASTREAMENTO DE CONVITES ----------
// =====================================================

// Cache em memória: guildId -> Map(code -> { uses, maxUses, inviterId, inviterTag })
const inviteCache = new Map();
// Cache de uses do vanity URL (link personalizado) por servidor
const vanityCache = new Map();

// ---------- PERSISTÊNCIA EM DISCO ----------
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'invites.json');

function loadInviteData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Erro ao carregar dados de convites:', err.message);
    return {};
  }
}

function saveInviteData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
  } catch (err) {
    console.error('Erro ao salvar dados de convites:', err.message);
  }
}

let inviteData = loadInviteData(); // { [guildId]: { counts: { [userId]: number }, members: { [memberId]: { inviterId, code, joinedAt } } } }

function ensureGuildData(guildId) {
  if (!inviteData[guildId]) {
    inviteData[guildId] = { counts: {}, members: {} };
  }
  return inviteData[guildId];
}

function registerInvite(guildId, inviterId, memberId, code) {
  const gData = ensureGuildData(guildId);
  if (inviterId) {
    gData.counts[inviterId] = (gData.counts[inviterId] || 0) + 1;
  }
  gData.members[memberId] = {
    inviterId: inviterId || null,
    code: code || null,
    joinedAt: Date.now(),
  };
  saveInviteData();
}

// ---------- CACHE DE CONVITES DE UM SERVIDOR ----------
async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach((inv) => {
      map.set(inv.code, {
        uses: inv.uses || 0,
        maxUses: inv.maxUses || 0,
        inviterId: inv.inviter ? inv.inviter.id : null,
        inviterTag: inv.inviter ? inv.inviter.tag : null,
      });
    });
    inviteCache.set(guild.id, map);

    if (guild.features.includes('VANITY_URL')) {
      try {
        const vanity = await guild.fetchVanityData();
        vanityCache.set(guild.id, vanity.uses || 0);
      } catch (e) {
        // sem permissão ou sem vanity configurado, ignora
      }
    }
  } catch (err) {
    console.error(`⚠️ Não consegui cachear convites de "${guild.name}" (verifique se o bot tem permissão "Gerenciar Servidor"):`, err.message);
  }
}

// ---------- REGISTRO DO COMANDO /painel-tickets ----------
const commands = [
  new SlashCommandBuilder()
    .setName('painel-tickets')
    .setDescription('Envia o painel de abertura de tickets neste canal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('spoiler')
    .setDescription('Envia uma mensagem estilizada no canal.')
    .addStringOption((opt) =>
      opt
        .setName('mensagem')
        .setDescription('Texto que vai aparecer na mensagem.')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('topinvite')
    .setDescription('Mostra o ranking de quem mais convidou membros para o servidor.'),
].map((c) => c.toJSON());

client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  client.user.setActivity('!ping');

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comandos registrados (/painel-tickets, /spoiler, /topinvite).');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }

  // cacheia os convites de todos os servidores ao iniciar
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
  console.log('✅ Cache de convites carregado.');
});

// mantém o cache atualizado quando o bot entra em um novo servidor
client.on('guildCreate', (guild) => {
  cacheGuildInvites(guild);
});

// mantém o cache atualizado quando um convite é criado
client.on('inviteCreate', (invite) => {
  const map = inviteCache.get(invite.guild.id) || new Map();
  map.set(invite.code, {
    uses: invite.uses || 0,
    maxUses: invite.maxUses || 0,
    inviterId: invite.inviter ? invite.inviter.id : null,
    inviterTag: invite.inviter ? invite.inviter.tag : null,
  });
  inviteCache.set(invite.guild.id, map);
});

// mantém o cache atualizado quando um convite é deletado
client.on('inviteDelete', (invite) => {
  const map = inviteCache.get(invite.guild.id);
  if (map) map.delete(invite.code);
});

function sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
}

// ---------- COMANDO !ping ----------
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('🏓 pong');
  }
});

client.on('error', (err) => {
  console.error('Erro no cliente do Discord:', err);
});

// ---------- DETECTA QUEM ENTROU E POR QUAL CONVITE ----------
client.on('guildMemberAdd', async (member) => {
  const guild = member.guild;

  let newInvitesCollection = null;
  try {
    newInvitesCollection = await guild.invites.fetch();
  } catch (err) {
    console.error('⚠️ Não consegui buscar convites (verifique a permissão "Gerenciar Servidor"):', err.message);
  }

  const oldMap = inviteCache.get(guild.id) || new Map();
  let used = null;

  if (newInvitesCollection) {
    // 1) procura um convite cujo número de usos aumentou
    for (const invite of newInvitesCollection.values()) {
      const old = oldMap.get(invite.code);
      if (old && invite.uses > old.uses) {
        used = {
          code: invite.code,
          inviterId: invite.inviter ? invite.inviter.id : null,
          inviterTag: invite.inviter ? invite.inviter.tag : null,
        };
        break;
      }
      if (!old && invite.uses > 0) {
        used = {
          code: invite.code,
          inviterId: invite.inviter ? invite.inviter.id : null,
          inviterTag: invite.inviter ? invite.inviter.tag : null,
        };
        break;
      }
    }

    // 2) se não achou, pode ser um convite de 1 uso só que já foi deletado automaticamente
    if (!used) {
      for (const [code, data] of oldMap.entries()) {
        if (!newInvitesCollection.has(code) && data.maxUses && data.uses + 1 >= data.maxUses) {
          used = { code, inviterId: data.inviterId, inviterTag: data.inviterTag };
          break;
        }
      }
    }

    // atualiza o cache com o estado atual
    const newMap = new Map();
    newInvitesCollection.forEach((inv) => {
      newMap.set(inv.code, {
        uses: inv.uses || 0,
        maxUses: inv.maxUses || 0,
        inviterId: inv.inviter ? inv.inviter.id : null,
        inviterTag: inv.inviter ? inv.inviter.tag : null,
      });
    });
    inviteCache.set(guild.id, newMap);
  }

  // 3) checa se foi o link personalizado (vanity URL) do servidor
  if (!used && guild.vanityURLCode) {
    try {
      const vanity = await guild.fetchVanityData();
      const oldVanityUses = vanityCache.get(guild.id) || 0;
      if (vanity.uses > oldVanityUses) {
        used = { code: guild.vanityURLCode, inviterId: null, inviterTag: null, vanity: true };
      }
      vanityCache.set(guild.id, vanity.uses || 0);
    } catch (e) {
      // ignora se não conseguir checar
    }
  }

  // salva no histórico e soma +1 para quem convidou
  registerInvite(guild.id, used ? used.inviterId : null, member.id, used ? used.code : null);

  // envia o aviso no canal configurado
  const logChannel = guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
  if (!logChannel) return;

  const gData = ensureGuildData(guild.id);
  const totalInvites = used && used.inviterId ? gData.counts[used.inviterId] || 0 : 0;

  let inviterText;
  if (used && used.vanity) {
    inviterText = '🔗 Entrou pelo link personalizado do servidor (vanity URL)';
  } else if (used && used.inviterId) {
    inviterText = `<@${used.inviterId}> — já convidou **${totalInvites}** membro(s) no total`;
  } else {
    inviterText = '❓ Não foi possível identificar (convite expirado, integração OAuth, ou outro bot)';
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📥 Novo membro entrou!')
    .setDescription(
      `👤 **Membro:** ${member}\n` +
      `🔑 **Convite usado:** ${used && used.code ? `\`${used.code}\`` : 'Desconhecido'}\n` +
      `🙋 **Convidado por:** ${inviterText}`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `ID: ${member.id}` })
    .setTimestamp();

  logChannel.send({ embeds: [embed] }).catch((err) => {
    console.error('Erro ao enviar log de convite:', err.message);
  });
});

// ---------- INTERAÇÕES (slash command + botões) ----------
client.on('interactionCreate', async (interaction) => {
  // ---------- COMANDO: ENVIAR PAINEL ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'painel-tickets') {
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎟️  Central de Atendimento')
      .setDescription(
        '**Precisa falar com a gente? Você está no lugar certo!**\n' +
        'Escolha abaixo o motivo do seu ticket e nossa equipe vai te atender o mais rápido possível.\n' +
        '➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖'
      )
      .addFields(
        Object.values(TICKET_TYPES).map((t) => ({
          name: `${t.emoji}  ${t.label}`,
          value: t.description,
        }))
      )
      .setFooter({ text: 'Selecione uma opção abaixo 👇' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      Object.entries(TICKET_TYPES).map(([key, t]) =>
        new ButtonBuilder()
          .setCustomId(`open_ticket_${key}`)
          .setLabel(t.label)
          .setEmoji(t.emoji)
          .setStyle(t.style)
      )
    );

    const panelChannel = interaction.guild.channels.cache.get(TICKET_PANEL_CHANNEL_ID);
    if (!panelChannel) {
      return interaction.reply({
        content: '❌ Não encontrei o canal configurado para o painel de tickets. Verifique o ID configurado.',
        ephemeral: true,
      });
    }

    await panelChannel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ Painel enviado em ${panelChannel}!`, ephemeral: true });
    return;
  }

  // ---------- COMANDO: /spoiler ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'spoiler') {
    if (!interaction.member.roles.cache.has(SPOILER_ROLE_ID)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true,
      });
    }

    const texto = interaction.options.getString('mensagem', true);

    const spoilerEmbed = new EmbedBuilder()
      .setColor(0x2c2f33)
      .setDescription(`||${texto}||`)
      .setFooter({ text: '👁️ Clique para revelar' })
      .setTimestamp();

    await interaction.channel.send({ embeds: [spoilerEmbed] });
    await interaction.reply({ content: '✅ Mensagem enviada!', ephemeral: true });
    return;
  }

  // ---------- COMANDO: /topinvite ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'topinvite') {
    const gData = ensureGuildData(interaction.guild.id);
    const sorted = Object.entries(gData.counts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (sorted.length === 0) {
      return interaction.reply({
        content: '📭 Ainda não há nenhum registro de convites neste servidor.',
        ephemeral: true,
      });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = sorted.map(([userId, count], i) => {
      return `${medals[i]} <@${userId}> — **${count}** convite(s)`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Top Convites do Servidor')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ---------- BOTÃO: ABRIR TICKET ----------
  if (interaction.isButton() && interaction.customId.startsWith('open_ticket_')) {
    const typeKey = interaction.customId.replace('open_ticket_', '');
    const type = TICKET_TYPES[typeKey];
    if (!type) return;

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const userTag = sanitize(interaction.user.username);
    const channelName = `${typeKey}-${userTag}`;

    const existing = guild.channels.cache.find((c) => c.name === channelName);
    if (existing) {
      return interaction.editReply({
        content: `❌ Você já tem um ticket de **${type.label}** aberto: ${existing}`,
      });
    }

    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ];

    if (STAFF_ROLE_ID) {
      permissionOverwrites.push({
        id: STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID || null,
      permissionOverwrites,
    });

    const welcomeEmbed = new EmbedBuilder()
      .setColor(type.color)
      .setTitle(`${type.emoji}  Ticket de ${type.label}`)
      .setDescription(
        `**Olá, ${interaction.user}! 👋**\n` +
        `Seja bem-vindo ao seu ticket de **${type.label}**.\n` +
        `Nossa equipe foi notificada e vai te atender em breve.\n` +
        '➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖\n' +
        `**Enquanto isso:**\n` +
        `> 📝 Descreva seu motivo com o máximo de detalhes possível.\n` +
        `> ⏳ Tenha paciência, vamos te responder assim que possível!`
      )
      .addFields(
        { name: '📂 Categoria', value: type.label, inline: true },
        { name: '👤 Aberto por', value: `${interaction.user}`, inline: true }
      )
      .setFooter({ text: 'Use o botão abaixo para fechar quando finalizar 🔒' })
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Fechar Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    const staffMention = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : '';

    await channel.send({
      content: `${interaction.user} ${staffMention}`,
      embeds: [welcomeEmbed],
      components: [closeRow],
    });

    await interaction.editReply({
      content: `✅ Ticket criado: ${channel}`,
    });
    return;
  }

  // ---------- BOTÃO: FECHAR TICKET ----------
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    const isStaff = STAFF_ROLE_ID
      ? interaction.member.roles.cache.has(STAFF_ROLE_ID)
      : false;
    const isOwner = interaction.channel.permissionOverwrites.cache.has(interaction.user.id);

    if (!isStaff && !isOwner) {
      return interaction.reply({
        content: '❌ Você não tem permissão para fechar este ticket.',
        ephemeral: true,
      });
    }

    await interaction.reply('🔒 Fechando este ticket em 5 segundos...');

    if (process.env.LOG_CHANNEL_ID) {
      const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
      if (logChannel) {
        logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('🔒 Ticket fechado')
              .setDescription(`Canal: **${interaction.channel.name}**`)
              .addFields({ name: 'Fechado por', value: `${interaction.user.tag}` })
              .setColor(0x99aab5)
              .setTimestamp(),
          ],
        });
      }
    }

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 5000);
    return;
  }
});

client.login(process.env.TOKEN);

// ---------- SERVIDOR HTTP (necessário para o Render reconhecer como "Web Service") ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot está online!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
});
