require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');


// =====================================================
// SLASH COMMANDS
// =====================================================
const commands = [

    // =================================================
    // /all
    // =================================================
    new SlashCommandBuilder()
        .setName('all')
        .setDescription('Отправить сообщение всем в ЛС')
        .addStringOption(option =>
            option
                .setName('text')
                .setDescription('Сообщение')
                .setRequired(true)
        ),


    // =================================================
    // /panel
    // =================================================
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Отправить панель заявок в семью')

].map(cmd => cmd.toJSON());


// =====================================================
// REST
// =====================================================
const rest = new REST({
    version: '10'
}).setToken(process.env.TOKEN);


// =====================================================
// DEPLOY
// =====================================================
(async () => {

    try {

        console.log('⏳ Registering slash commands...');


        // =============================================
        // GLOBAL COMMANDS
        // =============================================
        await rest.put(

            Routes.applicationCommands(
                process.env.CLIENT_ID
            ),

            {
                body: commands
            }
        );


        console.log('✅ Slash commands registered');

    }

    catch (err) {

        console.log('❌ DEPLOY ERROR');
        console.log(err);
    }

})();
