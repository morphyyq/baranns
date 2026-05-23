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
// 📌 CONFIG
// =====================================================
const SERVERS = {

    "1458190222042075251": {
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            APPLICATION_PANEL: "1458410655697731730",
            APPLICATION_CATEGORY: "1458410646956806196",
            APPLICATION_AUDIT: "1464575195418460417"
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        ROLE_TARGET: "1458410756453306490"
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

    // auto panel (RP UI)
    const channel = await client.channels.fetch("1458410655697731730");

    if (channel) {
        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(
`Нажмите ниже чтобы подать заявку

🎓 Academy — обучение
⚔️ Capture — боевой состав

⏳ 1–4 дня рассмотрение`
                    )
                    .setColor("#2b2d31")
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("apply_menu")
                        .setPlaceholder("Выберите тип заявки")
                        .addOptions(
                            { label: "Academy", value: "academy", emoji: "🎓" },
                            { label: "Capture", value: "capture", emoji: "⚔️" }
                        )
                )
            ]
        });
    }
});


// =====================================================
// MESSAGE SYSTEM (SCREEN + BALANCE)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {

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
        .setTitle("📸 Отчёт")
        .setDescription(`<@${msg.author.id}>`)
        .setImage(`attachment://${file.name}`)
        .setColor("Blue");

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${msg.author.id}`).setLabel("✔").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${msg.author.id}`).setLabel("✖").setStyle(ButtonStyle.Danger)
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

    // =================================================
    // /PANEL COMMAND
    // =================================================
    if (i.isChatInputCommand() && i.commandName === "panel") {

        const channel = await client.channels.fetch(config.CHANNELS.APPLICATION_PANEL);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🚀 Darkness Recruitment")
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

    // =================================================
    // SELECT MENU
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

        modal.addComponents(
            ...fields.map(f =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f[0])
                        .setLabel(f[1])
                        .setStyle(f[0] === "q3" || f[0] === "q4" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                )
            )
        );

        return i.showModal(modal);
    }

    // =================================================
    // MODAL
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

        const channel = await i.guild.channels.create({
            name: `app-${nick.replace(/\s/g, "-")}`,
            type: ChannelType.GuildText,
            parent: config.CHANNELS.APPLICATION_CATEGORY,
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
    // BUTTONS
    // =================================================
    if (i.isButton()) {

        const [, , userId] = i.customId.split("_");
        const data = applications.get(userId);
        if (!data) return;

        if (!i.member.roles.cache.some(r => config.ALLOWED_ROLES.includes(r.id)))
            return;

        const audit = await i.guild.channels.fetch(config.CHANNELS.APPLICATION_AUDIT);

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
            return i.reply({ content: `👀 На рассмотрении` });
        }

        // CALL
        if (i.customId.startsWith("app_call")) {

            const menu = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`voice_select_${userId}`)
                    .setChannelTypes(ChannelType.GuildVoice)
            );

            return i.reply({ components: [menu], ephemeral: true });
        }
    }

    // =================================================
    // VOICE SELECT
    // =================================================
    if (i.isChannelSelectMenu() && i.customId.startsWith("voice_select_")) {

        const userId = i.customId.split("_")[2];
        const voice = await i.guild.channels.fetch(i.values[0]);

        const audit = await i.guild.channels.fetch(config.CHANNELS.APPLICATION_AUDIT);

        await audit.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("📞 ОБЗВОН")
                    .setDescription(`<@${userId}> → ${voice}`)
            ]
        });

        return i.update({ content: "✔ OK", components: [] });
    }
});


// =====================================================
// SLASH REGISTER
// =====================================================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            {
                body: [
                    new SlashCommandBuilder()
                        .setName("panel")
                        .setDescription("Send recruitment panel")
                        .toJSON()
                ]
            }
        );

        console.log("Slash commands registered");
    } catch (e) {
        console.log(e);
    }
})();


// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
