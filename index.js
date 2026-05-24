/**
 * ======================================================================================
 * DARKNESS & BALLAS - TOTAL MANAGEMENT SYSTEM
 * ======================================================================================
 * ПРЕДУПРЕЖДЕНИЕ: ДАННЫЙ КОД ЯВЛЯЕТСЯ ПОЛНОЙ ВЕРСИЕЙ СО ВСЕМИ ПРОВЕРКАМИ.
 * ВКЛЮЧАЕТ: МОНИТОРИНГ, ЗАРПЛАТЫ, ТИКЕТЫ, СПАМ-СИСТЕМУ СБОРОВ.
 * ======================================================================================
 */

require("dotenv").config();

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
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

// ======================================================================================
// SERVER KEEP-ALIVE SECTION
// ======================================================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    const statusInfo = {
        status: "Online",
        timestamp: new Date().toISOString(),
        version: "4.0.0-EXTENDED"
    };
    res.send(`<h1>System Status: OK</h1><pre>${JSON.stringify(statusInfo, null, 2)}</pre>`);
});

app.listen(PORT, () => {
    console.log(`[SYSTEM] Keep-alive server is active on port ${PORT}`);
});

// ======================================================================================
// DISCORD CLIENT INITIALIZATION
// ======================================================================================

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

// ======================================================================================
// GLOBAL SETTINGS & ID CONFIGURATION
// ======================================================================================

const SERVERS = {
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
        GROUP_ROLE: "1458410756453306490"
    },
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

const GROUP_CONTROL_CHANNEL = "1508112178610438327";

// ======================================================================================
// PERSISTENT DATA MANAGEMENT (SALARY DATABASE)
// ======================================================================================

const SALARY_FILE_PATH = path.join(__dirname, "salary.json");

/**
 * Инициализация и загрузка базы данных.
 */
function initDatabase() {
    console.log("[DATABASE] Checking for salary.json...");
    if (!fs.existsSync(SALARY_FILE_PATH)) {
        console.log("[DATABASE] Creating new database file.");
        fs.writeFileSync(SALARY_FILE_PATH, JSON.stringify({}, null, 4));
        return {};
    }
    try {
        const data = fs.readFileSync(SALARY_FILE_PATH, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error("[DATABASE] Error reading file:", err);
        return {};
    }
}

/**
 * Синхронизация данных с диском.
 */
function syncDatabase(data) {
    try {
        fs.writeFileSync(SALARY_FILE_PATH, JSON.stringify(data, null, 4));
        // console.log("[DATABASE] Successfully synchronized.");
    } catch (err) {
        console.error("[DATABASE] Sync error:", err);
    }
}

let salaryCache = initDatabase();

// ======================================================================================
// MONITORING SYSTEM (ONLINE TRACKER)
// ======================================================================================

async function executeOnlineMonitor() {
    console.log("[MONITOR] Starting update cycle...");
    
    for (const [guildId, config] of Object.entries(SERVERS)) {
        if (!config.CHANNELS.MONITOR) continue;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            console.error(`[MONITOR] Could not fetch guild ${guildId}`);
            continue;
        }

        const monitorChannel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
        if (!monitorChannel) {
            console.error(`[MONITOR] Channel not found in ${guild.name}`);
            continue;
        }

        // Обновляем кэш всех участников
        await guild.members.fetch();

        const monitorEmbed = new EmbedBuilder()
            .setTitle("📊 МОНИТОРИНГ АКТИВНОГО СОСТАВА")
            .setColor("#2b2d31")
            .setTimestamp()
            .setFooter({ text: "Данные обновляются автоматически раз в минуту" });

        let totalOnlineCount = 0;
        let totalOverallMembers = 0;

        for (const roleData of config.MONITOR_ROLES) {
            const discordRole = guild.roles.cache.get(roleData.id);
            if (!discordRole) continue;

            let memberStatusList = "";
            let onlineInRole = 0;
            const roleMembers = Array.from(discordRole.members.values());

            if (roleMembers.length === 0) {
                memberStatusList = "🔸 *Участники отсутствуют*";
            } else {
                for (const member of roleMembers) {
                    totalOverallMembers++;
                    const isOnline = member.presence && member.presence.status !== "offline";
                    
                    if (isOnline) {
                        onlineInRole++;
                        totalOnlineCount++;
                        memberStatusList += `🟢 <@${member.id}>\n`;
                    } else {
                        memberStatusList += `🔴 <@${member.id}>\n`;
                    }
                }
            }

            // Добавляем поле для каждого отдела
            monitorEmbed.addFields({
                name: `${roleData.name} [В сети: ${onlineInRole}/${discordRole.members.size}]`,
                value: memberStatusList.length > 1024 ? memberStatusList.substring(0, 1020) + "..." : memberStatusList,
                inline: false
            });
        }

        monitorEmbed.setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnlineCount}\` из \`${totalOverallMembers}\``);

        // Поиск старого сообщения мониторинга
        const messages = await monitorChannel.messages.fetch({ limit: 20 }).catch(() => null);
        const existingMessage = messages?.find(m => m.author.id === client.user.id && m.embeds[0]?.title === "📊 МОНИТОРИНГ АКТИВНОГО СОСТАВА");

        if (existingMessage) {
            await existingMessage.edit({ embeds: [monitorEmbed] }).catch(err => console.error("[MONITOR] Edit error:", err));
        } else {
            await monitorChannel.send({ embeds: [monitorEmbed] }).catch(err => console.error("[MONITOR] Send error:", err));
        }
    }
}

