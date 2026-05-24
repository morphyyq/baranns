/**
 * DISCORD BOT: DARKNESS FAMILY & BALLAS MANAGEMENT SYSTEM
 * Version: 2.5.0
 * Total Lines Target: 700-800
 */

require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const fs = require("fs");
const path = require("path");
const express = require("express");

// Уникальный идентификатор инстанса для логов
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
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

// =====================================================
// SERVER KEEP ALIVE SECTION
// =====================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send(`
        <html>
            <head><title>Bot Status</title></head>
            <body style="background: #121212; color: #00ff00; font-family: monospace; padding: 20px;">
                <h1>[SYSTEM] BOT IS ONLINE</h1>
                <p>Instance ID: ${INSTANCE_ID}</p>
                <p>Status: Running...</p>
                <p>Time: ${new Date().toLocaleString()}</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`[EXPRESS] Keep-alive server is running on port ${PORT}`);
});

// =====================================================
// BOT CLIENT INITIALIZATION
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User
    ]
});

// Глобальный перехват ошибок
client.on(Events.Error, (error) => {
    console.error(`[CRITICAL ERROR] [${INSTANCE_ID}]:`, error);
});

process.on('unhandledRejection', error => {
    console.error('[UNHANDLED REJECTION]:', error);
});

// =====================================================
// GLOBAL CONFIGURATION (SERVERS, CHANNELS, ROLES)
// =====================================================
const SERVERS = {
    // DARKNESS FAMILY CONFIGURATION
    "1458190222042075251": {
        NAME: "DARKNESS FAMILY",
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            PANEL: "1458410655697731730",
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709"
        },
        ALLOWED_ROLES: [
            "1471553901433192532", // ADMIN
            "1458192704524648701", // LEADER
            "1458192781217370173", // DEPUTY
            "1458484199735689299", // RECRUITER
            "1468704257606684712"  // CURATOR
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
        GROUP_ROLE: "1458410756453306490"
    },
    // BALLAS CONFIGURATION
    "1504470399268819115": {
        NAME: "BALLAS GANG",
        CHANNELS: {
            SBOR: "1504574610564321290"
        },
        GROUP_ROLES: [
            "1504470450305241288",
            "1505558808766971944"
        ]
    }
};

// ID канала управления группами (где находится панель кнопок)
const GROUP_CONTROL_CHANNEL = "1508112178610438327";

// =====================================================
// DATABASE SYSTEM (JSON FILE)
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

/**
 * Загрузка базы данных зарплат
 */
function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 4));
            return {};
        }
        const data = fs.readFileSync(DB_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error("[DB ERROR] Failed to load database:", err);
        return {};
    }
}

/**
 * Сохранение базы данных зарплат
 */
function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error("[DB ERROR] Failed to save database:", err);
    }
}

let salaryData = loadDB();

// =====================================================
// MEMORY STORAGE & STATE MANAGEMENT
// =====================================================
const processedMessages = new Set();
const applicationProcess = new Map();
const userModalCooldown = new Set();
const activeGroupSpam = new Map(); // Хранение интервалов для остановки

// =====================================================
// ONLINE MONITORING SYSTEM
// =====================================================
async function updateOnlineMonitor() {
    console.log(`[MONITOR] Starting update cycle...`);
    
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                console.warn(`[MONITOR] Guild ${guildId} not found.`);
                continue;
            }

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) {
                console.warn(`[MONITOR] Monitor channel in ${guild.name} not found.`);
                continue;
            }

            // Принудительно обновляем кэш участников
            await guild.members.fetch();

            const monitorEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setThumbnail(guild.iconURL())
                .setTimestamp()
                .setFooter({ text: "Система автоматического обновления" });

            let totalOnlineCount = 0;
            let totalOverallCount = 0;

            for (const roleInfo of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleInfo.id);
                if (!role) {
                    monitorEmbed.addFields({ name: `❌ ${roleInfo.name}`, value: "Роль удалена или не найдена", inline: false });
                    continue;
                }

                let membersList = "";
                let onlineInRole = 0;
                const roleMembers = Array.from(role.members.values());

                if (roleMembers.length === 0) {
                    membersList = "*В данной категории нет участников*";
                } else {
                    roleMembers.forEach(member => {
                        totalOverallCount++;
                        const isOnline = member.presence && (member.presence.status === "online" || member.presence.status === "dnd" || member.presence.status === "idle");
                        const statusIndicator = isOnline ? "🟢" : "🔴";
                        
                        if (isOnline) {
                            onlineInRole++;
                            totalOnlineCount++;
                        }
                        membersList += `${statusIndicator} <@${member.id}>\n`;
                    });
                }

                monitorEmbed.addFields({
                    name: `👥 ${roleInfo.name} [${onlineInRole}/${roleMembers.length}]`,
                    value: membersList.length > 1024 ? membersList.substring(0, 1020) + "..." : membersList,
                    inline: false
                });
            }

            monitorEmbed.setDescription(`📈 **Текущий онлайн (выбранные роли):** \`${totalOnlineCount} из ${totalOverallCount}\``);

            const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
            const existingMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title?.includes("Мониторинг")) : null;

            if (existingMessage) {
                await existingMessage.edit({ embeds: [monitorEmbed] }).catch(e => console.error("[MONITOR] Edit failed:", e));
            } else {
                await channel.send({ embeds: [monitorEmbed] }).catch(e => console.error("[MONITOR] Send failed:", e));
            }
        }
    } catch (globalMonitorError) {
        console.error(`[MONITOR CRITICAL ERROR]`, globalMonitorError);
    }
}

