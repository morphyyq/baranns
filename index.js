require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const fs = require("fs");
const path = require("path");
const express = require("express");

// Генерируем уникальный ID для этой запущенной копии бота
const INSTANCE_ID = Math.random().toString(36).substring(2, 7).toUpperCase();

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
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType
} = require("discord.js");


// =====================================================
// KEEP ALIVE (Для Render/Replit)
// =====================================================
const app = express();
app.get("/", (_, res) => {
    res.send(`Bot Alive (Instance: ${INSTANCE_ID})`);
});
app.listen(process.env.PORT || 3000);


// =====================================================
// CLIENT CONFIG
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

client.on(Events.Error, (error) => {
    console.error(`[GLOBAL DISCORD ERROR] [${INSTANCE_ID}]`, error);
});


// =====================================================
// SERVER CONFIG
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
// DATABASE (salary.json)
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
// MEMORY & LOCKS
// =====================================================
const processed = new Set();
const applications = new Map();
const modalLocks = new Set();


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] Ошибка регистрации команд:`, e);
    }
});


// =====================================================
// MESSAGE SYSTEM (Screenshots)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // SCREEN SYSTEM
        if (msg.channel.id !== config.CHANNELS.SCREEN) return;
        
        if (processed.has(msg.id)) return;
        processed.add(msg.id);
        setTimeout(() => { processed.delete(msg.id); }, 120000);

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
        console.log(`[MESSAGE ERROR]`, e);
    }
});


// =====================================================
// INTERACTIONS (Slash, Menus, Buttons)
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];
        if (!config) return;

        // 1. СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                await i.reply({ content: `💰 Баланс: ${salary[i.user.id] || 0}`, ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(`Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.\n\n⏳ **Время рассмотрения:** от 1 до 4 дней.\n\n### 🎬 Academy состав ###\n• Возможность развития\n### 🔥 Capture состав ###\n• Откаты GG от 5 минут\n\n**📌 Перед подачей убедитесь, что ваш Discord открыт для связи (ЛС)!**`)
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
                await i.reply({ content: "✅ Панель отправлена", ephemeral: true });
                return;
            }
        }

        // 2. ОТКРЫТИЕ МОДАЛКИ
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И НИК", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ОПЫТ В СЕМЬЯХ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ МЫ?", placeholder: "Увидел на респе...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "ОТКАТЫ (ССЫЛКА)", placeholder: "Ссылка на YouTube/Imgur", style: TextInputStyle.Paragraph });
            }

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        // 3. ОТПРАВКА МОДАЛКИ (СОЗДАНИЕ ТИКЕТА)
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedName = `${type}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

            const channel = await i.guild.channels.create({
                name: expectedName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const data = {
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null
            };

            const embed = new EmbedBuilder()
                .setTitle(`Новая заявка: ${type.toUpperCase()}`)
                .setColor("#1f8b4c")
                .addFields(
                    { name: "Ник/Статик", value: data.q1 },
                    { name: "Имя/Возраст", value: data.q2 },
                    { name: "Опыт", value: data.q3 },
                    { name: "Причина", value: data.q4 }
                );
            if (data.q5) embed.addFields({ name: "Откаты", value: data.q5 });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: `<@${i.user.id}> | ${config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ")}`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана: <#${channel.id}>`, ephemeral: true });
        }

        // 4. ОБРАБОТКА КНОПОК И МЕНЮ ОБЗВОНА
        if (i.isButton()) {
            const [prefix, action, targetId] = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);
            const hasPermission = config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));

            if (!hasPermission) return i.reply({ content: "❌ Нет прав.", ephemeral: true });

            // Логика отчетов по скринам (accept/reject)
            if (prefix === "accept" || prefix === "reject") {
                const targetIdReport = action; // В этой части кода action — это ID пользователя
                const embed = EmbedBuilder.from(i.message.embeds[0]);
                if (prefix === "accept") {
                    salary[targetIdReport] = (salary[targetIdReport] || 0) + 1000;
                    saveDB(salary);
                    embed.setColor("Green").setTitle("📸 Отчёт одобрен (+1000)");
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                }
                return i.update({ embeds: [embed], components: [] });
            }

            // Логика заявок (app)
            if (prefix === "app") {
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Игрок покинул сервер.", ephemeral: true });
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const roles = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    await targetMember.roles.add(roles).catch(() => null);

                    // ОТПРАВКА В ЛС
                    await targetMember.send({
                        content: `🎉 **Поздравляем!** Ваша заявка в семью **Darkness** была **одобрена**!\nДобро пожаловать в состав **${isAcademy ? "Academy" : "Capture"}**.`
                    }).catch(() => i.channel.send(`⚠️ <@${targetId}>, не смог отправить уведомление в ЛС (закрыт профиль).`));

                    embed.setColor("Green").setTitle("Заявление (Одобрено)");
                    await i.update({ embeds: [embed], components: [] });
                    await i.channel.send("🎉 Канал удалится через 15 сек.");
                    setTimeout(() => i.channel.delete().catch(() => null), 15000);
                }

                if (action === "reject") {
                    // ОТПРАВКА В ЛС ПРИ ОТКАЗЕ
                    if (targetMember) {
                        await targetMember.send({
                            content: `❌ К сожалению, ваша заявка в семью **Darkness** была **отклонена**.`
                        }).catch(() => null);
                    }

                    embed.setColor("Red").setTitle("Заявление (Отклонено)");
                    await i.update({ embeds: [embed], components: [] });
                    setTimeout(() => i.channel.delete().catch(() => null), 15000);
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`⏳ <@${i.user.id}> рассматривает заявку.`);
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`call_voice_${targetId}`)
                            .setPlaceholder("Выберите канал для обзвона")
                            .addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "Выберите канал:", components: [voiceMenu], ephemeral: true });
                }
            }
        }

        // 5. ЛОГИКА ВЫБОРА ВОЙСА
        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceId = i.values[0];
            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceId}`;

            await i.channel.send(`📞 <@${targetId}>, вас ждут в голосовом канале: <#${voiceId}>`);
            
            const target = await i.guild.members.fetch(targetId).catch(() => null);
            if (target) {
                await target.send({ content: `🔔 Вас вызвали на обзвон в **Darkness**!\nЗайдите сюда: ${voiceUrl}` }).catch(() => null);
            }
            await i.reply({ content: "✅ Уведомление отправлено.", ephemeral: true });
        }

    } catch (e) {
        console.error(`[INTERACTION ERROR]`, e);
    }
});

const shutdown = () => {
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(process.env.TOKEN);
