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
app.get("/", (_, res) => res.send("Bot Alive"));
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
    partials: [Partials.Channel, Partials.Message]
});


// =====================================================
// CONFIG
// =====================================================
const SERVERS = {
    "1458190222042075251": {
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            PANEL: "1458410655697731730",
            CATEGORY: "1458410646956806196"
        },

        ROLE_TARGET: "1458410756453306490",

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
    try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
    catch { return {}; }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let salary = loadDB();


// =====================================================
// MEMORY LOCK
// =====================================================
const processed = new Set();
const applications = new Map();

function lock(id) {
    if (processed.has(id)) return true;
    processed.add(id);
    setTimeout(() => processed.delete(id), 120000);
    return false;
}


// =====================================================
// PANEL (MAJESTIC STYLE)
// =====================================================
client.once(Events.ClientReady, async () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    const channel = await client.channels.fetch(SERVERS["1458190222042075251"].CHANNELS.PANEL);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("🚀 Заявки в семью Darkness")
        .setDescription(`🚀 Заявки в семью Darkness
Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.

⏳ Время рассмотрения заявки: от 1 до 4 дней.

🎬 RP-Content состав
• Возможность дальнейшего развития в семье
• Откаты стрельбы — не требуются

🔥 Main состав
• Требуются откаты стрельбы от 5 минут GG
или
• Откаты с любой МП/капта/массового мероприятия

━━━━━━━━━━━━━━

⚠️ Важно ознакомиться перед подачей заявки
• Заявки, оформленные без соблюдения правил (без откатов и т.д.), отклоняются моментально.

• Мы не принимаем детей, фриков и неадекватных людей.

• Заявки рассматриваются строго в порядке очереди. Не нужно флудить или торопить администрацию.

• У нас нет отдельных мест только под капты или MCL — вы вступаете в семью и участвуете во всём контенте.

• Если заявка была отклонена — это окончательное решение.

• КД на повторную подачу заявки — 2 дня.

📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.`)
        .setColor("#2b2d31");

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("apply_academy")
            .setLabel("🎓 Academy")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("apply_capture")
            .setLabel("⚔️ Capture")
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
});


// =====================================================
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

    if (!msg.guild || msg.author.bot) return;

    const config = SERVERS[msg.guild.id];
    if (!config) return;

    if (msg.content === "/balance") {
        return msg.reply({ content: `💰 Баланс: ${salary[msg.author.id] || 0}` });
    }

    if (msg.channel.id === config.CHANNELS.SCREEN) {

        if (lock(msg.id)) return;

        const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!att) return;

        const audit = await client.channels.fetch(config.CHANNELS.AUDIT);

        const file = new AttachmentBuilder(att.url, {
            name: att.name || "screen.png"
        });

        const embed = new EmbedBuilder()
            .setTitle("📸 РЕКРУТ ОТЧЁТ")
            .setDescription(`👤 <@${msg.author.id}>`)
            .setImage(`attachment://${file.name}`)
            .setColor("Blue");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`accept_${msg.author.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${msg.author.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await audit.send({ embeds: [embed], files: [file], components: [row] });

        setTimeout(() => msg.delete().catch(() => {}), 10000);
    }
});


// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {

    if (!i.guild) return;
    const config = SERVERS[i.guild.id];
    if (!config) return;

    // =========================
    // BUTTON PANEL -> MODAL
    // =========================
    if (i.isButton() && i.customId.startsWith("apply_")) {

        const type = i.customId.replace("apply_", "");

        const modal = new ModalBuilder()
            .setCustomId(`modal_${type}`)
            .setTitle(type === "academy" ? "Academy Application" : "Capture Application");

        const fields = [
            { id: "q1", label: "Ник | Имя | Статик | Возраст", placeholder: "Hugo | Женя | 21074 | 20" },
            { id: "q2", label: "Средний онлайн в день", placeholder: "4-6 часов" },
            { id: "q3", label: "Семьи и причины ухода", placeholder: "Перечислите" },
            { id: "q4", label: type === "academy" ? "Как узнали о нас?" : "Откаты", placeholder: "..." }
        ];

        modal.addComponents(
            ...fields.map(f =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f.id)
                        .setLabel(f.label)
                        .setPlaceholder(f.placeholder)
                        .setStyle(TextInputStyle.Paragraph)
                )
            )
        );

        return i.showModal(modal);
    }

    // =========================
    // MODAL SUBMIT
    // =========================
    if (i.isModalSubmit() && i.customId.startsWith("modal_")) {

        const type = i.customId.replace("modal_", "");
        const nick = i.fields.getTextInputValue("q1");

        const data = {
            q1: i.fields.getTextInputValue("q1"),
            q2: i.fields.getTextInputValue("q2"),
            q3: i.fields.getTextInputValue("q3"),
            q4: i.fields.getTextInputValue("q4"),
            user: i.user
        };

        const channel = await i.guild.channels.create({
            name: `app-${nick.replace(/\s/g, "-")}`,
            type: ChannelType.GuildText,
            parent: config.CHANNELS.CATEGORY,
            permissionOverwrites: [
                { id: i.guild.id, deny: ["ViewChannel"] },
                { id: i.user.id, allow: ["ViewChannel", "SendMessages"] }
            ]
        });

        const embed = new EmbedBuilder()
            .setTitle(`📨 ${type.toUpperCase()} APPLICATION`)
            .setDescription(`👤 <@${i.user.id}>

${data.q1}
${data.q2}
${data.q3}
${data.q4}`)
            .setColor("#2b2d31");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`acc_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rej_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [row] });

        return i.reply({ content: "✅ Заявка отправлена", ephemeral: true });
    }
});


// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
