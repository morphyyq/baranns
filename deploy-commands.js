require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('all')
        .setDescription('Отправить сообщение всем в ЛС')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Сообщение')
                .setRequired(true)
        ),

    // ✅ ДОБАВИЛИ PANEL
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Отправить панель заявок в семью')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('⏳ Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Slash commands registered');
    } catch (err) {
        console.log(err);
    }
})();
