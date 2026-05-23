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


// =====================================================
// 🌐 KEEP ALIVE
// =====================================================
const app = express();

app.get("/", (_, res) => {
    res.send("Bot Alive");
});

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
    partials: [Partials.Channel]
});


// =====================================================
// 📌 CHANNELS
// =====================================================
const CHANNELS = {
    SCREEN: "1499706104345792512", // 📸 канал скринов
    AUDIT: "1500501911848095906",  // 🛡 аудит
    SALARY: "1500515048970522685"  // 💰 зарплаты
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
// 🧠 ANTI DUPLICATE
// =====================================================
const processed = new Set();

function isProcessed(id) {

    if (processed.has(id)) {
        return true;
    }

    processed.add(id);

    setTimeout(() => {
        processed.delete(id);
    }, 60000);

    return false;
}


// =====================================================
// 🛡 ANTI CRASH
// =====================================================
process.on("unhandledRejection", (err) => {
    console.log("[ERROR] Unhandled Rejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
    console.log("[ERROR] Uncaught Exception:", err?.message || err);
});

process.on("uncaughtExceptionMonitor", (err) => {
    console.log("[ERROR] Monitor:", err?.message || err);
});


// =====================================================
// ✅ READY
// =====================================================
client.once(Events.ClientReady, () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    console.log(`[SCREEN CHANNEL] ${CHANNELS.SCREEN}`);
    console.log(`[AUDIT CHANNEL] ${CHANNELS.AUDIT}`);
    console.log(`[SALARY CHANNEL] ${CHANNELS.SALARY}`);
});


// =====================================================
// 📸 SCREEN SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

    try {

        // =========================================
        // IGNORE BOTS
        // =========================================
        if (msg.author.bot) return;


        // =========================================
        // 💰 BALANCE
        // =========================================
        if (msg.content === "/balance") {

            return msg.reply({
                content: `💰 Ваш баланс: ${salary[msg.author.id] || 0}`
            });
        }


        // =========================================
        // 📸 ONLY SCREEN CHANNEL
        // =========================================
        if (msg.channel.id !== CHANNELS.SCREEN) return;


        // =========================================
        // 🧠 ANTI DUPLICATE
        // =========================================
        if (isProcessed(msg.id)) return;


        // =========================================
        // 📎 ATTACHMENT
        // =========================================
        const att = msg.attachments?.first();

        if (!att?.url) return;


        // =========================================
        // 🖼 ONLY IMAGES
        // =========================================
        if (!att.contentType?.startsWith("image")) return;


        // =========================================
        // 🛡 AUDIT CHANNEL
        // =========================================
        const audit = await client.channels.fetch(CHANNELS.AUDIT);

        if (!audit) return;


        // =========================================
        // 🎨 EMBED
        // =========================================
        const embed = new EmbedBuilder()
            .setTitle("📸 Новый скриншот")
            .setDescription(`👤 Отправил: <@${msg.author.id}>`)
            .setImage(att.url)
            .setColor("Blue")
            .setFooter({
                text: `ID: ${msg.author.id}`
            })
            .setTimestamp();


        // =========================================
        // 🔘 BUTTONS
        // =========================================
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


        // =========================================
        // 📤 SEND
        // =========================================
        await audit.send({
            embeds: [embed],
            components: [row]
        });


        // =========================================
        // 🧹 DELETE ORIGINAL AFTER 15 SEC
        // =========================================
        setTimeout(async () => {

            try {
                await msg.delete();
            } catch {}

        }, 15000);


    } catch (e) {

        console.log("[SCREEN ERROR]", e?.message || e);
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

            const allowed = i.member.roles.cache.some(role =>
                ALLOWED_ROLES.includes(role.id)
            );

            if (!allowed) {

                return i.reply({
                    content: "❌ Нет прав",
                    ephemeral: true
                });
            }

            const text = i.options.getString("text");

            await i.deferReply({
                ephemeral: true
            });

            const members = await i.guild.members.fetch();

            const users = [...members.values()].filter(member =>
                !member.user.bot &&
                member.roles.cache.has(ROLE_TARGET)
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

                        await user.send({
                            embeds: [embed]
                        });

                        sent++;

                    } catch {

                        failed++;
                    }

                    await new Promise(resolve =>
                        setTimeout(resolve, 700)
                    );
                }
            }


            const workers = Array.from(
                { length: CONCURRENCY },
                worker
            );


            // =========================================
            // 📊 LIVE PROGRESS
            // =========================================
            const progress = setInterval(() => {

                i.editReply(
                    `📨 ${sent + failed}/${users.length} | ✅ ${sent} | ❌ ${failed}`
                ).catch(() => {});

            }, 3000);


            await Promise.all(workers);

            clearInterval(progress);


            // =========================================
            // ✅ FINAL
            // =========================================
            return i.editReply(
                `✅ Рассылка завершена\n\n📨 Всего: ${users.length}\n✅ Успешно: ${sent}\n❌ Ошибки: ${failed}`
            );
        }


        // =================================================
        // 🔘 BUTTONS
        // =================================================
        if (!i.isButton()) return;

        const [action, id] = i.customId.split("_");

        const salaryChannel = await client.channels.fetch(CHANNELS.SALARY);

        if (!salaryChannel) return;


        // =================================================
        // ✅ ACCEPT
        // =================================================
        if (action === "accept") {

            salary[id] = (salary[id] || 0) + 10000;

            saveDB(salary);

            const embed = new EmbedBuilder()
                .setTitle("💰 Зарплата выдана")
                .setDescription(`👤 Пользователь: <@${id}>`)
                .addFields(
                    {
                        name: "💵 Сумма",
                        value: "+10000",
                        inline: true
                    },
                    {
                        name: "📊 Баланс",
                        value: `${salary[id]}`,
                        inline: true
                    }
                )
                .setColor("Green")
                .setTimestamp();


            await i.update({
                content: `✅ Зарплата выдана <@${id}>`,
                embeds: [],
                components: []
            });


            await salaryChannel.send({
                embeds: [embed]
            });
        }


        // =================================================
        // ❌ REJECT
        // =================================================
        if (action === "reject") {

            await i.update({
                content: "❌ Скриншот отклонён",
                embeds: [],
                components: []
            });
        }

    } catch (e) {

        console.log("[INTERACTION ERROR]", e?.message || e);
    }
});


// =====================================================
// 🔐 LOGIN
// =====================================================
client.login(process.env.TOKEN);
