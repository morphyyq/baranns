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
    ChannelType
} = require("discord.js");

// =====================================================
// KEEP ALIVE
// =====================================================
const app = express();

app.get("/", (_, res) => {
    res.send("Bot Alive");
});

app.listen(process.env.PORT || 3000);

// =====================================================
// CLIENT
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Channel,
        Partials.Message
    ]
});

// =====================================================
// CONFIG
// =====================================================
const SERVERS = {
    "1458190222042075251": {
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            PANEL: "1458410655697731730",
            CATEGORY: "1458410646956806196"
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ]
    }
};

// =====================================================
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        const raw = fs.readFileSync(DB_FILE, "utf8");
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let salary = loadDB();

// =====================================================
// MEMORY
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
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // BALANCE (работает везде)
        if (msg.content === "/balance") {
            return msg.reply({
                content: `💰 Баланс: ${salary[msg.author.id] || 0}`
            });
        }

        // SCREEN SYSTEM
        if (msg.channel.id !== config.CHANNELS.SCREEN) return;
        if (lockMessage(msg.id)) return;

        const att = msg.attachments.find(a =>
            a.contentType?.startsWith("image")
        );

        if (!att) return;

        const audit = msg.guild.channels.cache.get(config.CHANNELS.AUDIT);
        if (!audit) return;

        const file = new AttachmentBuilder(att.url, {
            name: att.name || "screen.png"
        });

        const embed = new EmbedBuilder()
            .setTitle("📸 Новый отчёт")
            .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
            .setImage(`attachment://${file.name}`)
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
            files: [file],
            components: [row]
        });

        setTimeout(() => msg.delete().catch(() => {}), 10000);

    } catch (e) {
        console.log("[MESSAGE ERROR]", e);
    }
});

// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;

        const config = SERVERS[i.guild.id];
        if (!config) return;

        // =================================================
        // PANEL COMMAND
        // =================================================
        if (i.isChatInputCommand() && i.commandName === "panel") {

            const channel = msg.guild.channels.cache.get(config.CHANNELS.PANEL);

            const embed = new EmbedBuilder()
                .setTitle("🚀 Заявки")
                .setDescription("Выберите тип заявки")
                .setColor("#2b2d31");

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("apply_menu")
                    .setPlaceholder("Выберите тип заявки")
                    .addOptions(
                        {
                            label: "Academy",
                            value: "academy",
                            emoji: "🎓"
                        },
                        {
                            label: "Capture",
                            value: "capture",
                            emoji: "⚔️"
                        }
                    )
            );

            await channel.send({
                embeds: [embed],
                components: [menu]
            });

            return i.reply({ content: "✅ Панель отправлена", ephemeral: true });
        }

        // =================================================
        // MENU
        // =================================================
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {

            const type = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Academy" : "Capture");

            const fields = [
                ["q1", "Ник | Имя | Статик | Возраст"],
                ["q2", "Средний онлайн"],
                ["q3", "Семьи"],
                ["q4", type === "academy" ? "Как узнали?" : "Откаты"]
            ];

            modal.addComponents(
                ...fields.map(([id, label]) =>
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId(id)
                            .setLabel(label)
                            .setStyle(TextInputStyle.Short)
                    )
                )
            );

            return i.showModal(modal);
        }

        // =================================================
        // MODAL SUBMIT
        // =================================================
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {

            const type = i.customId.replace("apply_modal_", "");

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                userId: i.user.id
            };

            applications.set(i.user.id, data);

            const channel = await i.guild.channels.create({
                name: `заявление-${i.user.username.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    {
                        id: i.guild.id,
                        deny: ["ViewChannel"]
                    },
                    {
                        id: i.user.id,
                        allow: ["ViewChannel", "SendMessages"]
                    },
                    ...config.ALLOWED_ROLES.map(role => ({
                        id: role,
                        allow: ["ViewChannel", "SendMessages"]
                    }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(type === "academy" ? "🎓 Academy" : "⚔️ Capture")
                .setDescription(
`**${data.q1}
${data.q2}
${data.q3}
${data.q4}

Пользователь: <@${i.user.id}>`
                )
                .setColor("#2b2d31");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`app_accept_${i.user.id}`)
                    .setLabel("Принять")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`app_reject_${i.user.id}`)
                    .setLabel("Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });

            return i.reply({
                content: "✅ Заявка отправлена",
                ephemeral: true
            });
        }

    } catch (e) {
        console.log("[INTERACTION ERROR]", e);
    }
});

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
