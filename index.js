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
    EmbedBuilder,
    Events
} = require('discord.js');


// =====================
// 🌐 KEEP ALIVE (Render)
// =====================
const app = express();
app.get("/", (_, res) => res.send("Bot is alive"));
app.listen(process.env.PORT || 3000);


// =====================
// 🤖 BOT
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
// 📌 CHANNELS (ТВОИ НОВЫЕ)
// =====================
const CHANNELS = {
    SCREEN: "1499706104345792512", // 📸 скрины
    AUDIT: "1500501911848095906",  // 🛡 аудит
    SALARY: "1500515048970522685"  // 💰 зарплата
};

const ROLE_TARGET = "1458410756453306490";

const ALLOWED_ROLES = [
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
// 🧠 ANTI DUPLICATE SYSTEM
// =====================
const processed = new Map();

function lock(id) {
    if (processed.has(id)) return true;
    processed.set(id, Date.now());

    setTimeout(() => processed.delete(id), 60000);
    return false;
}


// =====================
// READY
// =====================
client.once(Events.ClientReady, () => {
    console.log(`[BOT] ONLINE: ${client.user.tag}`);
    console.log("📸 SCREEN CHANNEL:", CHANNELS.SCREEN);
});


// =====================
// MESSAGE CREATE (SCREENS)
// =====================
client.on(Events.MessageCreate, async (msg) => {

    if (msg.author.bot) return;

    // 💰 BALANCE
    if (msg.content === "/balance") {
        return msg.reply(`Баланс: ${salary[msg.author.id] || 0}`);
    }

    // 📸 SCREEN SYSTEM
    if (msg.channel.id !== CHANNELS.SCREEN) return;

    if (lock(msg.id)) return;

    const att = msg.attachments?.first();
    if (!att?.url) return;

    try {
        const audit = await client.channels.fetch(CHANNELS.AUDIT);

        const embed = new EmbedBuilder()
            .setTitle("📸 Новый скриншот")
            .setDescription(`👤 От: <@${msg.author.id}>`)
            .setImage(att.url)
            .setColor("Blue")
            .setTimestamp();

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

        setTimeout(() => msg.delete().catch(() => {}), 1500);

    } catch (e) {
        console.log("SCREEN ERROR:", e.message);
    }
});


// =====================
// INTERACTIONS
// =====================
client.on(Events.InteractionCreate, async (i) => {

    // =====================
    // /all
    // =====================
    if (i.isChatInputCommand() && i.commandName === "all") {

        const allowed = i.member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
        if (!allowed) {
            return i.reply({ content: "❌ Нет прав", ephemeral: true });
        }

        const text = i.options.getString("text");

        await i.deferReply({ ephemeral: true });

        const members = await i.guild.members.fetch();

        const users = [...members.values()].filter(m =>
            !m.user.bot && m.roles.cache.has(ROLE_TARGET)
        );

        const embed = new EmbedBuilder()
            .setTitle("📢 Объявление")
            .setDescription(text)
            .setColor("Red")
            .setTimestamp();

        let sent = 0;
        let fail = 0;
        let index = 0;

        const CONCURRENCY = 5;

        async function worker() {
            while (index < users.length) {
                const u = users[index++];

                try {
                    await u.send({ embeds: [embed] });
                    sent++;
                } catch {
                    fail++;
                }

                await new Promise(r => setTimeout(r, 600));
            }
        }

        const tasks = Array.from({ length: CONCURRENCY }, worker);

        const progress = setInterval(() => {
            i.editReply(`📨 ${sent + fail}/${users.length} | OK ${sent} | FAIL ${fail}`)
                .catch(() => {});
        }, 3000);

        await Promise.all(tasks);

        clearInterval(progress);

        return i.editReply(`✅ ГОТОВО\nВсего: ${users.length}\nOK: ${sent}\nFAIL: ${fail}`);
    }


    // =====================
    // BUTTONS (ACCEPT / REJECT)
    // =====================
    if (!i.isButton()) return;

    const [action, id] = i.customId.split("_");

    const salaryChannel = await client.channels.fetch(CHANNELS.SALARY);

    if (action === "accept") {

        salary[id] = (salary[id] || 0) + 10000;
        saveDB(salary);

        const embed = new EmbedBuilder()
            .setTitle("💰 Зарплата выдана")
            .setDescription(`👤 <@${id}>`)
            .addFields(
                { name: "Сумма", value: "+10000", inline: true },
                { name: "Баланс", value: `${salary[id]}`, inline: true }
            )
            .setColor("Green")
            .setTimestamp();

        await i.update({
            content: `💰 +10000 выдано <@${id}>`,
            components: []
        });

        salaryChannel.send({ embeds: [embed] });
    }

    if (action === "reject") {
        await i.update({
            content: "❌ Отклонено",
            components: []
        });
    }
});


// =====================
// LOGIN
// =====================
client.login(process.env.TOKEN);
