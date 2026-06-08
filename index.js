require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const fs = require("fs");
const path = require("path");
const express = require("express");

// Уникальный ID запущенной копии бота
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
app.get("/", (_, res) => res.send(`Bot Alive (Instance: ${INSTANCE_ID})`));
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
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message]
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
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            
            REPORT_PANEL: "1513649382396919979", // Канал подачи отчетов
            NOTIFICATIONS: "1513660056338436206", // Канал уведомлений о повышении
            AFK_ROOM: "1500519252518768792" // АФК Канал
        },
        CATEGORIES: {
            APPLICATIONS: "1513659194832719962", // Новая категория для заявок в семью
            REPORTS: "1458410646956806196" // Категория для тикетов-отчетов
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        RANKS: {
            "1": { id: "1513647909965533377", name: "TEST", required: 5, nextRole: "1458485405769797848", nextName: "Academy" },
            "2": { id: "1458485405769797848", name: "Academy", required: 10, nextRole: "1458485351424331903", nextName: "Young" },
            "3": { id: "1458485351424331903", name: "Young", required: 20, nextRole: "1458485277495656553", nextName: "Darkness" },
            "4": { id: "1458485277495656553", name: "Darkness" }
        },
        ACADEMY_ROLES: ["1458410756453306490", "1458485405769797848", "1507798049416675531"],
        CAPTURE_ROLES: ["1458410756453306490", "1475114013611528274"],
        MONITOR_ROLES: [
            { id: "1458485405769797848", name: "Академия" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1507798049416675531", name: "Рекуты" }
        ],
        PING_ROLES: ["1458410756453306490"]
    },
    "1504470399268819115": {
        CHANNELS: { SBOR: "1504574610564321290" },
        PING_ROLES: ["1504470450305241288", "1505558808766971944"]
    }
};

// =====================================================
// DATABASE SYSTEM
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.reportsCount) data.reportsCount = {}; 
        if (!data.memberHistory) data.memberHistory = {}; 
        if (!data.afkList) data.afkList = [];
        return data;
    } catch {
        return { balances: {}, recruits: {}, reportsCount: {}, memberHistory: {}, afkList: [] };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let salary = loadDB();

// =====================================================
// MEMORY STORAGE
// =====================================================
const processed = new Set();
const applications = new Map();
const modalLocks = new Set();

// =====================================================
// SALARY EMBED UPDATE
// =====================================================
async function updateSalaryEmbed(guild) {
    try {
        const config = SERVERS[guild.id];
        if (!config || !config.CHANNELS || !config.CHANNELS.SALARY) return;

        const channel = await guild.channels.fetch(config.CHANNELS.SALARY).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("💰 Ведомость выплат рекрут-состава")
            .setDescription("Актуальный баланс заработанных средств за принятых кандидатов.")
            .setColor("#2b2d31")
            .setTimestamp();

        let listString = "";
        let hasActiveBalances = false;

        for (const [recruiterId, bal] of Object.entries(salary.balances)) {
            if (bal > 0) {
                listString += `• <@${recruiterId}> — **$${bal.toLocaleString()}**\n`;
                hasActiveBalances = true;
            }
        }

        if (!hasActiveBalances) {
            listString = "*На этой неделе выплат пока нет.*";
        }

        embed.addFields({ name: "💵 Текущие балансы рекрутов:", value: listString, inline: false });

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💰 Ведомость выплат")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    } catch (error) {
        console.error(`[SALARY EMBED ERROR]`, error);
    }
}

// =====================================================
// MONITORING & AFK SYSTEM
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

            const embedsArray = [];
            let totalOnline = 0;
            let totalMembersCount = 0;

            const mainEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setTimestamp();

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
                        const isAfk = salary.afkList.includes(member.id);
                        
                        let statusEmoji = "🔴";
                        if (isOnline) {
                            if (isAfk) {
                                statusEmoji = "💤 АФК";
                            } else {
                                statusEmoji = "🟢";
                                roleOnline++;
                                totalOnline++;
                            }
                        }

                        listString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                const roleEmbed = new EmbedBuilder()
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`)
                    .setDescription(listString)
                    .setColor("#2b2d31");

                embedsArray.push(roleEmbed);
            }

            mainEmbed.setDescription(`📈 **Общий онлайн выбранных ролей (без учета АФК):** \`${totalOnline} из ${totalMembersCount}\``);
            embedsArray.unshift(mainEmbed);

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

            if (botMessage) {
                await botMessage.edit({ embeds: embedsArray }).catch(() => null);
            } else {
                await channel.send({ embeds: embedsArray }).catch(() => null);
            }
        }
    } catch (error) {
        console.error(`[MONITOR ERROR]`, error);
    }
}