// ======================================================================================
// SPAM & NOTIFICATION SYSTEM (SBOR)
// ======================================================================================

const activeSpamIntervals = new Map();

/**
 * Запуск цикла оповещений.
 */
async function initiateSpam(guildId, organization, type, groupCode) {
    const config = SERVERS[guildId];
    if (!config) return;

    const intervalKey = `${guildId}_${type}_${groupCode}`;
    
    // Если уже запущен такой же спам - останавливаем старый
    if (activeSpamIntervals.has(intervalKey)) {
        clearInterval(activeSpamIntervals.get(intervalKey));
    }

    const broadcastTask = async () => {
        const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
        if (!targetGuild) return;

        const sborChannel = await targetGuild.channels.fetch(config.CHANNELS.SBOR).catch(() => null);
        if (!sborChannel) return;

        let rolePings = "";
        if (guildId === "1458190222042075251") {
            rolePings = `<@&${config.GROUP_ROLE}>`;
        } else {
            rolePings = config.GROUP_ROLES.map(r => `<@&${r}>`).join(" ");
        }

        const alertContent = `🚨 **ВНИМАНИЕ! ВСЕМ ЗАЙТИ В ИГРУ!** 🚨\n\n` +
                             `${rolePings} @everyone\n\n` +
                             `> **МЕРОПРИЯТИЕ:** ${type.toUpperCase()}\n` +
                             `> **КОД ГРУППЫ:** \`${groupCode.toUpperCase()}\`\n\n` +
                             `*СБОР ЯВЛЯЕТСЯ ОБЯЗАТЕЛЬНЫМ. НЕЯВКА БЕЗ ПРИЧИНЫ — ВЫГОВОР.*`;

        // 3 сообщения в канал для привлечения внимания
        for (let i = 0; i < 3; i++) {
            await sborChannel.send(alertContent).catch(() => null);
        }

        // Рассылка в личные сообщения тем, кто в сети
        await targetGuild.members.fetch();
        const activeMembers = targetGuild.members.cache.filter(m => !m.user.bot && (
            guildId === "1458190222042075251" ? m.roles.cache.has(config.GROUP_ROLE) : config.GROUP_ROLES.some(r => m.roles.cache.has(r))
        ));

        activeMembers.forEach(member => {
            const dmAlert = `🚨 **СРОЧНЫЙ СБОР НА ${type.toUpperCase()}!** 🚨\n\n` +
                            `Ты нужен фракции прямо сейчас. Заходи в игру!\n` +
                            `**Код группы:** \`${groupCode.toUpperCase()}\``;
            
            // 3 сообщения в ЛС
            for (let j = 0; j < 3; j++) {
                member.send(dmAlert).catch(() => {
                    // console.log(`[SPAM] Could not DM ${member.user.tag}`);
                });
            }
        });
    };

    // Первый запуск мгновенно
    await broadcastTask();

    // Интервал 5 минут
    const timer = setInterval(broadcastTask, 300000);
    activeSpamIntervals.set(intervalKey, timer);

    // Автоматическая остановка через 30 минут
    setTimeout(() => {
        if (activeSpamIntervals.has(intervalKey)) {
            clearInterval(activeSpamIntervals.get(intervalKey));
            activeSpamIntervals.delete(intervalKey);
            console.log(`[SPAM] Session ${intervalKey} auto-terminated.`);
        }
    }, 1800000);
}