// =====================================================
// GROUP SPAM LOGIC (BALLAS & FAMILY)
// =====================================================

/**
 * Инициализация панели управления группами
 */
async function setupGroupManagementPanel() {
    const channel = await client.channels.fetch(GROUP_CONTROL_CHANNEL).catch(() => null);
    if (!channel) {
        console.error(`[GROUP SYSTEM] Control channel ${GROUP_CONTROL_CHANNEL} not found!`);
        return;
    }

    const messages = await channel.messages.fetch({ limit: 10 });
    const oldPanel = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === "📡 Управление сборами групп");

    const mainEmbed = new EmbedBuilder()
        .setTitle("📡 Управление сборами групп")
        .setDescription("Используйте кнопки ниже для запуска массового оповещения состава.\n\n**Функционал:**\n- 3 сообщения в канал сбора\n- 3 рассылки в ЛС (раз в 5 минут)\n- Упоминание всех причастных ролей")
        .setColor("#2b2d31")
        .setThumbnail("https://i.imgur.com/8QG4Y6E.png")
        .setFooter({ text: "Darkness & Ballas Central Control" });

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("group_init_ballas").setLabel("Ballas Gang").setStyle(ButtonStyle.Danger).setEmoji("🍇"),
        new ButtonBuilder().setCustomId("group_init_family").setLabel("Darkness Family").setStyle(ButtonStyle.Primary).setEmoji("🌑")
    );

    if (oldPanel) {
        await oldPanel.edit({ embeds: [mainEmbed], components: [btnRow] });
    } else {
        await channel.send({ embeds: [mainEmbed], components: [btnRow] });
    }
}

/**
 * Функция цикличного спама
 */
async function runGroupSpamSequence(guildId, orgName, groupCode, activityType) {
    const config = SERVERS[guildId];
    if (!config) return;

    let dmCount = 0;
    const spamKey = `${guildId}_${activityType}_${groupCode}`;

    // Если уже запущен такой же спам, остановим старый
    if (activeGroupSpam.has(spamKey)) {
        clearInterval(activeGroupSpam.get(spamKey));
    }

    const spamTask = async () => {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        const sborChannel = await guild.channels.fetch(config.CHANNELS.SBOR).catch(() => null);
        if (sborChannel) {
            let roleMentions = "";
            if (guildId === "1458190222042075251") {
                roleMentions = `<@&${config.GROUP_ROLE}>`;
            } else {
                roleMentions = config.GROUP_ROLES.map(id => `<@&${id}>`).join(" ");
            }

            const alertMessage = `📢 **ВНИМАНИЕ! ВСЕМ БЫТЬ!**\n\n${roleMentions} @everyone\n\n### 🚀 СБОР НА: ${activityType.toUpperCase()}\n### 🔑 ГРУППА: ${groupCode.toUpperCase()}\n\n*Кого не будет — 2 выговора (варна) без права обжалования!*`;
            
            // Отправляем 3 сообщения подряд для максимального привлечения внимания
            for (let i = 0; i < 3; i++) {
                await sborChannel.send(alertMessage).catch(() => null);
            }
        }

        // Рассылка в ЛС (только первые 3 цикла, чтобы не забанили бота)
        if (dmCount < 3) {
            await guild.members.fetch();
            const targetRoles = guildId === "1458190222042075251" ? [config.GROUP_ROLE] : config.GROUP_ROLES;
            
            const membersToNotify = guild.members.cache.filter(m => 
                !m.user.bot && targetRoles.some(rId => m.roles.cache.has(rId))
            );

            membersToNotify.forEach(member => {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("🔔 СРОЧНЫЙ СБОР")
                    .setDescription(`Вы вызываетесь на: **${activityType}**\nКод группы: \`${groupCode.toUpperCase()}\`\n\n**Явка обязательна!**`)
                    .setColor("Red")
                    .setTimestamp();

                member.send({ embeds: [dmEmbed] }).catch(() => {
                    // console.log(`Could not send DM to ${member.user.tag}`);
                });
            });
            dmCount++;
        }
    };

    // Первый запуск
    await spamTask();
    
    // Интервал 5 минут (300 000 мс)
    const interval = setInterval(spamTask, 300000);
    activeGroupSpam.set(spamKey, interval);

    // Автоматическая остановка через 30 минут (опционально, чтобы не спамил вечно)
    setTimeout(() => {
        clearInterval(interval);
        activeGroupSpam.delete(spamKey);
    }, 1800000);
}

