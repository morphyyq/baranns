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
        ],

        ACADEMY_ROLES: [
            "1458485405769797848",
            "1458410756453306490"
        ],

        CAPTURE_ROLES: [
            "1458410756453306490",
            "1475114013611528274",
            "1475515378783223933"
        ]
    }
};


// =====================================================
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {

    try {
        return JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );
    }

    catch {
        return {};
    }
}

function saveDB(data) {

    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(data, null, 2)
    );
}

let salary = loadDB();


// =====================================================
// MEMORY
// =====================================================
const processed = new Set();
const applications = new Map();

function lockMessage(id) {

    if (processed.has(id)) {
        return true;
    }

    processed.add(id);

    setTimeout(() => {
        processed.delete(id);
    }, 120000);

    return false;
}


// =====================================================
// READY
// =====================================================
client.once(Events.ClientReady, async () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);
});


// =====================================================
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

    try {

        if (!msg.guild) return;
        if (msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;


        if (msg.content === "/balance") {

            return msg.reply({
                content: `💰 Баланс: ${salary[msg.author.id] || 0}`
            });
        }


        if (msg.channel.id !== config.CHANNELS.SCREEN) return;

        if (lockMessage(msg.id)) return;

        const att = msg.attachments
            .filter(a => a.contentType?.startsWith("image"))
            .first();

        if (!att) return;

        const audit = await client.channels.fetch(
            config.CHANNELS.AUDIT
        );

        if (!audit) return;

        const file = new AttachmentBuilder(
            att.url,
            { name: att.name || "screen.png" }
        );

        const embed = new EmbedBuilder()
            .setTitle("📸 Новый отчёт")
            .setDescription(
                `👤 Рекрут: <@${msg.author.id}>`
            )
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

        setTimeout(async () => {

            try {
                await msg.delete();
            } catch {}

        }, 10000);

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
        // PANEL
        // =================================================
        if (
            i.isChatInputCommand() &&
            i.commandName === "panel"
        ) {

            const channel = await client.channels.fetch(
                config.CHANNELS.PANEL
            );

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

• Заявки, оформленные без соблюдения правил отклоняются.

• Мы не принимаем детей, фриков и неадекватных людей.

• Заявки строго по очереди.

• КД на повторную подачу — 2 дня.

📌 Перед подачей заявки убедитесь, что Discord открыт`
                )
                .setColor("#2b2d31");

            // ===== FIX UI =====
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("apply_menu")
                    .setPlaceholder("Выберите тип заявки")
                    .addOptions(
                        {
                            label: "Academy",
                            description: "Ник, статик, имя/возраст, онлайн, семья",
                            value: "academy",
                            emoji: "🎓"
                        },
                        {
                            label: "Capture",
                            description: "Ник, статик, имя/возраст, онлайн, семья, откаты",
                            value: "capture",
                            emoji: "⚔️"
                        }
                    )
            );

            await channel.send({
                embeds: [embed],
                components: [menu]
            });

            return i.reply({
                content: "✅ Панель отправлена",
                ephemeral: true
            });
        }


        // =================================================
        // MENU
        // =================================================
        if (
            i.isStringSelectMenu() &&
            i.customId === "apply_menu"
        ) {

            const type = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Academy" : "Capture");

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
                    placeholder: "4-6 часов",
                    style: TextInputStyle.Short
                },
                {
                    id: "q3",
                    label: "В каких семьях были и почему ушли?",
                    placeholder: "Перечислите семьи",
                    style: TextInputStyle.Paragraph
                },
                {
                    id: "q4",
                    label: type === "academy"
                        ? "Как узнали о нас?"
                        : "Предоставьте откаты",

                    placeholder: type === "academy"
                        ? "на респе баллас"
                        : "Откат GG 5 минут",

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


        // =================================================
        // MODAL SUBMIT
        // =================================================
        if (
            i.isModalSubmit() &&
            i.customId.startsWith("apply_modal_")
        ) {

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

                name: `заявление-${nick.split("|")[0].trim().toLowerCase()}`,

                type: ChannelType.GuildText,

                parent: config.CHANNELS.CATEGORY,

                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(type === "academy" ? "🎓 Academy" : "⚔️ Capture")
                .setDescription(
`**Ник | Имя | Статик | Возраст**
${data.q1}

**Онлайн**
${data.q2}

**Семьи**
${data.q3}

**${type === "academy"
? "Как узнали"
: "Откаты"}**
${data.q4}

Пользователь: <@${i.user.id}>`
                )
                .setColor("#2b2d31");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`acc_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rev_${i.user.id}`).setLabel("Рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`call_${i.user.id}`).setLabel("Обзвон").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`rej_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({
                embeds: [embed],
                components: [row]
            });

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
