require('dotenv').config();
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
  ],
  partials: [Partials.Channel],
});

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
    console.log('✅ Comando /painel-tickets registrado.');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }
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

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Painel enviado!', ephemeral: true });
    return;
  }

  // ---------- COMANDO: /spoiler ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'spoiler') {
    if (!process.env.OWNER_ID || interaction.user.id !== process.env.OWNER_ID) {
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

    if (process.env.STAFF_ROLE_ID) {
      permissionOverwrites.push({
        id: process.env.STAFF_ROLE_ID,
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
      parent: process.env.CATEGORY_ID || null,
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

    const staffMention = process.env.STAFF_ROLE_ID ? `<@&${process.env.STAFF_ROLE_ID}>` : '';

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
    const isStaff = process.env.STAFF_ROLE_ID
      ? interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID)
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