// Обновление текстового интерфейса AFK-комнаты
async function updateAfkEmbed(guild) {
    const config = SERVERS[guild.id];
    if (!config || !config.CHANNELS.AFK_ROOM) return;

    const channel = await guild.channels.fetch(config.CHANNELS.AFK_ROOM).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("💤 AFK Контроль Состава")
        .setDescription("Используйте кнопки ниже, чтобы зафиксировать ваш статус ухода в АФК.\nУчастникам со статусом АФК не приходят уведомления о сборах.")
        .setColor("#2b2d31")
        .setTimestamp();

    let list = "";
    if (!salary.afkList || salary.afkList.length === 0) {
        list = "*В данный момент никто не находится в АФК.*";
    } else {
        salary.afkList.forEach(id => {
            list += `• <@${id}>\n`;
        });
    }

    embed.addFields({ name: "Сейчас в АФК:", value: list });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("afk_join").setLabel("Встать в АФК").setStyle(ButtonStyle.Secondary).setEmoji("💤"),
        new ButtonBuilder().setCustomId("afk_leave").setLabel("Выйти из АФК").setStyle(ButtonStyle.Success).setEmoji("🏃")
    );

    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const botMsg = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💤 AFK")) : null;

    if (botMsg) {
        await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
    } else {
        await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    }
}

// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить панель управления сборами"),
        new SlashCommandBuilder().setName("delete").setDescription("Полностью очистить все балансы игроков"),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть текущее количество одобренных отчетов"),
        new SlashCommandBuilder().setName("info").setDescription("Посмотреть развернутую информацию о пользователе")
            .addUserOption(opt => opt.setName("user").setDescription("Выберите пользователя").setRequired(true)),
        new SlashCommandBuilder().setName("setup_reports").setDescription("Отправить панель системы отчетов и повышений"),
        new SlashCommandBuilder().setName("setup_afk").setDescription("Инициализировать панель АФК комнаты")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
        }
        console.log(`[BOT] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] Не удалось зарегистрировать команды:`, e);
    }

    for (const guildId of Object.keys(SERVERS)) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (guild) {
            await updateOnlineMonitor();
            await updateAfkEmbed(guild);
        }
    }
    setInterval(updateOnlineMonitor, 60000);
});

// =====================================================
// GUILD MEMBER REMOVE & VOICE INTEGRATION
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        // Очистка из списков АФК при выходе с сервера
        if (salary.afkList && salary.afkList.includes(member.id)) {
            salary.afkList = salary.afkList.filter(id => id !== member.id);
            saveDB(salary);
            await updateAfkEmbed(member.guild);
        }

        if (salary.recruits && salary.recruits[member.id]) {
            const recruiterId = salary.recruits[member.id];
            if (salary.balances[recruiterId]) {
                salary.balances[recruiterId] -= 10000;
                if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
            }
            delete salary.recruits[member.id];
            saveDB(salary);
            await updateSalaryEmbed(member.guild);
        }
    } catch (e) {
        console.error("[ERROR AT MEMBER REMOVE]", e);
    }
});

