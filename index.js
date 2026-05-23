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
// KEEP ALIVE (RENDER)
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
// SERVERS CONFIG
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
// DATABASE (SALARY)
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
// READY - PANEL POST
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

### 🎬 RP-Content ###
• Развитие в семье
• Откаты не требуются

### 🔥 Main ###
• Откаты от 5 минут GG или МП

━━━━━━━━━━━━━━

⚠️ Ознакомьтесь с правилами перед подачей`
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
// MESSAGE SYSTEM (SCREEN + SALARY + /balance)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

    if (!msg.guild || msg.author.bot) return;

    const config = SERVERS[msg.guild.id];
    if (!config) return;

    // =========================
    // BALANCE
    // =========================
    if (msg.content === "/balance") {
        return msg.reply({
            content: `💰 Ваш баланс: ${salary[msg.author.id] || 0}`
        });
    }

    // =========================
    // SCREEN SYSTEM (RECRUIT)
    // =========================
    if (msg.channel.id === config.CHANNELS.SCREEN) {

        if (lockMessage(msg.id)) return;

        const att = msg.attachments
            .filter(a => a.contentType?.startsWith("image"))
            .first();

        if (!att) return;

        const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
        if (!audit) return;

        const file = new AttachmentBuilder(att.url, {
            name: att.name || "screen.png"
        });

        const embed = new EmbedBuilder()
            .setTitle("📸 РЕКРУТ ОТЧЁТ")
            .setDescription(`👤 <@${msg.author.id}>`)
            .setImage(`attachment://${file.name}`)
            .setColor("Blue")
            .setFooter({ text: `ID: ${msg.author.id}` });

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
    // /ALL SYSTEM
    // =========================
    if (i.isChatInputCommand() && i.commandName === "all") {

        const allowed = i.member.roles.cache.some(r =>
            config.ALLOWED_ROLES.includes(r.id)
        );

        if (!allowed) {
            return i.reply({ content: "❌ Нет прав", ephemeral: true });
        }

        const text = i.options.getString("text");

        await i.deferReply({ ephemeral: true });

        const members = await i.guild.members.fetch();

        const users = [...members.values()].filter(m =>
            !m.user.bot && m.roles.cache.has(config.ROLE_TARGET)
        );

        const embed = new EmbedBuilder()
            .setTitle("📢 ОБЪЯВЛЕНИЕ")
            .setDescription(text)
            .setColor("Red");

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
            i.editReply(`📨 ${sent + failed}/${users.length} | ✅ ${sent} | ❌ ${failed}`);
        }, 3000);

        await Promise.all(workers);

        clearInterval(progress);

        return i.editReply(
            `✅ Готово\n📨 ${users.length}\n✅ ${sent}\n❌ ${failed}`
        );
    }

    // =========================
    // APPLY MENU -> MODAL
    // =========================
    if (i.isStringSelectMenu() && i.customId === "apply_menu") {

        const type = i.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`apply_${type}`)
            .setTitle(type.toUpperCase());

        const fields = [
            { id: "q1", label: "Ник | Имя | Статик | Возраст", placeholder: "Hugo | Женя | 21074 | 20" },
            { id: "q2", label: "Средний онлайн", placeholder: "4-6 часов" },
            { id: "q3", label: "Семьи и причины ухода", placeholder: "Перечислите" },
            { id: "q4", label: type === "academy" ? "Как узнали?" : "Откаты", placeholder: "..." }
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
    if (i.isModalSubmit() && i.customId.startsWith("apply_")) {

        const type = i.customId.replace("apply_", "");
        const nick = i.fields.getTextInputValue("q1");

        const data = {
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
            .setTitle(`📨 ${type.toUpperCase()} ЗАЯВКА`)
            .setDescription(
`👤 ${i.user.tag}

${data.q1}
${data.q2}
${data.q3}
${data.q4}`
            )
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
