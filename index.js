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
            PANEL: "1458410655697731730",
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417"
        }
    }
};


// =====================================================
// MEMORY
// =====================================================
const applications = new Map();


// =====================================================
// READY (PANEL SEND)
// =====================================================
client.once(Events.ClientReady, async () => {

    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    const channel = await client.channels.fetch(SERVERS["1458190222042075251"].CHANNELS.PANEL);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("🚀 Заявки в семью Darkness")
        .setDescription(`Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.

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

**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**`)
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
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {

    if (!i.guild) return;
    const config = SERVERS[i.guild.id];
    if (!config) return;

    // =========================
    // SELECT MENU -> MODAL
    // =========================
    if (i.isStringSelectMenu() && i.customId === "apply_menu") {

        const type = i.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`apply_${type}`)
            .setTitle(type === "academy" ? "Academy" : "Capture");

        const fields = [
            { id: "q1", label: "Ник | Имя | Статик | Возраст", placeholder: "Hugo | Женя | 21074 | 20" },
            { id: "q2", label: "Средний онлайн в день", placeholder: "Например: 4-6 часов" },
            { id: "q3", label: "В каких семьях были и почему ушли?", placeholder: "Перечислите семьи и причины ухода" },
            { id: "q4", label: type === "academy" ? "Как узнали о нас?" : "Предоставьте свои откаты", placeholder: type === "academy" ? "Например: на респе баллас" : "Откат с ГГ от 5 минут / МП / капт" }
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
            .setTitle(`📨 ${type.toUpperCase()}`)
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