// =====================================================
// MESSAGE CREATE (PROCESS SCRAP REPORTS)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;
        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // Автоматическая обработка скриншотов в тикетах отчетов или закрытых заявок
        if (msg.channel.name?.startsWith("closed-") || msg.channel.name?.startsWith("report-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            // Если это отчет с планшета закрытой заявки
            if (msg.channel.name.startsWith("closed-")) {
                const channelMessages = await msg.channel.messages.fetch({ limit: 50 });
                const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));
                
                let candidateText = "Не удалось определить";
                let candidateId = "unknown";
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
                    const file = new AttachmentBuilder(att.url, { name: "screen.png" });
                    const auditEmbed = new EmbedBuilder()
                        .setTitle("📋 Отчёт по принятой заявке")
                        .setDescription(`👤 **Администратор:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                        .setImage(`attachment://screen.png`)
                        .setColor("#2b2d31")
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`audit_accept_${msg.author.id}_${candidateId}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`audit_reject_${msg.author.id}_${candidateId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`audit_verify_${candidateId}`).setLabel("Проверить").setStyle(ButtonStyle.Secondary)
                    );

                    await auditChannel.send({ embeds: [auditEmbed], files: [file], components: [row] });
                }

                await msg.channel.send("✅ Отчёт успешно перенаправлен в аудит! Ожидайте подтверждения руководства. Тикет удаляется...");
                setTimeout(() => msg.channel.delete().catch(() => null), 3000);
                setTimeout(updateOnlineMonitor, 4000);
            }
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

            const file = new AttachmentBuilder(att.url, { name: "screen.png" });
            const embed = new EmbedBuilder()
                .setTitle("📸 Новый отчёт")
                .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
                .setImage(`attachment://screen.png`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`accept_${msg.author.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`reject_${msg.author.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await audit.send({ embeds: [embed], files: [file], components: [row] });
            setTimeout(async () => { try { await msg.delete(); } catch {} }, 10000);
        }
    } catch (e) {
        console.log(`[MESSAGE ERROR]`, e);
    }
});

