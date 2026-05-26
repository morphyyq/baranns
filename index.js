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
// KEEP ALIVE
// =====================================================
const app = express();

app.get("/", (_, res) => {
    res.send(`Bot Alive (Instance: ${INSTANCE_ID})`);
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences 
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
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            REJECT_LOG: "1464576279771873353" // Канал логов отказов
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        ACADEMY_ROLES: [
            "1458410756453306490",
            "1458485405769797848",
            "1507798049416675531"
        ],
        CAPTURE_ROLES: [
            "1458410756453306490",
            "1475114013611528274"
        ],
        MONITOR_ROLES: [
            { id: "1468704257606684712", name: "Рекруты" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1507798049416675531", name: "RP Состав" }
        ],
        PING_ROLES: [
            "1458410756453306490"
        ]
    },
    "1504470399268819115": {
        CHANNELS: {
            SBOR: "1504574610564321290" 
        },
        PING_ROLES: [ 
            "1504470450305241288", 
            "1505558808766971944"
        ]
    }
};

// =====================================================
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        let data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        // Миграция старой базы на новую структуру
        if (!data.balances) {
            data = {
                balances: typeof data === "object" ? data : {},
                recruits: {}, // { candidateId: recruiterId }
                lastReset: Date.now()
            };
        }
        return data;
    } catch {
        return { balances: {}, recruits: {}, lastReset: Date.now() };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();

// =====================================================
// MEMORY & LOCKS
// =====================================================
const processed = new Set();
const applications = new Map();
const modalLocks = new Set();

// =====================================================
// SALARY & WEEKLY RESET SYSTEM
// =====================================================
async function updateSalaryEmbed(client, guildId) {
    const config = SERVERS[guildId];
    if (!config || !config.CHANNELS || !config.CHANNELS.SALARY) return;

    const channel = await client.channels.fetch(config.CHANNELS.SALARY).catch(() => null);
    if (!channel) return;

    let desc = "";
    for (const [userId, bal] of Object.entries(db.balances)) {
        if (bal > 0) {
            desc += `<@${userId}> — **${bal}$**\n`;
        }
    }

    if (!desc) desc = "*Пока никто не заработал на этой неделе.*";

    const embed = new EmbedBuilder()
        .setTitle("💰 Зарплаты рекрутеров")
        .setDescription(desc)
        .setColor("Green")
        .setFooter({ text: "Сброс балансов и истории рефералов происходит каждый понедельник" })
        .setTimestamp();

    const msgs = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const botMsg = msgs ? msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === "💰 Зарплаты рекрутеров") : null;

    if (botMsg) {
        await botMsg.edit({ embeds: [embed] }).catch(() => null);
    } else {
        await channel.send({ embeds: [embed] }).catch(() => null);
    }
}

function checkWeeklyReset() {
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    
    // Обнуление в понедельник, если прошло больше 5 дней с прошлого сброса
    if (now.getDay() === 1 && (now.getTime() - db.lastReset) > (oneDay * 5)) {
        db.balances = {};
        db.recruits = {};
        db.lastReset = now.getTime();
        saveDB(db);
        updateSalaryEmbed(client, "1458190222042075251").catch(() => null);
        console.log(`[BOT] Произведен еженедельный сброс зарплат!`);
    }
}
setInterval(checkWeeklyReset, 3600000); // Проверка каждый час

// =====================================================
// DEDUCT SALARY IF RECRUIT LEAVES
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    // Если человек, который ливнул, был кем-то рекрутирован
    if (db.recruits[member.id]) {
        const recruiterId = db.recruits[member.id];
        
        if (db.balances[recruiterId]) {
            db.balances[recruiterId] -= 10000;
            if (db.balances[recruiterId] < 0) db.balances[recruiterId] = 0;
        }
        
        delete db.recruits[member.id];
        saveDB(db);
        
        await updateSalaryEmbed(client, member.guild.id);
    }
});

