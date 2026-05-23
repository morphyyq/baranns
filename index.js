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
    REST,
    Routes,
    SlashCommandBuilder,
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
    setTimeout(() => { processed.delete(id); }, 120000);
    return false;
}


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag}`);

    // Регистрация слэш-команд для отображения в Discord
    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log("[BOT] Начало обновления слэш-команд...");
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log("[BOT] Слэш-команд успешно зарегистрированы!");
    } catch (e) {
        console.error("[BOT ERROR] Не удалось зарегистрировать команды:", e);
    }
});


// =====================================================
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // Поддержка текстовой команды /balance
        if (msg.content === "/balance") {
            return msg.reply({
                content: `💰 Баланс: ${salary[msg.author.id] || 0}`
            });
        }

        // SCREEN SYSTEM
        if (msg.channel.id !== config.CHANNELS.SCREEN) return;
        if (lockMessage(msg.id)) return;

        const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!att) return;

        const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
        if (!audit) return;

        const file = new AttachmentBuilder(att.url, { name: att.name || "screen.png" });

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

        setTimeout(async () => {
            try { await msg.delete(); } catch {}
        }, 10000);

    } catch (e) {
        console.log("[MESSAGE ERROR]", e);
    }
});


// =====================================================
// INTERACTIONS (COMMANDS, MODALS, BUTTONS)
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;

        const config = SERVERS[i.guild.id];
        if (!config) return;

        // СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                return i.reply({ content: `💰 Баланс: ${salary[i.user.id] || 0}`, ephemeral: true });
            }

            if (i.commandName === "panel") {
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
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

                await channel.send({ embeds: [embed], components: [menu] });
                return i.reply({ content: "✅ Панель отправлена", ephemeral: true });
            }
        }

        // МЕНЮ ВЫБОРА ТИПА ЗАЯВКИ
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Academy" : "Capture");

            const fields = [
                { id: "q1", label: "Ник | Имя | Статик | Возраст", placeholder: "Hugo | Женя | 21074 | 20", style: TextInputStyle.Short },
                { id: "q2", label: "Средний онлайн в день", placeholder: "Например: 4-6 часов", style: TextInputStyle.Short },
                { id: "q3", label: "В каких семьях были и почему ушли?", placeholder: "Перечислите семьи и почему ушли", style: TextInputStyle.Paragraph },
                { id: "q4", label: type === "academy" ? "Как узнали о нас?" : "Предоставьте свои откаты", placeholder: type === "academy" ? "Например: на респе баллас" : "Откат с ГГ от 5 минут Тяга (спешик)", style: TextInputStyle.Paragraph }
            ];

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setStyle(f.style)
                ))
            );

            return i.showModal(modal);
        }

        // ОТПРАВКА МОДАЛЬНОГО ОКНА (ОФОРМЛЕНИЕ ЗАЯВКИ)
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

            // ИСПРАВЛЕНО: Правильный вызов создания канала тикета
            const channel = await i.guild.channels.create({
                name: `заявление-${i.user.username.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            await channel.send({ content: rolesPing });

            const embed = new EmbedBuilder()
                .setTitle(type === "academy" ? "🎓 Academy" : "⚔️ Capture")
                .setDescription(
`**Ник | Имя | Статик | Возраст**
${data.q1}

**Средний онлайн**
${data.q2}

**Семьи**
${data.q3}

**${type === "academy" ? "Как узнали о нас?" : "Откаты"}**
${data.q4}

Пользователь: <@${i.user.id}>`
                )
                .setColor("#2b2d31");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });

            return i.reply({ content: "✅ Заявка создана! Проверьте появившийся текстовый канал.", ephemeral: true });
        }

        // ОБРАБОТКА НАЖАТИЙ НА КНОПКИ
        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            // Проверяем, есть ли у администратора права на управление
            const hasPermission = config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для управления этой системой.", ephemeral: true });
            }

            // --- 1. Кнопки Системы Скриншотов/Отчетов (accept / reject) ---
            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary[targetId] = (salary[targetId] || 0) + 1000; // Награда за отчет (измени 1000 на своё число)
                    saveDB(salary);

                    embed.setColor("Green").setTitle("📸 Отчёт одобрен администратором");
                    await i.update({ embeds: [embed], components: [] });

                    try {
                        const targetUser = await client.users.fetch(targetId);
                        await targetUser.send(`✅ Ваш отчёт был принят! На баланс начислено 1000.`);
                    } catch {}
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                    await i.update({ embeds: [embed], components: [] });

                    try {
                        const targetUser = await client.users.fetch(targetId);
                        await targetUser.send(`❌ Ваш отчёт был отклонён администрацией.`);
                    } catch {}
                }
            }

            // --- 2. Кнопки Системы Заявок (app) ---
            if (parts[0] === "app") {
                const action = parts[1]; // accept, review, call, reject
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);
                const appTitle = i.message.embeds[0].title;

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Пользователь покинул сервер.", ephemeral: true });

                    // Определяем роли по названию эмбеда
                    const isAcademy = appTitle.includes("Academy");
                    const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;

                    await targetMember.roles.add(rolesToAdd).catch(console.error);

                    embed.setColor("Green").setTitle(`${appTitle} (Принята)`);
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send(`🎉 <@${targetId}> принят администратором <@${i.user.id}>! Канал закроется через 15 сек.`);
                    setTimeout(() => i.channel.delete().catch(() => null), 15000);

                    try { await targetMember.send(`🎉 Поздравляем! Ваша заявка в семью Darkness одобрена!`); } catch {}
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle(`${appTitle} (На рассмотрении)`);
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`⏳ Заявка взята на рассмотрение администратором <@${i.user.id}>.`);
                }

                if (action === "call") {
                    embed.setColor("Orange").setTitle(`${appTitle} (Обзвон)`);
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`📞 <@${targetId}>, вас вызывает на обзвон администратор <@${i.user.id}>! Настройте микрофон и ожидайте.`);
                }

                if (action === "reject") {
                    embed.setColor("Red").setTitle(`${appTitle} (Отклонена)`);
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send(`❌ <@${targetId}>, ваша заявка была отклонена. Канал будет удалён через 15 секунд.`);
                    setTimeout(() => i.channel.delete().catch(() => null), 15000);

                    if (targetMember) {
                        try { await targetMember.send(`❌ К сожалению, ваша заявка в семью Darkness была отклонена.`); } catch {}
                    }
                }
            }
        }

    } catch (e) {
        console.log("[INTERACTION ERROR]", e);
    }
});


// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