// =====================================================
// INTERACTIONS INTERCEPTOR
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // =====================================================
        // СЛЭШ КОМАНДЫ
        // =====================================================
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                const currentBal = salary.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "rank") {
                const count = salary.reportsCount[i.user.id] || 0;
                const member = await i.guild.members.fetch(i.user.id);
                
                let currentRankName = "Отсутствует";
                let nextRankInfo = "Максимальный ранг достигнут";

                if (config && config.RANKS) {
                    for (const [lvl, rData] of Object.entries(config.RANKS)) {
                        if (member.roles.cache.has(rData.id)) {
                            currentRankName = rData.name;
                            if (rData.required) {
                                nextRankInfo = `Следующий ранг: **${rData.nextName}** (Нужно отчетов: ${count}/${rData.required})`;
                            }
                        }
                    }
                }

                const rankEmbed = new EmbedBuilder()
                    .setTitle(`📊 Карточка Успеваемости — ${i.user.username}`)
                    .setThumbnail(i.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(`Текущий ранг во фракции: **${currentRankName}**\nВсего одобрено отчетов/МП: \`${count}\` шт.\n\n${nextRankInfo}`)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [rankEmbed], ephemeral: true });
                return;
            }

            if (i.commandName === "info") {
                const target = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(target.id).catch(() => null);
                if (!targetMember) {
                    await i.reply({ content: "❌ Пользователь не найден на сервере.", ephemeral: true });
                    return;
                }

                const history = salary.memberHistory[target.id] || { invitedBy: "Неизвестно/Старая база", date: "Данные отсутствуют" };
                const daysOnServer = Math.floor((Date.now() - targetMember.joinedTimestamp) / (1000 * 60 * 60 * 24));

                const infoEmbed = new EmbedBuilder()
                    .setTitle(`ℹ️ Информация о пользователе ${target.username}`)
                    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: "Никнейм / ID", value: `${target.tag} (\`${target.id}\`)`, inline: false },
                        { name: "Кто принял заявку", value: history.invitedBy.startsWith("<@") ? history.invitedBy : `\`${history.invitedBy}\``, inline: true },
                        { name: "Дней на сервере", value: `\`${daysOnServer}\` дней`, inline: true },
                        { name: "Всего отчетов", value: `\`${salary.reportsCount[target.id] || 0}\` шт.`, inline: true }
                    )
                    .setColor("#2b2d31")
                    .setTimestamp();

                const row = new ActionRowBuilder();
                if (history.application) {
                    row.addComponents(new ButtonBuilder().setCustomId(`view_app_${target.id}`).setLabel("Посмотреть заявку").setStyle(ButtonStyle.Primary).setEmoji("📄"));
                } else {
                    row.addComponents(new ButtonBuilder().setCustomId(`disabled_app`).setLabel("Заявка отсутствует").setStyle(ButtonStyle.Secondary).setDisabled(true));
                }

                await i.reply({ embeds: [infoEmbed], components: [row], ephemeral: true });
                return;
            }

            // Настройка системных панелей администрацией
            const hasPermission = config?.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission && ["delete", "panel", "group_panel", "setup_reports", "setup_afk"].includes(i.commandName)) {
                await i.reply({ content: "❌ У вас нет прав для использования этой команды.", ephemeral: true });
                return;
            }

            if (i.commandName === "delete") {
                salary.balances = {};
                salary.recruits = {};
                saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы и привязки игроков были полностью аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "setup_afk") {
                await i.reply({ content: "Инициализация панели...", ephemeral: true });
                await updateAfkEmbed(i.guild);
                return;
            }

            if (i.commandName === "setup_reports") {
                if (!config || !config.CHANNELS.REPORT_PANEL) return;
                const channel = await i.guild.channels.fetch(config.CHANNELS.REPORT_PANEL);

                const embed = new EmbedBuilder()
                    .setTitle("📜 СИСТЕМА ПОВЫШЕНИЙ И ОТЧЕТОВ Darkness")
                    .setDescription(
`Для продвижения по иерархической лестнице семьи вам необходимо своевременно оставлять отчеты о проделанной работе (участии в мероприятиях).

### 📈 КРИТЕРИИ ДЛЯ ПОВЫШЕНИЯ ###

**⭐ 1 ранг (TEST) ➔ 2 ранг (Academy)**
• Участие в **5 МП**
• Смена фамилии на **Darkness**
• Знание общих правил семьи и сервера
• Игровой актив не менее 3-х часов в день

**⭐ 2 ранг (Academy) ➔ 3 ранг (Young)**
• Участие в **10 МП суммарно**
• Умение четко слушать и координировать коллы
• Адекватное поведение во время игрового процесса
• Отсутствие серьезных выговоров, варнов и жалоб

**⭐ 3 ранг (Young) ➔ 4 ранг (Darkness)**
• Участие в **20 МП суммарно**
• Стабильный онлайн (суммарно более 100 часов в игре)
• Активная и созидательная помощь семье во всех аспектах
• Отличные коммуникативные навыки

**⭐ 4 ранг (Darkness) ➔ 5 ранг (Recruit)**
• Умение грамотно и уважительно общаться с составом
• Стабильный онлайн (3+ часа ежедневно)
• Предельная адекватность и хладнокровие
• Высокий уровень персональной ответственности

━━━━━━━━━━━━━━━━━━━━━━━━━━━
**📌 Для отправки выполненной работы нажмите кнопку ниже и заполните форму.**
*Все поля обязательны к заполнению. В графе статика разрешены только цифры.*`
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("open_report_modal").setLabel("Подать отчет").setStyle(ButtonStyle.Primary).setEmoji("📥")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель отчетов успешно установлена!", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(
`Нажмите на выпадающее меню ниже, чтобы подать заявку в нашу семью.

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
• Если заявка была отклонена — это окончательное решение.
• КД на повторную подачу заявки — **2 дня**.`
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
                    await i.reply({ content: "❌ Канал управления группами не найден.", ephemeral: true });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle("📡 Управление сборами групп")
                    .setDescription("Используйте кнопки ниже для запуска ручного управления сборами состава.\n\n**Darkness & Ballas Central Control**")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("group_start_ballas").setLabel("Ballas Gang").setStyle(ButtonStyle.Danger).setEmoji("🍇"),
                    new ButtonBuilder().setCustomId("group_start_darkness").setLabel("Darkness Family").setStyle(ButtonStyle.Primary).setEmoji("🌑")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель сборов отправлена!", ephemeral: true });
                return;
            }
        }

        // =====================================================
        // AFK КНОПКИ ВЗАИМОДЕЙСТВИЯ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("afk_")) {
            const act = i.customId.replace("afk_", "");
            if (!salary.afkList) salary.afkList = [];

            if (act === "join") {
                if (salary.afkList.includes(i.user.id)) {
                    await i.reply({ content: "⚠️ Вы уже находитесь в списке АФК.", ephemeral: true });
                    return;
                }
                salary.afkList.push(i.user.id);
                await i.reply({ content: "💤 Вы успешно вошли в режим АФК. Уведомления о сборах приостановлены.", ephemeral: true });
            } else {
                if (!salary.afkList.includes(i.user.id)) {
                    await i.reply({ content: "⚠️ Вы не находились в списке АФК.", ephemeral: true });
                    return;
                }
                salary.afkList = salary.afkList.filter(id => id !== i.user.id);
                await i.reply({ content: "🏃 Вы вышли из режима АФК и готовы к мероприятиям!", ephemeral: true });
            }

            saveDB(salary);
            await updateAfkEmbed(i.guild);
            await updateOnlineMonitor();
            return;
        }

        // ПОКАЗ СТАРЫХ АНКЕТ ИЗ ИНФО PANEL
        if (i.isButton() && i.customId.startsWith("view_app_")) {
            const uid = i.customId.replace("view_app_", "");
            const history = salary.memberHistory[uid];
            if (!history || !history.application) {
                await i.reply({ content: "❌ Анкета не найдена в базе данных.", ephemeral: true });
                return;
            }

            const oldAppEmbed = new EmbedBuilder()
                .setTitle(`📄 Сохраненная анкета пользователя`)
                .setColor("#2b2d31")
                .setDescription(
`**Статик и ник:** ${history.application.q1}
**Имя и возраст:** ${history.application.q2}
**Опыт в семьях:** ${history.application.q3}
**Почему именно мы:** ${history.application.q4}
${history.application.q5 ? `**Откаты:** ${history.application.q5}` : ""}`
                );

            await i.reply({ embeds: [oldAppEmbed], ephemeral: true });
            return;
        }

        // =====================================================
        // МОДАЛКА ОТЧЕТОВ И ЕЕ ПОДАТЬ И КНОПКИ
        // =====================================================
        if (i.isButton() && i.customId === "open_report_modal") {
            const modal = new ModalBuilder().setCustomId("submit_report_modal").setTitle("Подача отчета о проделанной работе");

            const staticInput = new TextInputBuilder()
                .setCustomId("rep_static")
                .setLabel("СТАТИЧЕСКИЙ ID ИГРОВОГО ПЕРСОНАЖА")
                .setPlaceholder("Например: 21074 (Только цифры!)")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const proofInput = new TextInputBuilder()
                .setCustomId("rep_proof")
                .setLabel("ССЫЛКА НА ДОКАЗАТЕЛЬСТВА (IMGUR/YOUTUBE)")
                .setPlaceholder("https://imgur.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Paragraph);

            modal.addComponents(new ActionRowBuilder().addComponents(staticInput), new ActionRowBuilder().addComponents(proofInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "submit_report_modal") {
            const userStatic = i.fields.getTextInputValue("rep_static").trim();
            const userProof = i.fields.getTextInputValue("rep_proof").trim();

            if (!/^\d+$/.test(userStatic)) {
                await i.reply({ content: "❌ Ошибка! В строке статического ID должны быть исключительно цифры.", ephemeral: true });
                return;
            }

            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const reportChannelName = `report-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');
            const reportCategory = config?.CATEGORIES.REPORTS;

            const ticket = await i.guild.channels.create({
                name: reportChannelName,
                type: ChannelType.GuildText,
                parent: reportCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(r => ({ id: r, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(`📊 Новый отчет на проверку`)
                .setDescription(`👤 **Отправитель:** <@${i.user.id}>\n🆔 **Игровой статик:** \`${userStatic}\`\n\n🔗 **Предоставленные доказательства:**\n${userProof}\n\n*Проверяющая администрация может принять или отклонить данный отчет кнопками ниже.*`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rep_accept_${i.user.id}`).setLabel("Одобрить работу").setStyle(ButtonStyle.Success).setEmoji("✅"),
                new ButtonBuilder().setCustomId(`rep_reject_${i.user.id}`).setLabel("Отклонить работу").setStyle(ButtonStyle.Danger).setEmoji("❌")
            );

            await ticket.send({ embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Ваш тикет-отчет успешно создан: <#${ticket.id}>`, ephemeral: true });
            return;
        }

        // Кнопки обработки тикетов-отчетов
        if (i.isButton() && i.customId.startsWith("rep_")) {
            const hasPerm = config?.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPerm) {
                await i.reply({ content: "❌ У вас нет прав на проверку отчетов.", ephemeral: true });
                return;
            }

            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            if (action === "reject") {
                const targetUser = await client.users.fetch(targetId).catch(() => null);
                if (targetUser) {
                    await targetUser.send(`❌ Привет. Ваш отчет в семье **Darkness** был проверен и **отклонен** администрацией.`).catch(() => null);
                }
                await i.channel.send("❌ Отчет отклонен. Тикет закрывается.");
                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }

            if (action === "accept") {
                if (!salary.reportsCount[targetId]) salary.reportsCount[targetId] = 0;
                salary.reportsCount[targetId] += 1;
                saveDB(salary);

                const currentCount = salary.reportsCount[targetId];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

                await i.channel.send(`✅ Отчет успешно одобрен! Всего принятых МП у игрока: \`${currentCount}\`.`);

                if (targetMember && config && config.RANKS) {
                    let eligibleForUpgrade = false;
                    let nextRankData = null;
                    let currentRankLvl = "1";

                    for (const [lvl, rData] of Object.entries(config.RANKS)) {
                        if (targetMember.roles.cache.has(rData.id)) {
                            currentRankLvl = lvl;
                            if (rData.required && currentCount >= rData.required) {
                                eligibleForUpgrade = true;
                                nextRankData = rData;
                            }
                        }
                    }

                    // Если набралось нужное количество — высылаем уведомление в специальный канал руководства
                    if (eligibleForUpgrade && nextRankData) {
                        const notifChannel = await i.guild.channels.fetch(config.CHANNELS.NOTIFICATIONS).catch(() => null);
                        if (notifChannel) {
                            const upEmbed = new EmbedBuilder()
                                .setTitle("📈 Рекомендация к повышению участника")
                                .setDescription(
`👤 **Участник:** <@${targetId}> (\`${targetId}\`)
📊 **Текущий ранг:** \`${nextRankData.name}\`
🔥 **Количество отчетов:** \`${currentCount}\` из необходимых \`${nextRankData.required}\`

Нажмите кнопку ниже, чтобы автоматически выдать ранг **${nextRankData.nextName}** и забрать прошлые роли.`
                                )
                                .setColor("#2b2d31")
                                .setTimestamp();

                            const upRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`auto_up_${targetId}_${nextRankData.id}_${nextRankData.nextRole}`).setLabel("Повысить игрока").setStyle(ButtonStyle.Success).setEmoji("👑"),
                                new ButtonBuilder().setCustomId(`auto_deny_${targetId}`).setLabel("Отказать в повышении").setStyle(ButtonStyle.Danger)
                            );

                            await notifChannel.send({ embeds: [upEmbed], components: [upRow] });
                        }
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }
        }

        // Кнопки автоматического апгрейда ролей в канале уведомлений
        if (i.isButton() && i.customId.startsWith("auto_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            if (action === "deny") {
                const targetUser = await client.users.fetch(targetId).catch(() => null);
                if (targetUser) {
                    await targetUser.send(`⚠️ Руководство приняло решение пока отложить ваше повышение в семье Darkness. Прокачивайте актив!`).catch(() => null);
                }
                await i.update({ content: "❌ Предложение повышения отклонено.", embeds: [], components: [] });
                return;
            }

            if (action === "up") {
                const oldRoleId = parts[3];
                const newRoleId = parts[4];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

                if (targetMember) {
                    await targetMember.roles.add(newRoleId).catch(() => null);
                    await targetMember.roles.remove(oldRoleId).catch(() => null);
                    await targetMember.send(`🎉 Поздравляем! Ваша заявка-отчет рассмотрена руководством, вам выдан новый ранг на сервере семьи!`).catch(() => null);
                }

                await i.update({ content: `✅ Повышение успешно реализовано модератором <@${i.user.id}>!`, embeds: [], components: [] });
                return;
            }
        }

        // СБОРЫ СИСТЕМЫ (РУЧНОЙ РЕЖИМ) С ФИЛЬТРАЦИЕЙ АФК КЛИЕНТОВ
        if (i.isButton() && i.customId.startsWith("group_start_")) {
            const faction = i.customId.replace("group_start_", "");
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`group_select_${faction}`).setPlaceholder("Выберите тип мероприятия")
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

            const modal = new ModalBuilder().setCustomId(`group_modal_code_${faction}_${activity}`).setTitle("Код группы");
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

            const controlEmbed = new EmbedBuilder()
                .setTitle("⚙️ Панель ручного управления сбором")
                .setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код группы:** \`${code}\``)
                .setColor("Yellow");

            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`sbor_channel_${guildId}_${activity}_${code}`).setLabel("Отправить в канал").setStyle(ButtonStyle.Primary).setEmoji("📣"),
                new ButtonBuilder().setCustomId(`sbor_dms_${guildId}_${activity}_${code}`).setLabel("Отправить в ЛС").setStyle(ButtonStyle.Secondary).setEmoji("📩"),
                new ButtonBuilder().setCustomId("sbor_cancel").setLabel("Отменить / Скрыть").setStyle(ButtonStyle.Danger).setEmoji("❌")
            );

            await i.reply({ embeds: [controlEmbed], components: [controlRow], ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("sbor_")) {
            if (i.customId === "sbor_cancel") {
                await i.update({ content: "✅ Панель управления сбором закрыта.", embeds: [], components: [] });
                return;
            }

            const parts = i.customId.split("_");
            const action = parts[1];
            const guildId = parts[2];
            const activity = parts[3];
            const code = parts[4];

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const tCfg = SERVERS[guildId];
            const pingString = tCfg ? `@everyone ${tCfg.PING_ROLES.map(r => `<@&${r}>`).join(" ")}` : "@everyone";
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(tCfg.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ Сообщение отправлено в канал сбора!", ephemeral: true });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС с фильтрацией АФК...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        tCfg.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !salary.afkList.includes(m.id)
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений (Пользователи в АФК пропущены).` });
                } catch (e) {
                    await i.editReply({ content: "❌ Произошла ошибка рассылки." });
                }
            }
            return;
        }

        // =====================================================
        // ОБРАБОТКА ЗАЯВОК (APPLICATIONS CATEGORY V2)
        // =====================================================
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");
            const logChannel = await i.guild.channels.fetch("1464576279771873353").catch(() => null);

            if (logChannel) {
                const rejectEmbed = new EmbedBuilder()
                    .setTitle("❌ Отказ по заявке")
                    .setDescription(`👤 **Кандидат:** <@${targetId}>\n🔒 **Модератор:** <@${i.user.id}>\n📝 **Причина:** ${reason}`)
                    .setColor("Red")
                    .setTimestamp();
                await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
            }

            await i.reply({ content: `❌ Заявка отклонена.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder().setCustomId(`apply_modal_${type}`).setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?", placeholder: "Увидели рекламу...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат с ГГ от 5 минут", style: TextInputStyle.Paragraph });
            }

            modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
            )));

            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');

            const appCategory = config?.CATEGORIES.APPLICATIONS;
            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: appCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null,
                userId: i.user.id
            };

            // Сохраняем анкетные данные в глобальную базу для команды /info
            salary.memberHistory[i.user.id] = {
                invitedBy: "Ожидает проверки",
                date: new Date().toLocaleDateString("ru-RU"),
                application: data
            };
            saveDB(salary);

            let embedDescription = `**ID и Ник:** ${data.q1}\n**Имя и возраст:** ${data.q2}\n**Опыт:** ${data.q3}\n**Причина выбора:** ${data.q4}`;
            if (type !== "academy") embedDescription += `\n**Откаты:** ${data.q5}`;

            const embed = new EmbedBuilder().setTitle("Заявление").setDescription(embedDescription).setColor("#2b2d31");
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];
            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;

            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон! [Войти в канал](${voiceUrl})`);
            await i.reply({ content: "✅ Ссылка отправлена!", ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("app_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            const embed = EmbedBuilder.from(i.message.embeds[0]);

            if (action === "accept") {
                if (!targetMember) return;
                const isAcademy = i.channel.name.startsWith("academy");
                await targetMember.roles.add(isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES).catch(() => null);

                if (salary.memberHistory[targetId]) {
                    salary.memberHistory[targetId].invitedBy = `<@${i.user.id}>`;
                    saveDB(salary);
                }

                await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false }).catch(() => null);
                await i.channel.setName(`closed-${i.channel.name.replace("academy-", "").replace("capture-", "")}`).catch(() => null);

                embed.setColor("Purple").setTitle("Заявление (Принято)");
                await i.update({ embeds: [embed], components: [] });
                await i.channel.send(`🎉 <@${targetId}> принят! Администратор <@${i.user.id}>, закиньте скриншот планшета сюда.`);
                return;
            }

            if (action === "review") {
                embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                await i.update({ embeds: [embed] });
                return;
            }

            if (action === "call") {
                const voiceMenu = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId(`call_voice_${targetId}`).setPlaceholder("Выберите голосовой канал").addChannelTypes(ChannelType.GuildVoice)
                );
                await i.reply({ content: "Выберите войс-канал для обзвона:", components: [voiceMenu], ephemeral: true });
                return;
            }

            if (action === "reject") {
                const modal = new ModalBuilder().setCustomId(`app_reject_modal_${targetId}`).setTitle("Причина отказа");
                const reasonInput = new TextInputBuilder().setCustomId("reject_reason_input").setLabel("Причина:").setRequired(true).setStyle(TextInputStyle.Paragraph);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await i.showModal(modal);
                return;
            }
        }

        // Кнопки аудита отчетов планшета
        if (i.isButton() && i.customId.startsWith("audit_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const recruiterId = parts[2];
            const candidateId = parts[3];

            if (action === "verify") {
                const isPresent = await i.guild.members.fetch(candidateId).catch(() => null);
                await i.reply({ content: isPresent ? `🟢 Находится на сервере.` : `🔴 Не найден на сервере.`, ephemeral: true });
                return;
            }

            if (action === "reject") {
                await i.message.delete().catch(() => null);
                await i.reply({ content: "Отклонено.", ephemeral: true });
                return;
            }

            if (action === "accept") {
                salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 10000;
                if (candidateId && candidateId !== "unknown") salary.recruits[candidateId] = recruiterId;
                saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.message.delete().catch(() => null);
                await i.reply({ content: "Успешно подтверждено!", ephemeral: true });
                return;
            }
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR]`, e);
    }
});

const shutdown = () => {
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(process.env.TOKEN);