// =====================================================
// MONITORING SYSTEM
// =====================================================
async function updateOnlineMonitor() {
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS || !config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) continue;

            await guild.members.fetch();

            let totalOnline = 0;
            let totalMembersCount = 0;
            const embeds = [];

            for (const roleData of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleData.id);
                if (!role) continue;

                let listString = "";
                let roleOnline = 0;
                const members = Array.from(role.members.values());

                if (members.length === 0) {
                    listString = "*В этой роли никого нет*";
                } else {
                    members.forEach(member => {
                        totalMembersCount++;
                        const isOnline = member.presence && member.presence.status !== "offline";
                        const statusEmoji = isOnline ? "🟢" : "🔴";
                        
                        if (isOnline) {
                            roleOnline++;
                            totalOnline++;
                        }
                        listString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                // Раздельные эмбеды для каждой роли
                const roleEmbed = new EmbedBuilder()
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`)
                    .setDescription(listString)
                    .setColor("#2b2d31");
                
                embeds.push(roleEmbed);
            }

            // Общий статистический эмбед снизу
            const summaryEmbed = new EmbedBuilder()
                .setTitle("📈 Общая статистика")
                .setDescription(`**Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``)
                .setColor("#2b2d31")
                .setTimestamp();
            
            embeds.push(summaryEmbed);

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes("👥")) : null;

            if (botMessage) {
                await botMessage.edit({ embeds }).catch(() => null);
            } else {
                await channel.send({ embeds }).catch(() => null);
            }
        }
    } catch (error) {
        console.error(`[MONITOR ERROR] [${INSTANCE_ID}] Error updating monitor:`, error);
    }
}

// =====================================================
// СИСТЕМА ОПОВЕЩЕНИЯ (МАССОВЫЙ СБОР)
// =====================================================
async function startMassNotification(guildId, activity, groupCode) {
    const config = SERVERS[guildId];
    if (!config) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(config.CHANNELS.SBOR).catch(() => null);
    if (!channel) return;

    const pingString = `@everyone ${config.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
    const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${groupCode} ##`;

    let cycles = 0;
    
    const executeSpam = async () => {
        cycles++;
        
        try {
            for (let i = 0; i < 3; i++) {
                await channel.send(messageContent).catch(() => null);
            }
        } catch (e) {}

        try {
            await guild.members.fetch();
            const targetMembers = guild.members.cache.filter(m => 
                config.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot
            );

            for (const [id, member] of targetMembers) {
                await member.send(`🔔 **Внимание!**\n${messageContent}`).catch(() => null);
            }
        } catch (e) {}

        if (cycles >= 3) {
            clearInterval(spamInterval);
        }
    };

    executeSpam();
    const spamInterval = setInterval(executeSpam, 300000);
}

// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить панель управления сборами")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Обновление слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR]`, e);
    }

    await updateOnlineMonitor();
    await updateSalaryEmbed(client, "1458190222042075251");
    setInterval(updateOnlineMonitor, 60000);
});