// ======================================================================================
// INTERACTION CONTROLLER (THE BRAIN)
// ======================================================================================

client.on(Events.InteractionCreate, async (interaction) => {
    
    // --- 1. Обработка слэш-команд ---
    if (interaction.isChatInputCommand()) {
        const { commandName, guildId } = interaction;
        const config = SERVERS[guildId];

        if (commandName === "panel") {
            if (!config) return interaction.reply({ content: "Ошибка конфигурации.", ephemeral: true });

            const panelEmbed = new EmbedBuilder()
                .setTitle("🌑 ПОДАЧА ЗАЯВЛЕНИЯ В DARKNESS FAMILY")
                .setDescription("Если вы хотите присоединиться к нам, выберите интересующее вас направление.")
                .setColor("#2b2d31")
                .setThumbnail(interaction.guild.iconURL());

            const panelMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("select_apply_type")
                    .setPlaceholder("Выберите тип состава")
                    .addOptions(
                        { label: "Academy (Рекрут)", description: "Обучение и карьера", value: "academy", emoji: "🎓" },
                        { label: "Capture (Капт)", description: "Для опытных стрелков", value: "capture", emoji: "🔫" }
                    )
            );

            await interaction.channel.send({ embeds: [panelEmbed], components: [panelMenu] });
            return interaction.reply({ content: "Панель успешно выставлена.", ephemeral: true });
        }

        if (commandName === "balance") {
            const userBalance = salaryCache[interaction.user.id] || 0;
            return interaction.reply({ content: `💳 Ваш текущий баланс: **${userBalance}**`, ephemeral: true });
        }
    }

    // --- 2. Обработка выпадающих списков ---
    if (interaction.isStringSelectMenu()) {
        const { customId, values, guildId } = interaction;

        // Выбор типа заявки
        if (customId === "select_apply_type") {
            const type = values[0];
            const applyModal = new ModalBuilder()
                .setCustomId(`modal_apply_${type}`)
                .setTitle(type === "academy" ? "Заявка: Академия" : "Заявка: Капт-состав");

            const qNick = new TextInputBuilder().setCustomId("nick").setLabel("Ваш ник и статик").setStyle(TextInputStyle.Short).setRequired(true);
            const qAge = new TextInputBuilder().setCustomId("age").setLabel("Сколько вам лет?").setStyle(TextInputStyle.Short).setRequired(true);
            const qExp = new TextInputBuilder().setCustomId("exp").setLabel("Опыт в криминальных структурах").setStyle(TextInputStyle.Paragraph).setRequired(true);
            const qWhy = new TextInputBuilder().setCustomId("why").setLabel("Почему выбрали именно нас?").setStyle(TextInputStyle.Paragraph).setRequired(true);

            const row1 = new ActionRowBuilder().addComponents(qNick);
            const row2 = new ActionRowBuilder().addComponents(qAge);
            const row3 = new ActionRowBuilder().addComponents(qExp);
            const row4 = new ActionRowBuilder().addComponents(qWhy);

            const modalComponents = [row1, row2, row3, row4];

            if (type === "capture") {
                const qRec = new TextInputBuilder().setCustomId("rec").setLabel("Ссылки на откаты (YouTube/Imgur)").setStyle(TextInputStyle.Paragraph).setRequired(true);
                modalComponents.push(new ActionRowBuilder().addComponents(qRec));
            }

            applyModal.addComponents(...modalComponents);
            await interaction.showModal(applyModal);
        }

        // Выбор мероприятия для сбора
        if (customId.startsWith("select_sbor_event_")) {
            const organization = customId.split("_")[3];
            const eventType = values[0];

            const codeModal = new ModalBuilder()
                .setCustomId(`modal_sbor_finalize_${organization}_${eventType}`)
                .setTitle("Подтверждение сбора");

            const codeInput = new TextInputBuilder()
                .setCustomId("group_code")
                .setLabel("Введите 5-значный код группы")
                .setPlaceholder("Например: AF512")
                .setStyle(TextInputStyle.Short)
                .setMinLength(5)
                .setMaxLength(5)
                .setRequired(true);

            codeModal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            await interaction.showModal(codeModal);
        }
    }

    // --- 3. Обработка модальных окон ---
    if (interaction.isModalSubmit()) {
        const { customId, fields, guildId, user } = interaction;
        const config = SERVERS[guildId];

        // Финализация сбора
        if (customId.startsWith("modal_sbor_finalize_")) {
            const [, , , org, event] = customId.split("_");
            const code = fields.getTextInputValue("group_code");

            const targetGuildId = org === "ballas" ? "1504470399268819115" : "1458190222042075251";
            
            await initiateSpam(targetGuildId, org, event, code);
            return interaction.reply({ content: `✅ **СИСТЕМА ЗАПУЩЕНА!**\nСбор на: **${event}**\nКод: \`${code.toUpperCase()}\`\n\n*Оповещения будут приходить каждые 5 минут.*`, ephemeral: true });
        }

        // Подача заявки
        if (customId.startsWith("modal_apply_")) {
            const type = customId.split("_")[2];
            
            // Создание тикет-канала
            const ticketName = `${type}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            
            const existingChannel = interaction.guild.channels.cache.find(c => c.name === ticketName);
            if (existingChannel) return interaction.reply({ content: `У вас уже открыт тикет: <#${existingChannel.id}>`, ephemeral: true });

            const ticket = await interaction.guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ...config.ALLOWED_ROLES.map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setTitle(`НОВАЯ ЗАЯВКА - ${type.toUpperCase()}`)
                .setColor(type === "academy" ? "#3498DB" : "#E74C3C")
                .addFields(
                    { name: "👤 Кандидат", value: `<@${user.id}> (${user.tag})` },
                    { name: "🆔 Ник и Статик", value: fields.getTextInputValue("nick") },
                    { name: "🎂 Возраст", value: fields.getTextInputValue("age") },
                    { name: "📂 Опыт", value: fields.getTextInputValue("exp") },
                    { name: "🎯 Мотивация", value: fields.getTextInputValue("why") }
                );

            if (type === "capture") {
                ticketEmbed.addFields({ name: "🎥 Откаты", value: fields.getTextInputValue("rec") });
            }

            const ticketButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`btn_app_accept_${user.id}`).setLabel("Одобрить").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`btn_app_reject_${user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            await ticket.send({ 
                content: config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" "), 
                embeds: [ticketEmbed], 
                components: [ticketButtons] 
            });

            return interaction.reply({ content: `Ваш тикет создан: <#${ticket.id}>`, ephemeral: true });
        }
    }

    // --- 4. Обработка кнопок ---
    if (interaction.isButton()) {
        const { customId, guildId, member, user } = interaction;
        const config = SERVERS[guildId];

        // Управление сборами через главную панель
        if (customId.startsWith("btn_sbor_trigger_")) {
            const org = customId.split("_")[3];
            
            const sborSelect = new StringSelectMenuBuilder()
                .setCustomId(`select_sbor_event_${org}`)
                .setPlaceholder("Выберите тип активности");

            if (org === "ballas") {
                sborSelect.addOptions(
                    { label: "Цеха", value: "цеха", emoji: "🏭" },
                    { label: "Диллеры", value: "диллеры", emoji: "📦" },
                    { label: "Остров", value: "остров", emoji: "🏝️" },
                    { label: "Поставки", value: "поставки", emoji: "🚛" },
                    { label: "ФЗ", value: "фз", emoji: "⚔️" },
                    { label: "Банк", value: "банк", emoji: "💰" }
                );
            } else {
                sborSelect.addOptions(
                    { label: "Капты", value: "капты", emoji: "🔫" },
                    { label: "Контент", value: "контент", emoji: "🎭" },
                    { label: "Арена", value: "арена", emoji: "🏟️" },
                    { label: "Тайники", value: "тайники", emoji: "💎" }
                );
            }

            return interaction.reply({ 
                content: "Выберите мероприятие для запуска оповещения:", 
                components: [new ActionRowBuilder().addComponents(sborSelect)], 
                ephemeral: true 
            });
        }

        // Кнопки в тикетах заявок
        if (customId.startsWith("btn_app_")) {
            const [, , action, targetUserId] = customId.split("_");
            const isStaff = config.ALLOWED_ROLES.some(r => member.roles.cache.has(r));

            if (!isStaff) return interaction.reply({ content: "У вас нет прав на это действие.", ephemeral: true });

            const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

            if (action === "accept") {
                const isAcademy = interaction.channel.name.startsWith("academy");
                const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;

                if (targetMember) {
                    for (const rId of rolesToAdd) {
                        await targetMember.roles.add(rId).catch(() => null);
                    }
                }

                // Закрываем доступ кандидату, чтобы он не писал лишнего
                await interaction.channel.permissionOverwrites.edit(targetUserId, { ViewChannel: false });
                await interaction.channel.setName(`closed-${targetUserId}`);
                
                await interaction.update({ components: [] });
                await interaction.channel.send("✅ Кандидат одобрен. Роли выданы автоматически.\n\n**ОЖИДАНИЕ СКРИНШОТА ПЛАНШЕТА ДЛЯ РЕГИСТРАЦИИ.**");
            } else {
                await interaction.channel.send("❌ Заявка отклонена. Канал будет удален через 10 секунд.");
                setTimeout(() => interaction.channel.delete().catch(() => null), 10000);
            }
        }

        // Кнопки одобрения зарплат
        if (customId.startsWith("btn_sal_")) {
            const [, , action, targetUserId] = customId.split("_");
            const isStaff = config.ALLOWED_ROLES.some(r => member.roles.cache.has(r));

            if (!isStaff) return interaction.reply({ content: "У вас нет прав.", ephemeral: true });

            if (action === "ok") {
                salaryCache[targetUserId] = (salaryCache[targetUserId] || 0) + 1000;
                syncDatabase(salaryCache);
                
                await interaction.update({ content: "✅ **Отчет одобрен. +1000 к балансу.**", components: [], embeds: interaction.message.embeds });
            } else {
                await interaction.update({ content: "❌ **Отчет отклонен.**", components: [], embeds: interaction.message.embeds });
            }
        }
    }
});

