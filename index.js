require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');

// ---------- CLIENTE DO DISCORD ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // necessário para ler o texto das mensagens (!ping)
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  client.user.setActivity('!ping');
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('🏓 pong');
  }
});

client.on('error', (err) => {
  console.error('Erro no cliente do Discord:', err);
});

client.login(process.env.TOKEN);

// ---------- SERVIDOR HTTP (necessário para o Render reconhecer o serviço como "Web Service") ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot está online!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
});
