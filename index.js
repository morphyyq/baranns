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
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType
} = require("discord.js");


// =====================================================
// 🌐 KEEP ALIVE
// =====================================================
const app = express();
app.get("/", (_, res) => res.send("Bot Alive"));
app.listen(process.env.PORT || 3000, () => console.log("[WEB] SERVER STARTED"));


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
// 📌 SERVERS
// =====================================================
const SERVERS = {

    "1458190222042075251": {
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            APPLICATIONS: "1458410655697731730",
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417"
        },
        ROLE_TARGET: "1458410756453306490",
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173"
        ]
    }
};


// =====================================================
// 💾 DB
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
    catch { return {}; }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let salary = loadDB();


// =====================================================
// 🔒 LOCK
// =====================================================
const processed = new Set();
const applications = new Map();

function lockMessage(id) {
    if (processed.has(id)) return true;
    processed.add(id);
    setTimeout(() => processed.delete(id), 120000);
    return false;
}


// =====================================================
// READY
// =====================================================
client.once(Events.ClientReady, () => {
    console.log(`[BOT] ONLINE: ${client.user.tag}`);
});


// =====================================================
// 📸 SCREEN SYSTEM (ТВОЙ)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

    try {

        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        if (msg.content === "/balance") {
            return msg.reply({ content: `💰 Баланс: ${salary[msg.author.id] || 0}` });
        }

        if (!config.CHANNELS.SCREEN) return;
        if (msg.channel.id !== config.CHANNELS.SCREEN) return;

        if (lockMessage(msg.id)) return;

        const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!att) return;

        const audit = await client.channels.fetch(config.CHANNELS.AUDIT);

        const file = new AttachmentBuilder(att.url, { name: att.name || "img.png" });

        const embed = new EmbedBuilder()
            .setTitle("📸 Новый отчёт")
            .setDescription(`👤 <@${msg.author.id}>`)
            .setImage(`attachment://${file.name}`)
            .setColor("Blue");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`accept_${msg.author.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${msg.author.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await audit.send({ embeds: [embed], files: [file], components: [row] });

        setTimeout(() => msg.delete().catch(() => {}), 10000);

    } catch (e) {
        console.log("[SCREEN ERROR]", e);
    }
});


// =====================================================
// 📢 INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {

    try {

        if (!i.guild) return;
        const config = SERVERS[i.guild.id];
        if (!config) return;

        // =================================================
        // 📢 /all
        // =================================================
        if (i.isChatInputCommand() && i.commandName === "all") {

            if (!i.member.roles.cache.some(r => config.ALLOWED_ROLES.includes(r.id)))
                return i.reply({ content: "❌ Нет прав", ephemeral: true });

            const text = i.options.getString("text");
            await i.deferReply({ ephemeral: true });

            const members = await i.guild.members.fetch();
            const users = [...members.values()].filter(m =>
                !m.user.bot && m.roles.cache.has(config.ROLE_TARGET)
            );

            const embed = new EmbedBuilder()
                .setTitle("📢 Announcement")
                .setDescription(text)
                .setColor("Red");

            for (const user of users) {
                try { await user.send({ embeds: [embed] }); } catch {}
            }

            return i.editReply("✅ Отправлено");
        }

        // =================================================
        // 🧾 APPLICATION MENU
        // =================================================
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {

            const type = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type.toUpperCase());

            const fields = [
                ["q1", "Ник | Имя | Статик | Возраст"],
                ["q2", "Онлайн"],
                ["q3", "Опыт / семьи"],
                ["q4", type === "academy" ? "Как узнали?" : "Откаты"]
            ];

            const components = fields.map(f =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f[0])
                        .setLabel(f[1])
                        .setStyle(f[0] === "q3" || f[0] === "q4" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                )
            );

            modal.addComponents(...components);
            return i.showModal(modal);
        }

        // =================================================
        // 📦 MODAL SUBMIT
        // =================================================
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {

            const type = i.customId.replace("apply_modal_", "");
            const nick = i.fields.getTextInputValue("q1");

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                userId: i.user.id
            };

            applications.set(i.user.id, data);

            const category = await i.guild.channels.fetch(config.CHANNELS.CATEGORY);

            const channel = await i.guild.channels.create({
                name: `app-${nick.replace(/\s/g, "-")}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(`📨 ${type.toUpperCase()}`)
                .setDescription(
`👤 <@${i.user.id}>

${data.q1}
${data.q2}
${data.q3}
${data.q4}`
                )
                .setColor("Blue");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("✔").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("👀").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("📞").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("✖").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });

            return i.reply({ content: "✅ Отправлено", ephemeral: true });
        }

        // =================================================
        // 🔘 BUTTONS
        // =================================================
        if (i.isButton()) {

            const [action, , userId] = i.customId.split("_");

            if (!i.member.roles.cache.some(r => config.ALLOWED_ROLES.includes(r.id)))
                return;

            const data = applications.get(userId);
            if (!data) return;

            const audit = await i.guild.channels.fetch(config.CHANNELS.AUDIT_APP);

            // ACCEPT
            if (i.customId.startsWith("app_accept")) {

                const member = await i.guild.members.fetch(userId);

                const roles = data.type === "academy"
                    ? ["1458485405769797848", "1458410756453306490"]
                    : ["1458410756453306490", "1475114013611528274", "1475515378783223933"];

                await member.roles.add(roles);

                await audit.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("ПРИНЯТ")
                            .setColor("Green")
                            .setDescription(`<@${userId}>`)
                    ]
                });

                return i.channel.delete().catch(() => {});
            }

            // REJECT
            if (i.customId.startsWith("app_reject")) {

                await audit.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("ОТКЛОНЕН")
                            .setColor("Red")
                            .setDescription(`<@${userId}>`)
                    ]
                });

                return i.channel.delete().catch(() => {});
            }

            // REVIEW
            if (i.customId.startsWith("app_review")) {
                return i.reply({ content: `👀 На рассмотрении <@${i.user.id}>` });
            }

            // CALL
            if (i.customId.startsWith("app_call")) {

                const menu = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`voice_select_${userId}`)
                        .setChannelTypes(ChannelType.GuildVoice)
                        .setPlaceholder("Выбор войса")
                );

                return i.reply({ components: [menu], ephemeral: true });
            }
        }

        // =================================================
        // 🎧 VOICE SELECT
        // =================================================
        if (i.isChannelSelectMenu() && i.customId.startsWith("voice_select_")) {

            const userId = i.customId.split("_")[2];
            const voice = await i.guild.channels.fetch(i.values[0]);

            const audit = await i.guild.channels.fetch(config.CHANNELS.AUDIT_APP);

            await audit.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("📞 ОБЗВОН")
                        .setDescription(`<@${userId}> → ${voice}`)
                ]
            });

            return i.update({ content: "✔ OK", components: [] });
        }

    } catch (e) {
        console.log("[INTERACTION ERROR]", e);
    }
});


// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
