require('dotenv').config();
process.env.LANG = 'en_US.UTF-8';

const fs = require('fs');
const path = require('path');
const express = require('express');

const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');


// =====================
// 🌐 KEEP ALIVE
// =====================
const app = express();
app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000);


// =====================
// 🤖 CLIENT
// =====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});


// =====================
// 📌 CHANNELS
// =====================
const CHANNELS = {
    SCREEN: "1506712316425797704",
    AUDIT: "1506712342610837646",
    SALARY: "1506712365243306094"
};

const ROLE_TARGET = "1458410756453306490";

const ALLOWED = [
    "1471553901433192532",
    "1458192704524648701",
    "1458192781217370173"
];


// =====================
// 💾 DATABASE
// =====================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let salary = loadDB();


// =====================
// 🧠 ANTI DUPLICATE CACHE
// =====================
const processed = new Map();


// =====================
// READY
// =====================
client.once("ready", () => {
    console.log(`ONLINE: ${client.user.tag}`);
});


// =====================
// MESSAGE SYSTEM
// =====================
client.on("messageCreate", async (msg) => {

    if (msg.author.bot) return;

    // 💰 BALANCE
    if (msg.content === "/balance") {
        return msg.reply(`Баланс: ${salary[msg.author.id] || 0}`);
    }

    // 📸 SCREEN SYSTEM
    if (msg.channel.id === CHANNELS.SCREEN) {

        // 🔥 ANTI DUPLICATE FIX
        if (processed.has(msg.id)) return;
        processed.set(msg.id, true);
        setTimeout(() => processed.delete(msg.id), 60000);

        const att = msg.attachments?.first();
        if (!att?.url) return;

        try {
            const audit = await client.channels.fetch(CHANNELS.AUDIT);

            const embed = new EmbedBuilder()
                .setTitle("Скриншот")
                .setDescription(`От: ${msg.author.tag || "Unknown user"}`)
                .setImage(att.url)
                .setColor("Blue");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${msg.author.id}`)
                    .setLabel("Принять")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`reject_${msg.author.id}`)
                    .setLabel("Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            await audit.send({
                embeds: [embed],
                components: [row]
            });

            setTimeout(() => msg.delete().catch(() => {}), 2000);

        } catch (e) {
            console.log("Screen error:", e);
        }
    }
});


// =====================
// INTERACTIONS (/all + buttons)
// =====================
client.on("interactionCreate", async (i) => {

    // =====================
    // /all
    // =====================
    if (i.isChatInputCommand() && i.commandName === "all") {

        const has = i.member.roles.cache.some(r => ALLOWED.includes(r.id));
        if (!has) {
            return i.reply({ content: "Нет прав", ephemeral: true });
        }

        const text = i.options.getString("text");

        await i.deferReply({ ephemeral: true });

        const members = await i.guild.members.fetch();

        const users = [...members.values()].filter(m =>
            !m.user.bot && m.roles.cache.has(ROLE_TARGET)
        );

        const embed = new EmbedBuilder()
            .setTitle("Объявление")
            .setDescription(text)
            .setColor("Red");

        let sent = 0;
        let fail = 0;
        let index = 0;

        const CONCURRENCY = 5;

        async function worker() {
            while (index < users.length) {
                const m = users[index++];

                try {
                    await m.send({ embeds: [embed] });
                    sent++;
                } catch {
                    fail++;
                }

                await new Promise(r => setTimeout(r, 700));
            }
        }

        const tasks = Array.from({ length: CONCURRENCY }, worker);

        const progress = setInterval(() => {
            i.editReply(`📨 ${sent + fail}/${users.length} | OK ${sent} | FAIL ${fail}`)
                .catch(() => {});
        }, 3000);

        await Promise.all(tasks);

        clearInterval(progress);

        i.editReply(`ГОТОВО\nВсего: ${users.length}\nOK: ${sent}\nFAIL: ${fail}`)
            .catch(() => {});
    }


    // =====================
    // BUTTONS
    // =====================
    if (!i.isButton()) return;

    const [action, id] = i.customId.split("_");

    const audit = await client.channels.fetch(CHANNELS.SALARY);

    if (action === "accept") {
        salary[id] = (salary[id] || 0) + 10000;
        saveDB(salary);

        await i.update({
            content: `+10000 | Баланс: ${salary[id]}`,
            components: []
        });

        audit.send(`+10000 <@${id}>`);
    }

    if (action === "reject") {
        await i.update({
            content: "Отклонено",
            components: []
        });
    }
});


// =====================
// LOGIN
// =====================
client.login(process.env.TOKEN);