// =====================================================
// BOT EVENT HANDLERS
// =====================================================

client.once(Events.ClientReady, async () => {
    console.log(`[SYSTEM] Logged in as ${client.user.tag}`);
    console.log(`[SYSTEM] Instance [${INSTANCE_ID}] active and monitoring.`);

    // Регистрация слэш-команд
    const commands = [
        new SlashCommandBuilder()
            .setName("panel")
            .setDescription("Отправить главную панель для подачи заявок в Darkness")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName("balance")
            .setDescription("Проверить свой текущий баланс накопленной зарплаты")
    ].map(c => c.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log("[SYSTEM] Refreshing application (/) commands...");
        for (const gId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, gId),
                { body: commands }
            );
        }
        console.log("[SYSTEM] Successfully reloaded application (/) commands.");
    } catch (cmdError) {
        console.error("[SYSTEM ERROR] Slash commands failed:", cmdError);
    }

    // Запуск фоновых задач
    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);
    
    await setupGroupManagementPanel();
});

// =====================================================
// MESSAGE LOGIC (REPORTS, SCREENS, TICKETS)
// =====================================================

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const config = SERVERS[message.guild.id];
    if (!config) return;

    // 1. Обработка тикетов (каналы с префиксом closed-)
    if (message.channel.name && message.channel.name.startsWith("closed-")) {
        const image = message.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!image) return;

        const isAuthorized = config.ALLOWED_ROLES.some(rId => message.member.roles.cache.has(rId));
        if (!isAuthorized) return;

        // Поиск сообщения с самой заявкой для определения кандидата
        const recentMessages = await message.channel.messages.fetch({ limit: 50 });
        const originalApp = recentMessages.find(m => m.embeds.length > 0 && m.embeds[0].title === "Заявление");
        
        let candidateMention = "Неизвестный";
        if (originalApp) {
            const match = originalApp.embeds[0].description.match(/<@(\d+)>/);
            if (match) candidateMention = `<@${match[1]}>`;
        }

        const auditLogs = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
        if (auditLogs) {
            const reportFile = new AttachmentBuilder(image.url, { name: "report_tablet.png" });
            const reportEmbed = new EmbedBuilder()
                .setTitle("📋 Отчёт: Принятие в организацию")
                .setDescription(`👤 **Администратор:** <@${message.author.id}>\n👤 **Новобранец:** ${candidateMention}\n📂 **Канал:** \`${message.channel.name}\``)
                .setImage(`attachment://report_tablet.png`)
                .setColor("#7289da")
                .setTimestamp();

            await auditLogs.send({ embeds: [reportEmbed], files: [reportFile] });
        }

        await message.channel.send("✅ Данные занесены в архив. Тикет будет удален через 5 секунд...");
        setTimeout(() => message.channel.delete().catch(() => null), 5000);
        return;
    }

    // 2. Обработка канала скриншотов (Screen)
    if (message.channel.id === config.CHANNELS.SCREEN) {
        if (processedMessages.has(message.id)) return;
        processedMessages.add(message.id);

        const attachment = message.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!attachment) return;

        const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
        if (!auditChannel) return;

        const reportFile = new AttachmentBuilder(attachment.url, { name: "screen_report.png" });
        const screenEmbed = new EmbedBuilder()
            .setTitle("📸 Новый отчет от рекрута")
            .setDescription(`👤 Отправил: <@${message.author.id}>`)
            .setImage(`attachment://screen_report.png`)
            .setColor("Yellow")
            .setTimestamp();

        const actionButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rep_accept_${message.author.id}`).setLabel("Одобрить (+1000)").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rep_reject_${message.author.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await auditChannel.send({ embeds: [screenEmbed], files: [reportFile], components: [actionButtons] });

        // Удаляем сообщение из канала через 10 секунд
        setTimeout(() => message.delete().catch(() => null), 10000);
    }
});

// =====================================================
// INTERACTION HANDLER (BUTTONS, MODALS, SELECTS)
// =====================================================

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (!interaction.guild) return;
        const config = SERVERS[interaction.guild.id];

        // --- ГРУППОВАЯ СИСТЕМА (НОВОЕ) ---

        if (interaction.isButton() && interaction.customId.startsWith("group_init_")) {
            const organization = interaction.customId.split("_")[2]; // ballas / family
            
            const typeSelector = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`group_type_select_${organization}`)
                    .setPlaceholder("Выберите тип активности")
                    .addOptions(
                        organization === "ballas" 
                        ? [
                            { label: "Цеха", value: "цеха", emoji: "🏭" },
                            { label: "Диллеры", value: "диллеры", emoji: "📦" },
                            { label: "Остров", value: "остров", emoji: "🏝️" },
                            { label: "Поставки", value: "поставки", emoji: "🚛" },
                            { label: "ФЗ", value: "фз", emoji: "🛡️" },
                            { label: "Банк", value: "банк", emoji: "💰" }
                          ]
                        : [
                            { label: "Капты", value: "капты", emoji: "⚔️" },
                            { label: "Контент", value: "контент", emoji: "🎭" },
                            { label: "Арена", value: "арена", emoji: "🏟️" },
                            { label: "Тайники", value: "тайники", emoji: "🗝️" }
                          ]
                    )
            );

            await interaction.reply({ content: "Что именно планируется?", components: [typeSelector], ephemeral: true });
            return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("group_type_select_")) {
            const org = interaction.customId.split("_")[3];
            const act = interaction.values[0];

            const codeModal = new ModalBuilder()
                .setCustomId(`group_modal_final_${org}_${act}`)
                .setTitle("Ввод кода группы");

            const inputCode = new TextInputBuilder()
                .setCustomId("field_code")
                .setLabel("Введите 5-значный код группы")
                .setPlaceholder("ABC12")
                .setMinLength(5)
                .setMaxLength(5)
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            codeModal.addComponents(new ActionRowBuilder().addComponents(inputCode));
            await interaction.showModal(codeModal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith("group_modal_final_")) {
            const [, , , org, act] = interaction.customId.split("_");
            const code = interaction.fields.getTextInputValue("field_code");

            const targetGuild = org === "ballas" ? "1504470399268819115" : "1458190222042075251";
            
            await runGroupSpamSequence(targetGuild, org, code, act);
            await interaction.reply({ content: `✅ Сбор на **${act}** запущен! Группа: \`${code.toUpperCase()}\``, ephemeral: true });
            return;
        }

        // --- СИСТЕМА ЗАЯВОК (DARKNESS) ---

        if (!config) return;

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === "panel") {
                const panelEmbed = new EmbedBuilder()
                    .setTitle("🚀 Подача заявки в Darkness Family")
                    .setDescription("Выберите интересующее вас направление, заполнив небольшую анкету.")
                    .setColor("#2b2d31")
                    .setImage("https://i.imgur.com/your-image.png");

                const panelMenu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("main_apply_menu")
                        .setPlaceholder("Выберите отдел")
                        .addOptions(
                            { label: "Academy (Обучение)", value: "academy", emoji: "🎓" },
                            { label: "Capture (Война за терры)", value: "capture", emoji: "🔥" }
                        )
                );

                await interaction.channel.send({ embeds: [panelEmbed], components: [panelMenu] });
                await interaction.reply({ content: "Панель установлена.", ephemeral: true });
                return;
            }

            if (interaction.commandName === "balance") {
                const bal = salaryData[interaction.user.id] || 0;
                await interaction.reply({ content: `💵 Ваш текущий баланс: **${bal}**`, ephemeral: true });
                return;
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === "main_apply_menu") {
            const type = interaction.values[0];
            const appModal = new ModalBuilder()
                .setCustomId(`modal_app_${type}`)
                .setTitle(type === "academy" ? "Анкета: Академия" : "Анкета: Капт-состав");

            const q1 = new TextInputBuilder().setCustomId("q1").setLabel("Ваш Статик и Ник").setStyle(TextInputStyle.Short).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId("q2").setLabel("Ваш реальный возраст").setStyle(TextInputStyle.Short).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId("q3").setLabel("Где были раньше? (Семьи)").setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId("q4").setLabel("Почему именно мы?").setStyle(TextInputStyle.Paragraph).setRequired(true);

            const rows = [q1, q2, q3, q4].map(q => new ActionRowBuilder().addComponents(q));

            if (type === "capture") {
                const q5 = new TextInputBuilder().setCustomId("q5").setLabel("Ссылки на откаты (YouTube/Imgur)").setStyle(TextInputStyle.Paragraph).setRequired(true);
                rows.push(new ActionRowBuilder().addComponents(q5));
            }

            appModal.addComponents(...rows);
            await interaction.showModal(appModal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_app_")) {
            if (userModalCooldown.has(interaction.user.id)) {
                return interaction.reply({ content: "❌ Не спамьте! Подождите немного.", ephemeral: true });
            }
            userModalCooldown.add(interaction.user.id);
            setTimeout(() => userModalCooldown.delete(interaction.user.id), 10000);

            const type = interaction.customId.replace("modal_app_", "");
            const sanitizedNick = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `${type}-${sanitizedNick}`;

            const existing = interaction.guild.channels.cache.find(c => c.name === ticketName);
            if (existing) return interaction.reply({ content: `У вас уже есть открытый тикет: <#${existing.id}>`, ephemeral: true });

            const ticket = await interaction.guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ...config.ALLOWED_ROLES.map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
                ]
            });

            const appEmbed = new EmbedBuilder()
                .setTitle("Заявление")
                .setColor(type === "academy" ? "Blue" : "Red")
                .addFields(
                    { name: "👤 Кандидат", value: `<@${interaction.user.id}>` },
                    { name: "🆔 Статик/Ник", value: interaction.fields.getTextInputValue("q1") },
                    { name: "🎂 Возраст", value: interaction.fields.getTextInputValue("q2") },
                    { name: "📂 Опыт", value: interaction.fields.getTextInputValue("q3") },
                    { name: "❓ Почему Darkness", value: interaction.fields.getTextInputValue("q4") }
                );

            if (type === "capture") {
                appEmbed.addFields({ name: "🎥 Откаты", value: interaction.fields.getTextInputValue("q5") });
            }

            const appButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_approve_${interaction.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_deny_${interaction.user.id}`).setLabel("Отказ").setStyle(ButtonStyle.Danger)
            );

            await ticket.send({ content: config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" "), embeds: [appEmbed], components: [appButtons] });
            await interaction.reply({ content: `✅ Заявка создана: <#${ticket.id}>`, ephemeral: true });
            return;
        }

        // --- КНОПКИ ПРИНЯТИЯ/ОТЧЕТОВ ---

        if (interaction.isButton()) {
            const [prefix, action, targetId] = interaction.customId.split("_");
            const isStaff = config.ALLOWED_ROLES.some(r => interaction.member.roles.cache.has(r));
            if (!isStaff) return interaction.reply({ content: "У вас нет прав управления.", ephemeral: true });

            // Одобрение отчета по скриншоту
            if (prefix === "rep") {
                if (action === "accept") {
                    salaryData[targetId] = (salaryData[targetId] || 0) + 1000;
                    saveDB(salaryData);
                    await interaction.update({ content: "✅ Одобрено!", components: [], embeds: interaction.message.embeds });
                } else {
                    await interaction.update({ content: "❌ Отклонено.", components: [], embeds: interaction.message.embeds });
                }
                return;
            }

            // Одобрение заявки в тикете
            if (prefix === "app") {
                const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
                
                if (action === "approve") {
                    const isAcademy = interaction.channel.name.startsWith("academy");
                    const roleSet = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    
                    if (targetMember) {
                        for (const rId of roleSet) await targetMember.roles.add(rId).catch(() => null);
                    }

                    await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: false });
                    await interaction.channel.setName(`closed-${targetId}`);
                    await interaction.update({ components: [] });
                    await interaction.channel.send(`🎉 Поздравляем, <@${targetId}>! Вы приняты.\n**Для завершения скиньте скриншот планшета сюда.**`);
                } else {
                    await interaction.channel.send("❌ Заявка отклонена. Канал будет удален...");
                    setTimeout(() => interaction.channel.delete(), 5000);
                }
                return;
            }
        }

    } catch (err) {
        console.error("[INTERACTION ERROR]:", err);
    }
});

// =====================================================
// SYSTEM TERMINATION HANDLERS
// =====================================================
const gracefulShutdown = () => {
    console.log("[SYSTEM] Shutdown initiated. Saving data...");
    saveDB(salaryData);
    client.destroy();
    process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// =====================================================
// BOT LOGIN
// =====================================================
client.login(process.env.TOKEN);

/**
 * END OF FILE
 * Total Logic: Integrated Management, Salary, Monitoring, Spam Groups.
 */
