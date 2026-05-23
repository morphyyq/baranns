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
    ChannelType,
    REST,
    Routes,
    SlashCommandBuilder
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
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417"
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
// DB
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
client.once(Events.ClientReady, async () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    const channel = await client.channels.fetch("1458410655697731730");
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("🚀 Заявки в семью Darkness")
        .setDescription(
`Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.

⏳ **Время рассмотрения заявки:** от 1 до 4 дней.

### 🎬 RP-Content состав ###
• Возможность дальнейшего развития в семье
• Откаты стрельбы — **не требуются**

### 🔥 Main состав ###
• Требуются откаты стрельбы от **5 минут GG**
или
• Откаты с любой МП/капта/массового мероприятия

━━━━━━━━━━━━━━

### ⚠️ Важно ознакомиться перед подачей заявки ###

• Заявки, оформленные без соблюдения правил (без откатов и т.д.), отклоняются моментально.

• Мы не принимаем детей, фриков и неадекватных людей.

• Заявки рассматриваются строго в порядке очереди. Не нужно флудить или торопить администрацию.

• У нас нет отдельных мест только под капты или MCL — вы вступаете в семью и участвуете во всём контенте.

• Если заявка была отклонена — это окончательное решение.

• КД на повторную подачу заявки — **2 дня**.

**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**`
        )
        .setColor("#2b2d31");

    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("apply_menu")
            .setPlaceholder("Выберите тип заявки")
            .addOptions(
                { label: "Academy", value: "academy", emoji: "🎓" },
                { label: "Capture", value: "capture", emoji: "⚔️" }
            )
    );

    await channel.send({ embeds: [embed], components: [menu] });
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

    if (msg.channel.id !== config.CHANNELS.SCREEN) return;
    if (lockMessage(msg.id)) return;

    const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
    if (!att) return;

    const audit = await client.channels.fetch(config.CHANNELS.AUDIT);

    const file = new AttachmentBuilder(att.url, { name: att.name || "img.png" });

    const embed = new EmbedBuilder()
        .setTitle("📸 Отчёт")
        .setDescription(`<@${msg.author.id}>`)
        .setImage(`attachment://${file.name}`)
        .setColor("Blue");

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${msg.author.id}`).setStyle(ButtonStyle.Success).setLabel("✔"),
        new ButtonBuilder().setCustomId(`reject_${msg.author.id}`).setStyle(ButtonStyle.Danger).setLabel("✖")
    );

    await audit.send({ embeds: [embed], files: [file], components: [row] });

    setTimeout(() => msg.delete().catch(() => {}), 10000);
});


// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {

    if (!i.guild) return;
    const config = SERVERS[i.guild.id];
    if (!config) return;

    // PANEL
    if (i.isChatInputCommand() && i.commandName === "panel") {

        const channel = await client.channels.fetch(config.CHANNELS.PANEL);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription("Выберите тип заявки ниже")
                    .setColor("#2b2d31")
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("apply_menu")
                        .setPlaceholder("Выберите заявку")
                        .addOptions(
                            { label: "Academy", value: "academy", emoji: "🎓" },
                            { label: "Capture", value: "capture", emoji: "⚔️" }
                        )
                )
            ]
        });

        return i.reply({ content: "✅ Панель отправлена", ephemeral: true });
    }

    // MENU
    if (i.isStringSelectMenu() && i.customId === "apply_menu") {

        const type = i.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`apply_modal_${type}`)
            .setTitle(type.toUpperCase());

        const fields = [
            ["q1", "Ник | Имя | Статик | Возраст"],
            ["q2", "Средний онлайн в день"],
            ["q3", "В каких семьях были и почему ушли?"],
            ["q4", type === "academy"
                ? "Как узнали о нас?"
                : "Предоставьте свои откаты (GG / МП / капт)"]
        ];

        modal.addComponents(
            ...fields.map(f =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f[0])
                        .setLabel(f[1])
                        .setStyle(f[0] === "q3" || f[0] === "q4"
                            ? TextInputStyle.Paragraph
                            : TextInputStyle.Short
                        )
                )
            )
        );

        return i.showModal(modal);
    }

    // MODAL
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
            .setTitle(`📨 ${type.toUpperCase()} ЗАЯВКА`)
            .setDescription(
`ВАШ СТАТИЧЕСКИЙ ID:
${data.q1}

СРЕДНИЙ ОНЛАЙН:
${data.q2}

ОПЫТ:
${data.q3}

ДОПОЛНИТЕЛЬНО:
${data.q4}

Пользователь: <@${i.user.id}>
Username: ${i.user.tag}`
            )
            .setColor("#2b2d31");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [row] });

        return i.reply({ content: "✅ Заявка отправлена", ephemeral: true });
    }
});


// LOGIN
client.login(process.env.TOKEN);