// =====================================================
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        if (msg.content === "/balance") {
            return msg.reply({
                content: `💰 Баланс: ${db.balances[msg.author.id] || 0}$`
            });
        }

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ (ОТЧЕТ ПЛАНШЕТА)
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 });
            const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));
            
            let candidateId = "null";
            let candidateText = "Не удалось определить";
            if (appMessage) {
                const description = appMessage.embeds[0].description || "";
                const userMatch = description.match(/<@(\d+)>/);
                if (userMatch) {
                    candidateId = userMatch[1];
                    candidateText = `<@${candidateId}>`;
                }
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                // Стандартизируем имя файла для избежания двойной картинки
                const safeFileName = "screenshot.png";
                const file = new AttachmentBuilder(att.url, { name: safeFileName });
                
                const auditEmbed = new EmbedBuilder()
                    .setTitle("📋 Отчёт по принятой заявке")
                    .setDescription(`👤 **Администратор:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                    .setImage(`attachment://${safeFileName}`)
                    .setColor("Purple")
                    .setTimestamp();

                const auditRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`audit_accept_${msg.author.id}_${candidateId}`)
                        .setLabel("Принять")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`audit_check_${msg.author.id}_${candidateId}`)
                        .setLabel("Проверить")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`audit_reject_${msg.author.id}_${candidateId}`)
                        .setLabel("Отказать")
                        .setStyle(ButtonStyle.Danger)
                );

                await auditChannel.send({ embeds: [auditEmbed], files: [file], components: [auditRow] });
            }

            await msg.channel.send("✅ Отчёт отправлен в аудит на проверку! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

        // SCREEN SYSTEM (Для обычных отчетов рекрутов)
        if (config.CHANNELS && msg.channel.id === config.CHANNELS.SCREEN) {
            if (processed.has(msg.id)) return;
            processed.add(msg.id);
            setTimeout(() => { processed.delete(msg.id); }, 120000);

            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
            if (!audit) return;

            const safeFileName = "screenshot.png";
            const file = new AttachmentBuilder(att.url, { name: safeFileName });

            const embed = new EmbedBuilder()
                .setTitle("📸 Новый отчёт (Свободный)")
                .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
                .setImage(`attachment://${safeFileName}`)
                .setColor("Blue")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`audit_accept_${msg.author.id}_null`)
                    .setLabel("Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`audit_reject_${msg.author.id}_null`)
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
            }, 5000);
        }

    } catch (e) {
        console.log(`[MESSAGE ERROR] [${INSTANCE_ID}]`, e);
    }
});

// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;

        // СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            const config = SERVERS[i.guild.id];
            
            if (i.commandName === "balance") {
                await i.reply({ content: `💰 Баланс: ${db.balances[i.user.id] || 0}$`, ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
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
• У нас нет отдельных местах только под капты или MCL — вы вступаете в тему и участвуете во всём контенте.
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
                            { label: "Academy", description: "Ник, статик, имя/возраст, онлайн, семья", value: "academy", emoji: "🎓" },
                            { label: "Capture", description: "Ник, статик, имя/возраст, онлайн, семья, откаты", value: "capture", emoji: "⚔️" }
                        )
                );

                await channel.send({ embeds: [embed], components: [menu] });
                await i.reply({ content: "✅ Панель отправлена", ephemeral: true });
                return;
            }

            if (i.commandName === "group_panel") {
                const channel = await client.channels.fetch("1508112178610438327").catch(() => null);
                if (!channel) {
                    await i.reply({ content: "❌ Канал 'групп' не найден или у бота нет туда доступа.", ephemeral: true });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle("📡 Управление сборами групп")
                    .setDescription(
                        "Используйте кнопки ниже для запуска массового оповещения состава.\n\n" +
                        "**Функционал:**\n" +
                        "• 3 сообщения в канал сбора\n" +
                        "• 3 рассылки в ЛС (раз в 5 минут)\n" +
                        "• Упоминание всех причастных ролей\n\n" +
                        "**Darkness & Ballas Central Control**"
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("group_start_ballas")
                        .setLabel("Ballas Gang")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🍇"),
                    new ButtonBuilder()
                        .setCustomId("group_start_darkness")
                        .setLabel("Darkness Family")
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji("🌑")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель сборов отправлена!", ephemeral: true });
                return;
            }
        }

        // =====================================================
        // СБОРЫ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("group_start_")) {
            const faction = i.customId.replace("group_start_", ""); 
            
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`group_select_${faction}`)
                    .setPlaceholder("Выберите тип мероприятия")
            );

            if (faction === "ballas") {
                menu.components[0].addOptions(
                    { label: "Цеха", value: "цеха" }, { label: "Диллеры", value: "диллеры" },
                    { label: "Остров", value: "остров" }, { label: "Поставки", value: "поставки" },
                    { label: "ФЗ", value: "фз" }, { label: "Контент", value: "контент" },
                    { label: "Банк", value: "банк" }, { label: "Дроп", value: "дроп" }
                );
            } else {
                menu.components[0].addOptions(
                    { label: "Капты", value: "капты" }, { label: "Контент", value: "контент" },
                    { label: "Арену", value: "арену" }, { label: "Тайники", value: "тайники" }
                );
            }

            await i.reply({ content: "Выберите тип сбора из списка ниже:", components: [menu], ephemeral: true });
            return;
        }

        if (i.isStringSelectMenu() && i.customId.startsWith("group_select_")) {
            const faction = i.customId.replace("group_select_", "");
            const activity = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`group_modal_code_${faction}_${activity}`)
                .setTitle("Код группы");

            const codeInput = new TextInputBuilder()
                .setCustomId("group_code_input")
                .setLabel("Введите код группы из 5 символов")
                .setPlaceholder("Например: YFKVQ")
                .setMinLength(5)
                .setMaxLength(5)
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("group_modal_code_")) {
            const parts = i.customId.split("_");
            const faction = parts[3];  
            const activity = parts[4]; 

            const code = i.fields.getTextInputValue("group_code_input").toUpperCase();
            const guildId = faction === "ballas" ? "1504470399268819115" : "1458190222042075251";

            await i.reply({ 
                content: `✅ Запущено оповещение для **${faction}** на **${activity}**. Код группы: **${code}**.\n\nБот отправит по 3 сообщения в канал и 1 в ЛС сейчас, а также повторит это через 5 и 10 минут.`, 
                ephemeral: true 
            });
            
            startMassNotification(guildId, activity, code);
            return;
        }

        // =====================================================
        // ОБРАБОТКА МОДАЛОК
        // =====================================================
        const config = SERVERS[i.guild.id];
        if (!config) return;

        // Подача заявки (Открытие модалки)
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?", placeholder: "Увидел на респе / медиа контент...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат с ГГ от 5 минут", style: TextInputStyle.Paragraph });
            }

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        // Сохранение причины отказа от заявки
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason");

            const logChannelId = config.CHANNELS.REJECT_LOG;
            if (logChannelId) {
                const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle("❌ Отказ в принятии")
                        .setDescription(`**Кандидат:** <@${targetId}>\n**Рекрутер:** <@${i.user.id}>\n\n**Причина отказа:**\n${reason}`)
                        .setColor("Red")
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] });
                }
            }

            await i.reply({ content: "✅ Заявка отклонена. Канал будет удален.", ephemeral: true });
            setTimeout(() => i.channel.delete().catch(() => null), 3000);
            return;
        }

        // Создание тикета при отправке заявки
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === config.CHANNELS.CATEGORY && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
                return;
            }

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null,
                userId: i.user.id
            };

            applications.set(i.user.id, data);

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            const topContent = `${rolesPing}\n**Предыдущие заявки:**\nЗаявок не найдено.`;

            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n${data.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕЕ)**\n${data.q2}\n\n**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${data.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n${data.q4}`;

            if (type !== "academy") {
                embedDescription += `\n\n**Предоставьте свои откаты**\n${data.q5}`;
            }
            embedDescription += `\n\n**Пользователь**\n<@${i.user.id}>`;

            const embed = new EmbedBuilder()
                .setTitle("Заявление")
                .setDescription(embedDescription)
                .setColor("#1f8b4c")
                .addFields(
                    { name: "Username", value: i.user.username, inline: true },
                    { name: "ID", value: i.user.id, inline: true }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: topContent, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        // Обзвон войс-каналы
        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];

            const messages = await i.channel.messages.fetch({ limit: 20 });
            const appMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));

            if (appMessage) {
                const embed = EmbedBuilder.from(appMessage.embeds[0]);
                embed.setColor("Orange").setTitle("Заявление (Вызов на обзвон)");
                await appMessage.edit({ embeds: [embed] });
            }

            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;
            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон администратором <@${i.user.id}>!\nПожалуйста, перейдите в голосовой канал: [Войти в голосовой канал](${voiceUrl}) (<#${voiceChannelId}>).`);

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) {
                await targetMember.send({
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** на сервере **${i.guild.name}** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовому каналу по прямой ссылке:\n${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                });
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        // ОБРАБОТКА КНОПОК
        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (parts[0] === "group" && parts[1] === "start") return; // Исключение для сборов

            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав для выполнения этого действия.", ephemeral: true });
                return;
            }

            // ==========================================
            // КНОПКИ АУДИТА (СКРИНШОТЫ)
            // ==========================================
            if (parts[0] === "audit") {
                const action = parts[1];
                const recruiterId = parts[2];
                const candidateId = parts[3];

                // 1. Проверка на сервере
                if (action === "check") {
                    if (candidateId === "null") {
                        return i.reply({ content: "❌ Не удалось определить ID кандидата (старый тип отчёта).", ephemeral: true });
                    }
                    const checkedMember = await i.guild.members.fetch(candidateId).catch(() => null);
                    if (checkedMember) {
                        await i.reply({ content: `✅ Кандидат <@${candidateId}> сейчас находится на сервере.`, ephemeral: true });
                    } else {
                        await i.reply({ content: `❌ Кандидата <@${candidateId}> НЕТ на сервере (возможно, вышел).`, ephemeral: true });
                    }
                    return;
                }

                // 2. Отказ
                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    return;
                }

                // 3. Одобрение и начисление зарплаты
                if (action === "accept") {
                    db.balances[recruiterId] = (db.balances[recruiterId] || 0) + 10000;
                    
                    // Сохраняем реферала, чтобы списать деньги, если он выйдет
                    if (candidateId !== "null") {
                        db.recruits[candidateId] = recruiterId;
                    }
                    
                    saveDB(db);

                    // Обновляем общий эмбед ЗП
                    await updateSalaryEmbed(client, i.guild.id);

                    const embed = EmbedBuilder.from(i.message.embeds[0]);
                    embed.setColor("Green").setTitle("✅ Отчёт одобрен");
                    await i.update({ embeds: [embed], components: [] });
                    return;
                }
            }

            // ==========================================
            // КНОПКИ ЗАЯВОК (ТИКЕТЫ)
            // ==========================================
            if (parts[0] === "app") {
                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) {
                        await i.reply({ content: "❌ Пользователь вышел с сервера.", ephemeral: true });
                        return;
                    }
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    await targetMember.roles.add(rolesToAdd).catch(() => null);

                    await i.channel.permissionOverwrites.edit(targetId, {
                        ViewChannel: false,
                        SendMessages: false
                    }).catch(() => null);

                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send({
                        content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчёт в аудите и закрыть тикет.`
                    });
                    return;
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`⏳ Администратор <@${i.user.id}> взял заявку на рассмотрение.`);
                    return;
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`call_voice_${targetId}`)
                            .setPlaceholder("Выберите голосовой канал для кандидата")
                            .addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "⬇️ Выберите войс-канал из списка:", components: [voiceMenu], ephemeral: true });
                    return;
                }

                if (action === "reject") {
                    const modal = new ModalBuilder()
                        .setCustomId(`app_reject_modal_${targetId}`)
                        .setTitle("Отказ заявки");
                    
                    const reasonInput = new TextInputBuilder()
                        .setCustomId("reject_reason")
                        .setLabel("Причина отказа")
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true);

                    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                    await i.showModal(modal);
                    return;
                }
            }
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR HANDLED] [${INSTANCE_ID}]`, e);
    }
});

// =====================================================
// ПРАВИЛЬНОЕ ВЫКЛЮЧЕНИЕ
// =====================================================
const shutdown = () => {
    console.log(`[BOT] Получен сигнал выключения. Отключаюсь...`);
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
