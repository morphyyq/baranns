require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const fs = require("fs");
const path = require("path");
const express = require("express");

const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    AttachmentBuilder,
    Events
} = require("discord.js");


// =====================================================
// 🌐 KEEP ALIVE
// =====================================================
const app = express();

app.get("/", (_, res) => res.send("Bot Alive"));

app.listen(process.env.PORT || 3000, () => {
    console.log("[WEB] SERVER STARTED");
});


// =====================================================
// 🤖 CLIENT
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message]
});


// =====================================================
// 📌 CHANNELS
// =====================================================
const CHANNELS = {
    SCREEN: "1499706104345792512",
    AUDIT: "1500501911848095906",
    SALARY: "1500515048970522685"
};


// =====================================================
// 📌 ROLES
// =====================================================
const ROLE_TARGET = "1458410756453306490";

const ALLOWED_ROLES = [
    "1471553901433192532",
    "1458192704524648701",
    "1458192781217370173"
];


// =====================================================
// 💾 DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let salary = loadDB();


// =====================================================
// 🔒 ANTI DUPLICATE LOCK
// =====================================================
const processed = new Set();

function lockMessage(id) {
    if (processed.has(id)) return true;
    processed.add(id);

    setTimeout(() => processed.delete(id), 120000);
    return false;
}


// =====================================================
// 🛡 ERROR HANDLERS
// =====================================================
process.on("unhandledRejection", e => console.log("[UNHANDLED]", e));
process.on("uncaughtException", e => console.log("[CRASH]", e));


// =====================================================
// ✅ READY
// =====================================================
client.once(Events.ClientReady, () => {
    console.log(`[BOT] ONLINE: ${client.user.tag}`);
});


// =====================================================
// 📸 SCREEN SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {

        if (!msg?.author || msg.author.bot) return;
        if (msg.channel.id !== CHANNELS.SCREEN) return;

        // 🔒 LOCK FIRST
        if (lockMessage(msg.id)) return;

        // 📎 ONLY ONE IMAGE
        const att = msg.attachments
            .filter(a => a.contentType?.startsWith("image"))
            .first();

        if (!att) return;

        const audit = await client.channels.fetch(CHANNELS.AUDIT);
        if (!audit) return;

        const file = new AttachmentBuilder(att.url, {
            name: att.name || "image.png"
        });

        const embed = new EmbedBuilder()
            .setTitle("📸 Новый отчёт")
            .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
            .setColor("Blue")
            .setFooter({ text: `ID: ${msg.author.id}` })
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

        const auditMsg = await audit.send({
            embeds: [embed],
            files: [file],
            components: [row]
        });

        // 💀 delete original after 10 sec
        setTimeout(() => msg.delete().catch(() => {}), 10000);

    } catch (e) {
        console.log("[SCREEN ERROR]", e);
    }
});


// =====================================================
// ⚡ INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {

        // =================================================
        // 📢 /all
        // =================================================
        if (i.isChatInputCommand() && i.commandName === "all") {

            const allowed = i.member.roles.cache.some(r =>
                ALLOWED_ROLES.includes(r.id)
            );

            if (!allowed) {
                return i.reply({
                    content: "❌ Нет прав",
                    ephemeral: true
                });
            }

            const text = i.options.getString("text");

            await i.deferReply({ ephemeral: true });

            const members = await i.guild.members.fetch();

            const users = [...members.values()].filter(m =>
                !m.user.bot &&
                m.roles.cache.has(ROLE_TARGET)
            );

            const embed = new EmbedBuilder()
                .setTitle("📢 Объявление")
                .setDescription(text)
                .setColor("Red")
                .setTimestamp();

            let sent = 0;
            let failed = 0;
            let index = 0;

            const CONCURRENCY = 5;

            async function worker() {
                while (index < users.length) {
                    const user = users[index++];

                    try {
                        await user.send({ embeds: [embed] });
                        sent++;
                    } catch {
                        failed++;
                    }

                    await new Promise(r => setTimeout(r, 700));
                }
            }

            const workers = Array.from({ length: CONCURRENCY }, worker);

            const progress = setInterval(() => {
                i.editReply(`📨 ${sent + failed}/${users.length} | ✅ ${sent} | ❌ ${failed}`)
                    .catch(() => {});
            }, 3000);

            await Promise.all(workers);

            clearInterval(progress);

            return i.editReply(
                `✅ Готово\n📨 ${users.length}\n✅ ${sent}\n❌ ${failed}`
            );
        }


        // =================================================
        // 🔘 BUTTONS
        // =================================================
        if (!i.isButton()) return;

        const [action, userId] = i.customId.split("_");

        const salaryChannel = await client.channels.fetch(CHANNELS.SALARY);
        if (!salaryChannel) return;

        // =================================================
        // ✅ ACCEPT
        // =================================================
        if (action === "accept") {

            salary[userId] = (salary[userId] || 0) + 10000;
            saveDB(salary);

            const embed = new EmbedBuilder()
                .setTitle("💰 Зарплата выдана")
                .setDescription(`👤 <@${userId}>`)
                .addFields(
                    { name: "💵 +10000", value: "Выдано", inline: true },
                    { name: "📊 Баланс", value: `${salary[userId]}`, inline: true }
                )
                .setColor("Green")
                .setTimestamp();

            await i.update({
                content: `✅ Выдано <@${userId}>`,
                embeds: [],
                components: []
            });

            await salaryChannel.send({ embeds: [embed] });
        }

        // =================================================
        // ❌ REJECT
        // =================================================
        if (action === "reject") {

            await i.update({
                content: "❌ Отклонено",
                embeds: [],
                components: []
            });
        }

    } catch (e) {
        console.log("[INTERACTION ERROR]", e);
    }
});


// =====================================================
// 🔐 LOGIN
// =====================================================
client.login(process.env.TOKEN);