// ======================================================================================
// MESSAGE HANDLER (SCREENS & TICKETS)
// ======================================================================================

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const config = SERVERS[message.guild.id];
    if (!config) return;

    // 1. Канал для скриншотов (Зарплаты)
    if (message.channel.id === config.CHANNELS.SCREEN) {
        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith("image")) {
            // Удаляем сообщения без картинок
            return setTimeout(() => message.delete().catch(() => null), 2000);
        }

        const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
        if (!auditChannel) return;

        const salaryEmbed = new EmbedBuilder()
            .setTitle("📸 ОТЧЕТ: СКРИНШОТ ПЛАНШЕТА")
            .setDescription(`👤 Отправитель: <@${message.author.id}>\nСтатус: Ожидание проверки`)
            .setImage(attachment.url)
            .setColor("#FAA61A")
            .setTimestamp();

        const salaryRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_sal_ok_${message.author.id}`).setLabel("Одобрить (+1000)").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_sal_no_${message.author.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
        );

        await auditChannel.send({ embeds: [salaryEmbed], components: [salaryRow] });
        
        // Удаляем оригинал через паузу
        setTimeout(() => message.delete().catch(() => null), 5000);
    }

    // 2. Обработка скриншотов в закрытых тикетах (Регистрация)
    if (message.channel.name && message.channel.name.startsWith("closed-")) {
        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith("image")) return;

        // Проверяем, является ли отправитель админом
        const isStaff = config.ALLOWED_ROLES.some(r => message.member.roles.cache.has(r));
        if (!isStaff) return;

        const targetUid = message.channel.name.split("-")[1];
        const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
        
        if (auditChannel) {
            const finalEmbed = new EmbedBuilder()
                .setTitle("📋 РЕГИСТРАЦИЯ НОВОГО БОЙЦА")
                .setDescription(`👤 **Администратор:** <@${message.author.id}>\n👤 **Новобранец:** <@${targetUid}>\n📁 **Источник:** ${message.channel.name}`)
                .setImage(attachment.url)
                .setColor("#43B581")
                .setTimestamp();

            await auditChannel.send({ embeds: [finalEmbed] });
        }

        await message.channel.send("✅ Данные получены. Тикет закрывается.");
        setTimeout(() => message.channel.delete().catch(() => null), 5000);
    }
});

// ======================================================================================
// LIFECYCLE & STARTUP
// ======================================================================================

client.once(Events.ClientReady, async () => {
    console.log(`[BOOT] Logged in as ${client.user.tag}`);

    // Регистрация слэш-команд
    const slashCommands = [
        new SlashCommandBuilder()
            .setName("panel")
            .setDescription("Создать панель подачи заявки (Только для Админов)")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName("balance")
            .setDescription("Посмотреть свой баланс")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log("[BOOT] Refreshing slash commands...");
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommands });
        }
        console.log("[BOOT] Slash commands synchronized.");
    } catch (err) {
        console.error("[BOOT] Slash command error:", err);
    }

    // Инициализация мониторинга
    await executeOnlineMonitor();
    setInterval(executeOnlineMonitor, 60000);

    // Инициализация центра управления сборами
    const groupChannel = await client.channels.fetch(GROUP_CONTROL_CHANNEL).catch(() => null);
    if (groupChannel) {
        const controlEmbed = new EmbedBuilder()
            .setTitle("📡 ЦЕНТР УПРАВЛЕНИЯ СБОРАМИ")
            .setDescription("Используйте кнопки ниже для запуска автоматического оповещения состава.")
            .setColor("#36393f")
            .addFields(
                { name: "🍇 Ballas Gang", value: "Оповещение всего состава банды", inline: true },
                { name: "🌑 Darkness Family", value: "Оповещение основного состава семьи", inline: true }
            );

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("btn_sbor_trigger_ballas").setLabel("Сбор Ballas").setStyle(ButtonStyle.Danger).setEmoji("🍇"),
            new ButtonBuilder().setCustomId("btn_sbor_trigger_family").setLabel("Сбор Darkness").setStyle(ButtonStyle.Primary).setEmoji("🌑")
        );

        const messages = await groupChannel.messages.fetch({ limit: 10 });
        const existingPanel = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === "📡 ЦЕНТР УПРАВЛЕНИЯ СБОРАМИ");

        if (existingPanel) {
            await existingPanel.edit({ embeds: [controlEmbed], components: [controlRow] });
        } else {
            await groupChannel.send({ embeds: [controlEmbed], components: [controlRow] });
        }
    }

    console.log("[BOOT] System is fully operational.");
});

// Глобальная обработка ошибок для предотвращения падений
process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
});

client.login(process.env.TOKEN);
