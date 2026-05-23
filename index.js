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
const applications = new Map();
const processed = new Set();

function lock(id) {
    if (processed.has(id)) return true;
    processed.add(id);
    setTimeout(() => processed.delete(id), 120000);
    return false;
}


// =====================================================
// READY (MAJESTIC PANEL)
// =====================================================
client.once(Events.ClientReady, async () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    const channel = await client.channels.fetch("1458410655697731730");
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("🚀  ЗАЯВКИ В СЕМЬЮ DARKNESS")
        .setDescription(
`━━━━━━━━━━━━━━━━━━━━━━

Нажмите на кнопку ниже, чтобы подать заявку.

⏳ Время рассмотрения: 1–4 дня

🎓 Academy — обучение и развитие  
⚔️ Capture — боевой состав

━━━━━━━━━━━━━━━━━━━━━━

⚠️ Перед подачей заявки ознакомьтесь с правилами`
        )
        .setColor("#2b2d31");

    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("apply_menu")
            .setPlaceholder("🎯 Выберите тип заявки")
            .addOptions(
                { label: "Academy", value: "academy", emoji: "🎓" },
                { label: "Capture", value: "capture", emoji: "⚔️" }
            )
    );

    await channel.send({ embeds: [embed], components: [menu] });
});


// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {

    if (!i.guild) return;
    const config = SERVERS[i.guild.id];
    if (!config) return;

    // =========================
    // PANEL
    // =========================
    if (i.isStringSelectMenu() && i.customId === "apply_menu") {

        const type = i.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`apply_${type}`)
            .setTitle(type === "academy" ? "🎓 Academy Application" : "⚔️ Capture Application");

        const fields = [
            {
                id: "q1",
                label: "Ник | Имя | Статик | Возраст",
                placeholder: "Hugo | Женя | 21074 | 20",
                style: TextInputStyle.Short
            },
            {
                id: "q2",
                label: "Средний онлайн в день",
                placeholder: "Например: 4-6 часов",
                style: TextInputStyle.Short
            },
            {
                id: "q3",
                label: "В каких семьях были и почему ушли?",
                placeholder: "Перечислите семьи и причины ухода",
                style: TextInputStyle.Paragraph
            },
            {
                id: "q4",
                label: type === "academy"
                    ? "Как узнали о нас?"
                    : "Предоставьте откаты (GG / МП / капт)",
                placeholder: type === "academy"
                    ? "Например: на респе Ballas"
                    : "Откат 5+ минут",
                style: TextInputStyle.Paragraph
            }
        ];

        modal.addComponents(
            ...fields.map(f =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f.id)
                        .setLabel(f.label)
                        .setPlaceholder(f.placeholder)
                        .setStyle(f.style)
                )
            )
        );

        return i.showModal(modal);
    }

    // =========================
    // MODAL
    // =========================
    if (i.isModalSubmit() && i.customId.startsWith("apply_")) {

        const type = i.customId.replace("apply_", "");
        const nick = i.fields.getTextInputValue("q1");

        const data = {
            type,
            q1: i.fields.getTextInputValue("q1"),
            q2: i.fields.getTextInputValue("q2"),
            q3: i.fields.getTextInputValue("q3"),
            q4: i.fields.getTextInputValue("q4"),
            user: i.user
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
            .setTitle(`📨 ${type.toUpperCase()} APPLICATION`)
            .setDescription(
`━━━━━━━━━━━━━━━━━━━━━━

👤 ${data.q1}
⏱ ${data.q2}
📌 ${data.q3}
📎 ${data.q4}

━━━━━━━━━━━━━━━━━━━━━━

User: <@${i.user.id}>
`
            )
            .setColor("#2b2d31");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`acc_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rev_${i.user.id}`).setLabel("Рассмотрение").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`call_${i.user.id}`).setLabel("Обзвон").setStyle(ButtonStyle.Secondary),
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
