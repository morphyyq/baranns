require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const fs = require("fs");
const path = require("path");
const express = require("express");

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
        GatewayIntentBits.GuildPresences 
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
            
            // Новые каналы из тех. задания
            REPORTS_PANEL: "1513649382396919979", // Канал кнопки подачи отчетов
            NOTIFICATIONS: "1513660056338436206", // Канал уведомлений о повышении
            AFK_PANEL_CHAN: "1500519252518768792"  // Канал управления АФК
        },
        CATEGORIES: {
            REPORTS_TICKETS: "1458410646956806196", // Сюда летят тикеты отчетов
            APPLICATIONS: "1513659194832719962"     // Новая категория для заявок в семью
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        // Иерархия ролей для системы повышений
        RANKS: {
            R1_TEST: "1513647909965533377",
            R2_ACADEMY: "1458485405769797848",
            R3_YOUNG: "1458485351424331903",
            R4_DARKNESS: "1458485277495656553",
            R5_RECRUIT: "1468704257606684712" // Из старого конфига ролей рекрутов
        },
        PING_ROLES: ["1458410756453306490"]
    },
    "1504470399268819115": {
        CHANNELS: {
            SBOR: "1504574610564321290"
        },
        PING_ROLES: ["1504470450305241288", "1505558808766971944"]
    }
};

// =====================================================
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.reportsCount) data.reportsCount = {}; // ID: общее число одобренных МП
        if (!data.afkUsers) data.afkUsers = [];         // Список ID пользователей в АФК
        if (!data.appsArchive) data.appsArchive = {};   // Архив данных анкет для команды /info
        return data;
    } catch {
        return { balances: {}, recruits: {}, reportsCount: {}, afkUsers: [], appsArchive: {} };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();

// =====================================================
// LOCKS & MEMORY
// =====================================================
const processed = new Set();
const modalLocks = new Set();

// =====================================================
// MONITORING SYSTEM (Обновление списков онлайна)
// =====================================================
async function updateOnlineMonitor() {
    try {
        const mainGuildId = "1458190222042075251";
        const config = SERVERS[mainGuildId];
        if (!config || !config.CHANNELS.MONITOR) return;

        const guild = await client.guilds.fetch(mainGuildId).catch(() => null);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
        if (!channel) return;

        await guild.members.fetch();

        // Сбор ролей для группы "RP Состав"
        const rpRoleIds = [
            config.RANKS.R1_TEST,
            config.RANKS.R2_ACADEMY,
            config.RANKS.R3_YOUNG,
            config.RANKS.R4_DARKNESS
        ];

        // 1. Сбор участников RP Состава
        let rpOnline = 0;
        let rpTotal = 0;
        let rpString = "";
        const rpMembersMap = new Map();

        rpRoleIds.forEach(roleId => {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                role.members.forEach(m => rpMembersMap.set(m.id, m));
            }
        });

        if (rpMembersMap.size === 0) {
            rpString = "*В этой роли никого нет*";
        } else {
            rpMembersMap.forEach(member => {
                rpTotal++;
                const isOnline = member.presence && member.presence.status !== "offline";
                if (isOnline) rpOnline++;
                rpString += `<@${member.id}> — ${isOnline ? "🟢" : "🔴"}\n`;
            });
        }

        // 2. Сбор остальных категорий (Каптеры и Рекруты из старой логики)
        const captersRole = guild.roles.cache.get("1475114013611528274");
        let captersOnline = 0, captersTotal = 0, captersString = "*В этой роли никого нет*";
        if (captersRole) {
            captersString = "";
            captersRole.members.forEach(member => {
                captersTotal++;
                const isOnline = member.presence && member.presence.status !== "offline";
                if (isOnline) captersOnline++;
                captersString += `<@${member.id}> — ${isOnline ? "🟢" : "🔴"}\n`;
            });
        }

        const recruitsRole = guild.roles.cache.get("1468704257606684712");
        let recruitsOnline = 0, recruitsTotal = 0, recruitsString = "*В этой роли никого нет*";
        if (recruitsRole) {
            recruitsString = "";
            recruitsRole.members.forEach(member => {
                recruitsTotal++;
                const isOnline = member.presence && member.presence.status !== "offline";
                if (isOnline) recruitsOnline++;
                recruitsString += `<@${member.id}> — ${isOnline ? "🟢" : "🔴"}\n`;
            });
        }

        const totalOnline = rpOnline + captersOnline + recruitsOnline;
        const totalMembersCount = rpTotal + captersTotal + recruitsTotal;

        const mainEmbed = new EmbedBuilder()
            .setTitle("📊 Мониторинг активного состава семьи")
            .setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``)
            .setColor("#2b2d31")
            .setTimestamp();

        const embedRp = new EmbedBuilder()
            .setTitle(`👥 RP Состав [В сети: ${rpOnline}/${rpTotal}]`)
            .setDescription(rpString)
            .setColor("#2b2d31");

        const embedCapters = new EmbedBuilder()
            .setTitle(`👥 Каптеры [В сети: ${captersOnline}/${captersTotal}]`)
            .setDescription(captersString)
            .setColor("#2b2d31");

        const embedRecruits = new EmbedBuilder()
            .setTitle(`👥 Рекруты [В сети: ${recruitsOnline}/${recruitsTotal}]`)
            .setDescription(recruitsString)
            .setColor("#2b2d31");

        const embedsArray = [mainEmbed, embedRp, embedCapters, embedRecruits];

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: embedsArray }).catch(() => null);
        } else {
            await channel.send({ embeds: embedsArray }).catch(() => null);
        }
    } catch (error) {
        console.error(`[MONITOR ERROR]`, error);
    }
}

// =====================================================
// AFK SYSTEM EMBED UPDATER
// =====================================================
async function updateAfkPanel(guild) {
    try {
        const config = SERVERS[guild.id];
        if (!config || !config.CHANNELS.AFK_PANEL_CHAN) return;

        const channel = await guild.channels.fetch(config.CHANNELS.AFK_PANEL_CHAN).catch(() => null);
        if (!channel) return;

        let listString = "";
        if (db.afkUsers.length === 0) {
            listString = "*В данный момент никто не находится в AFK.*";
        } else {
            db.afkUsers.forEach(id => {
                listString += `• <@${id}>\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("💤 Статус-панель отошедших участников (AFK)")
            .setDescription("Если вы отходите от ПК или не можете принимать участие в жизни фракции, пожалуйста, нажмите кнопку ниже, чтобы зафиксировать ваш статус.\n\n" +
                            "⚠️ **Внимание:** Находящиеся в AFK пользователи исключаются из автоматических экстренных рассылок и сборов фракции.\n\n" +
                            "**Текущий список участников в AFK:**\n" + listString)
            .setColor("#2b2d31")
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("afk_go").setLabel("Встать в АФК").setStyle(ButtonStyle.Primary).setEmoji("💤"),
            new ButtonBuilder().setCustomId("afk_leave").setLabel("Выйти из АФК").setStyle(ButtonStyle.Success).setEmoji("🏃")
        );

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💤 Статус-панель")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed], components: [row] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
        }
    } catch (e) {
        console.error("[AFK PANEL UPDATE ERROR]", e);
    }
}

// =====================================================
// SALARY EMBED SYSTEM
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
            .setColor("Green")
            .setTimestamp();

        let listString = "";
        let hasActiveBalances = false;

        for (const [recruiterId, bal] of Object.entries(db.balances)) {
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
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить панель управления сборами"),
        new SlashCommandBuilder().setName("delete").setDescription("Полностью очистить все балансы игроков"),
        new SlashCommandBuilder().setName("rank_panel").setDescription("Отправить панель системы повышения"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Вызвать статус-панель управления AFK"),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику выполненных отчетов")
            .addUserOption(opt => opt.setName("user").setDescription("Выберите пользователя (необязательно)")),
        new SlashCommandBuilder().setName("info").setDescription("Посмотреть досье и архивную заявку пользователя")
            .addUserOption(opt => opt.setName("user").setDescription("Выберите пользователя").setRequired(true))
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Начало обновления слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] Не удалось зарегистрировать команды:`, e);
    }

    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);

    const mainGuild = client.guilds.cache.get("1458190222042075251");
    if (mainGuild) await updateAfkPanel(mainGuild);
});

// =====================================================
// LEAVE MEMBER EVENT
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        // Удаляем из AFK если вышел с сервера
        if (db.afkUsers.includes(member.id)) {
            db.afkUsers = db.afkUsers.filter(id => id !== member.id);
            saveDB(db);
            await updateAfkPanel(member.guild);
        }

        if (db.recruits && db.recruits[member.id]) {
            const recruiterId = db.recruits[member.id];
            if (db.balances[recruiterId]) {
                db.balances[recruiterId] -= 10000;
                if (db.balances[recruiterId] < 0) db.balances[recruiterId] = 0;
            }
            delete db.recruits[member.id];
            saveDB(db);
            await updateSalaryEmbed(member.guild);
        }
    } catch (e) {
        console.error("[ERROR AT MEMBER REMOVE]", e);
    }
});

// =====================================================
// MESSAGE SYSTEM (SCREEN AUDIT & CHANNELS)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;
        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ ЗАЯВОК (ОТЧЕТ ПЛАНШЕТА)
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

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

            // Записываем модератора, который принял человека
            if (candidateId !== "unknown") {
                if (!db.appsArchive[candidateId]) db.appsArchive[candidateId] = {};
                db.appsArchive[candidateId].acceptedBy = msg.author.id;
                saveDB(db);
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                const file = new AttachmentBuilder(att.url, { name: "screen.png" });
                
                const auditEmbed = new EmbedBuilder()
                    .setTitle("📋 Отчёт по принятой заявке")
                    .setDescription(`👤 **Администратор:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                    .setImage(`attachment://screen.png`)
                    .setColor("Purple")
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

            const file = new AttachmentBuilder(att.url, { name: "screen.png" });

            const embed = new EmbedBuilder()
                .setTitle("📸 Новый отчёт")
                .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
                .setImage(`attachment://screen.png`)
                .setColor("Blue")
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
// HELPER FUNCS FOR PROMOTIONS
// =====================================================
function getRankRequirementText() {
    return `### 📈 Система повышений семьи Darkness ###
Отправляйте отчёты о проделанной работе для автоматического повышения в должности.

🔷 **С 1 ранга (TEST) > 2 ранг (Academy)**
• **5 МП** (отчетов)
• Фамилия Darkness
• Знание правил семьи/сервера
• Актив в игре больше 3 часов в день

🔷 **С 2 ранга (Academy) > 3 ранг (Young)**
• **10 МП** суммарно
• Уметь слушать коллы и адекватная игра
• Отсутствие серьёзных нарушений

🔷 **С 3 ранга (Young) > 4 ранг (Darkness)**
• **20 МП** суммарно
• Стабильный онлайн (больше 100 часов в игре)
• Помощь семье, хорошая коммуникация

🔷 **С 4 ранга (Darkness) > 5 ранг (Recruit)**
• Уметь грамотно общаться, адекватность
• Стабильный онлайн (3+ часа в день)
• Иметь ответственность

━━━━━━━━━━━━━━━━━━━━━━━━━━
### ⚠️ ПРАВИЛА ПОДАЧИ ОТЧЕТА: ###
1. В поле **"Статик"** вводите **строго только цифры**.
2. В поле **"Доказательства"** должна быть рабочая **ссылка** (Imgur / YouTube и т.д.).
3. **Без ссылки на скриншот/откат отчёт будет моментально отклонён!**

Вы можете проверить свою статистику командой: \`/rank\``;
}

function checkRankProgress(member, currentCount) {
    const mainGuildId = "1458190222042075251";
    const config = SERVERS[mainGuildId];
    if (!config) return null;

    const roles = member.roles.cache;

    if (roles.has(config.RANKS.R1_TEST) && currentCount >= 5) {
        return { nextRankName: "Academy", nextRoleId: config.RANKS.R2_ACADEMY, currentRoleId: config.RANKS.R1_TEST, req: 5 };
    }
    if (roles.has(config.RANKS.R2_ACADEMY) && currentCount >= 10) {
        return { nextRankName: "Young", nextRoleId: config.RANKS.R3_YOUNG, currentRoleId: config.RANKS.R2_ACADEMY, req: 10 };
    }
    if (roles.has(config.RANKS.R3_YOUNG) && currentCount >= 20) {
        return { nextRankName: "Darkness", nextRoleId: config.RANKS.R4_DARKNESS, currentRoleId: config.RANKS.R3_YOUNG, req: 20 };
    }
    return null;
}

// =====================================================
// INTERACTIONS (COMMANDS, BUTTONS, MODALS)
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // 1. СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                const currentBal = db.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "delete") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) {
                    return i.reply({ content: "❌ У вас нет прав для использования этой команды.", ephemeral: true });
                }
                db.balances = {};
                db.recruits = {};
                saveDB(db);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы и привязки игроков были полностью аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(
                        `Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.\n\n` +
                        `⏳ **Время рассмотрения заявки:** от 1 до 4 дней.\n\n` +
                        `### 🎬 RP-Content состав ###\n• Возможность дальнейшего развития в семье\n• Откаты стрельбы — **не требуются**\n\n` +
                        `### 🔥 Main состав ###\n• Требуются откаты стрельбы от **5 минут GG**\nили\n• Откаты с любой МП/капта/массового мероприятия\n\n` +
                        `━━━━━━━━━━━━━━\n\n` +
                        `### ⚠️ Важно ознакомиться перед подачей заявки ###\n\n` +
                        `• Заявки, оформленные без соблюдения правил (без откатов и т.д.), отклоняются моментально.\n` +
                        `• Мы не принимаем детей, фриков и неадекватных людей.\n` +
                        `• Заявки рассматриваются строго в порядке очереди. Не нужно флудить или торопить администрацию.\n` +
                        `• У нас нет отдельных местах только под капты или MCL — вы вступаете в тему и участвуете во всём контенте.\n` +
                        `• Если заявка была отклонена — это окончательное решение.\n` +
                        `• КД на повторную подачу заявки — **2 дня**.\n\n` +
                        `**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**`
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
                if (!channel) return i.reply({ content: "❌ Канал не найден.", ephemeral: true });

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

            if (i.commandName === "rank_panel") {
                if (!config || !config.CHANNELS.REPORTS_PANEL) return i.reply({ content: "Ошибка конфигурации", ephemeral: true });
                const chan = await i.guild.channels.fetch(config.CHANNELS.REPORTS_PANEL).catch(() => null);
                if (!chan) return i.reply({ content: "Канал не найден", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("📋 Система повышений семьи Darkness")
                    .setDescription(getRankRequirementText())
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("submit_report_btn").setLabel("Подать отчет").setStyle(ButtonStyle.Success).setEmoji("📝")
                );

                await chan.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель отчетов отправлена!", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                await i.deferReply({ ephemeral: true });
                await updateAfkPanel(i.guild);
                await i.editReply({ content: "✅ Статус-панель AFK вызвана/обновлена!" });
                return;
            }

            if (i.commandName === "rank") {
                const targetUser = i.options.getUser("user") || i.user;
                const totalRep = db.reportsCount[targetUser.id] || 0;
                
                const embed = new EmbedBuilder()
                    .setTitle(`📊 Статистика игрока — ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`• **Всего принятых МП/отчетов:** \`${totalRep}\``)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const member = await i.guild.members.fetch(targetUser.id).catch(() => null);
                if (!member) return i.reply({ content: "Пользователь не найден на сервере.", ephemeral: true });

                const arch = db.appsArchive[targetUser.id] || {};
                const acceptedByText = arch.acceptedBy ? `<@${arch.acceptedBy}>` : "`Нет данных`";
                
                const diffTime = Math.abs(new Date() - member.joinedAt);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                const embed = new EmbedBuilder()
                    .setTitle(`🗂️ Досье участника: ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `• **Пользователь:** <@${targetUser.id}>\n` +
                        `• **Кто принимал в тикете:** ${acceptedByText}\n` +
                        `• **Дней на сервере:** \`${diffDays} дней\` (с ${member.joinedAt.toLocaleDateString("ru-RU")})`
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder();
                if (arch.fields) {
                    row.addComponents(
                        new ButtonBuilder().setCustomId(`view_archived_app_${targetUser.id}`).setLabel("Посмотреть анкету").setStyle(ButtonStyle.Secondary).setEmoji("📄")
                    );
                } else {
                    row.addComponents(
                        new ButtonBuilder().setCustomId("disabled_app").setLabel("Анкета отсутствует").setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                }

                await i.reply({ embeds: [embed], components: [row], ephemeral: true });
                return;
            }
        }

        // 2. ОБРАБОТКА МАССОВЫХ СБОРОВ (МЕНЮ И РАССЫЛКА)
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
                .setCustomId("group_code_input").setLabel("Введите код группы из 5 символов").setPlaceholder("Например: YFKVQ")
                .setMinLength(5).setMaxLength(5).setRequired(true).setStyle(TextInputStyle.Short);

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

            const srvConfig = SERVERS[guildId];
            if (!srvConfig) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${srvConfig.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(srvConfig.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ Сообщение успешно отправлено в канал сбора!", ephemeral: true });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС фракции (за исключением игроков в AFK)...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        srvConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !db.afkUsers.includes(m.id)
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений (AFK пропущены).` });
                } catch (e) {
                    await i.editReply({ content: "❌ Ошибка массовой рассылки." });
                }
            }
            return;
        }

        // 3. АФК КНОПКИ
        if (i.isButton() && i.customId.startsWith("afk_")) {
            const action = i.customId.replace("afk_", "");
            if (action === "go") {
                if (db.afkUsers.includes(i.user.id)) {
                    return i.reply({ content: "⚠️ Вы уже находитесь в списке AFK.", ephemeral: true });
                }
                db.afkUsers.push(i.user.id);
                saveDB(db);
                await updateAfkPanel(i.guild);
                await i.reply({ content: "💤 Вы успешно вошли в статус AFK. Оповещения отключены.", ephemeral: true });
            } else if (action === "leave") {
                if (!db.afkUsers.includes(i.user.id)) {
                    return i.reply({ content: "⚠️ Вас не было в списке AFK.", ephemeral: true });
                }
                db.afkUsers = db.afkUsers.filter(id => id !== i.user.id);
                saveDB(db);
                await updateAfkPanel(i.guild);
                await i.reply({ content: "🏃 Вы вышли из статуса AFK. Рассылки снова доступны.", ephemeral: true });
            }
            return;
        }

        // 4. СИСТЕМА ПОВЫШЕНИЙ (ОТЧЕТЫ): МОДАЛКА И ОБРАБОТКА ТИКЕТА
        if (i.isButton() && i.customId === "submit_report_btn") {
            const modal = new ModalBuilder().setCustomId("report_modal_submit").setTitle("Подача отчета о проделанной работе");

            const staticInput = new TextInputBuilder()
                .setCustomId("rep_static").setLabel("ВВЕДИТЕ СТАТИК ИГРОВОГО ПЕРСОНАЖА")
                .setPlaceholder("Например: 21074").setRequired(true).setStyle(TextInputStyle.Short);

            const proofInput = new TextInputBuilder()
                .setCustomId("rep_proof").setLabel("ПРИКРЕПИТЕ ДОКАЗАТЕЛЬСТВО (ССЫЛКА)")
                .setPlaceholder("https://imgur.com/... или https://youtube.com/...").setRequired(true).setStyle(TextInputStyle.Paragraph);

            modal.addComponents(new ActionRowBuilder().addComponents(staticInput), new ActionRowBuilder().addComponents(proofInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "report_modal_submit") {
            const staticId = i.fields.getTextInputValue("rep_static").trim();
            const proofLink = i.fields.getTextInputValue("rep_proof").trim();

            if (!/^\d+$/.test(staticId)) {
                return i.reply({ content: "❌ Ошибка! В поле 'Статик' разрешено вводить только цифры.", ephemeral: true });
            }

            const urlRegex = /(https?:\/\/[^\s]+)/;
            if (!urlRegex.test(proofLink)) {
                return i.reply({ content: "❌ Ошибка! Необходимо указать корректную прямую рабочую ссылку в поле доказательств.", ephemeral: true });
            }

            await i.reply({ content: "⏳ Создаем тикет вашего отчета...", ephemeral: true });

            const ticketChan = await i.guild.channels.create({
                name: `report-${i.user.username}`,
                type: ChannelType.GuildText,
                parent: config.CATEGORIES.REPORTS_TICKETS,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(r => ({ id: r, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("📝 Новый отчет на проверку")
                .setDescription(`👤 **Отправитель:** <@${i.user.id}>\n🔢 **Статик:** \`${staticId}\`\n🔗 **Доказательства:** ${proofLink}`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rep_accept_${i.user.id}`).setLabel("Принять отчет").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rep_reject_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            await ticketChan.send({ content: `${config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ")}`, embeds: [embed], components: [row] });
            await i.editReply({ content: `✅ Ваш отчет отправлен в тикет: <#${ticketChan.id}>` });
            return;
        }

        // ОБРАБОТКА ВНУТРИ ТИКЕТА ОТЧЕТОВ
        if (i.isButton() && i.customId.startsWith("rep_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ У вас нет прав модератора.", ephemeral: true });

            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                if (targetMember) {
                    await targetMember.send("❌ **Ваш отчет на повышение был отклонен модерацией.** Проверьте правильность ссылок или статика.").catch(() => null);
                }
                await i.reply({ content: "Отчет отклонен, тикет удаляется..." });
                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }

            if (action === "accept") {
                db.reportsCount[targetId] = (db.reportsCount[targetId] || 0) + 1;
                saveDB(db);

                await i.reply({ content: "Отчет успешно одобрен! Проверяем необходимость повышения..." });

                if (targetMember) {
                    const isRankUpAvailable = checkRankProgress(targetMember, db.reportsCount[targetId]);
                    if (isRankUpAvailable) {
                        const notifChan = await i.guild.channels.fetch(config.CHANNELS.NOTIFICATIONS).catch(() => null);
                        if (notifChan) {
                            const notifEmbed = new EmbedBuilder()
                                .setTitle("🔼 Обнаружено право на повышение состава")
                                .setDescription(`Игрок <@${targetId}> набрал \`${db.reportsCount[targetId]}\` отчетов.\nТребуется перевести с <@&${isRankUpAvailable.currentRoleId}> на роль <@&${isRankUpAvailable.nextRoleId}> (\`${isRankUpAvailable.nextRankName}\`).`)
                                .setColor("#2b2d31")
                                .setTimestamp();

                            const notifRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`prom_accept_${targetId}_${isRankUpAvailable.currentRoleId}_${isRankUpAvailable.nextRoleId}`).setLabel("Повысить").setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`prom_reject_${targetId}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
                            );
                            await notifChan.send({ content: `${config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ")}`, embeds: [notifEmbed], components: [notifRow] });
                        }
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }
        }

        // КНОПКИ В КАНАЛЕ УВЕДОМЛЕНИЙ ПОВЫШЕНИЙ
        if (i.isButton() && i.customId.startsWith("prom_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ Нет прав.", ephemeral: true });

            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                if (targetMember) {
                    await targetMember.send("❌ Вам было отказано в одобрении повышения руководством семьи.").catch(() => null);
                }
                await i.message.delete().catch(() => null);
                await i.reply({ content: "Повышение аннулировано.", ephemeral: true });
                return;
            }

            if (action === "accept") {
                const oldRole = parts[3];
                const newRole = parts[4];

                if (targetMember) {
                    await targetMember.roles.remove(oldRole).catch(() => null);
                    await targetMember.roles.add(newRole).catch(() => null);
                    await targetMember.send(`🎉 **Поздравляем! Вы были официально повышены должностным лицом фракции до новой роли!**`).catch(() => null);
                }
                await i.message.delete().catch(() => null);
                await i.reply({ content: "✅ Роли успешно обновлены!", ephemeral: true });
                setTimeout(updateOnlineMonitor, 3000);
                return;
            }
        }

        // ПРОСМОТР АРХИВНОЙ АНКЕТЫ ИЗ ДОСЬЕ (/INFO)
        if (i.isButton() && i.customId.startsWith("view_archived_app_")) {
            const targetId = i.customId.replace("view_archived_app_", "");
            const arch = db.appsArchive[targetId];
            if (!arch || !arch.fields) return i.reply({ content: "Анкета не найдена.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`📄 Архив анкеты пользователя с ID ${targetId}`)
                .setColor("#2b2d31");

            let desc = `**Тип заявки:** ${arch.type.toUpperCase()}\n\n`;
            Object.entries(arch.fields).forEach(([k, v]) => {
                desc += `**[${k.toUpperCase()}]**\n${v}\n\n`;
            });
            embed.setDescription(desc);

            await i.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // 5. ОБРАБОТКА ИНТЕРАКЦИЙ СИСТЕМЫ ЗАЯВОК В СЕМЬЮ (ОБНОВЛЕННАЯ С КАТЕГОРИЯМИ И АРХИВАЦИЕЙ)
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");

            const logChannelId = "1464576279771873353";
            const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);

            if (logChannel) {
                const rejectEmbed = new EmbedBuilder()
                    .setTitle("❌ Отказ по заявке в семью")
                    .setDescription(`👤 **Кандидат:** <@${targetId}> (\`${targetId}\`)\n🔒 **Модератор:** <@${i.user.id}>\n📝 **Причина отказа:** ${reason}`)
                    .setColor("Red")
                    .setTimestamp();
                await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
            }

            await i.reply({ content: `❌ Заявка успешно отклонена. Тикет закрывается.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

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

        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);
            const existingChannel = i.guild.channels.cache.find(c => c.parentId === config.CATEGORIES.APPLICATIONS && c.name === expectedChannelName);

            if (existingChannel) {
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
                return;
            }

            // Архивируем данные полей анкеты для будущей команды /info
            const fieldsData = {
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4")
            };
            if (type !== "academy") fieldsData.q5 = i.fields.getTextInputValue("q5");

            db.appsArchive[i.user.id] = {
                type: type,
                fields: fieldsData,
                acceptedBy: null
            };
            saveDB(db);

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CATEGORIES.APPLICATIONS, // Новая категория для создания тикетов анкет
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n${fieldsData.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n${fieldsData.q2}\n\n**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${fieldsData.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n${fieldsData.q4}`;
            if (type !== "academy") embedDescription += `\n\n**Предоставьте свои откаты**\n${fieldsData.q5}`;
            embedDescription += `\n\n**Пользователь**\n<@${i.user.id}>`;

            const embed = new EmbedBuilder()
                .setTitle("Заявление")
                .setDescription(embedDescription)
                .setColor("#1f8b4c")
                .addFields({ name: "Username", value: i.user.username, inline: true }, { name: "ID", value: i.user.id, inline: true });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: `${rolesPing}\n**Предыдущие заявки:**\nЗаявок не найдено.`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

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
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** была проверена.\nТебя вызвали на обзвон! Ссылка: ${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, у вас закрыты личные сообщения!`).catch(() => null);
                });
            }
            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            if (parts[0] === "group" && parts[1] === "start") return;
            if (parts[0] === "rep") return;
            if (parts[0] === "prom") return;
            if (i.customId.startsWith("view_archived_")) return;

            // ОБРАБОТКА ДЛЯ КАНАЛА АУДИТА СТАРЫХ КНОПОК ПЛАНШЕТА
            if (parts[0] === "audit") {
                const action = parts[1];
                if (action === "verify") {
                    const cId = parts[2];
                    if (!cId || cId === "unknown") return i.reply({ content: "Неверный ID", ephemeral: true });
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    return i.reply({ content: isPresent ? `🟢 Пользователь <@${cId}> находится на сервере.` : `🔴 На сервере не найден.`, ephemeral: true });
                }

                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) return i.reply({ content: "Нет прав.", ephemeral: true });

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "Отчёт отклонён.", ephemeral: true });
                }
                if (action === "accept") {
                    db.balances[recruiterId] = (db.balances[recruiterId] || 0) + 10000;
                    if (candidateId && candidateId !== "unknown") db.recruits[candidateId] = recruiterId;
                    saveDB(db);
                    await updateSalaryEmbed(i.guild);
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "✅ Отчёт подтвержден! Начислено $10,000.", ephemeral: true });
                }
            }

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ У вас нет прав для нажатия этих кнопок.", ephemeral: true });

            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    db.balances[targetId] = (db.balances[targetId] || 0) + 1000;
                    saveDB(db);
                    await updateSalaryEmbed(i.guild);
                    embed.setColor("Green").setTitle("📸 Отчёт одобрен");
                    await i.update({ embeds: [embed], components: [] });
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                    await i.update({ embeds: [embed], components: [] });
                }
                return;
            }

            if (parts[0] === "app") {
                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Пользователь вышел с сервера.", ephemeral: true });
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    // Выдаем соответствующие роли на основе типа заявки
                    const rolesToAdd = isAcademy ? [config.RANKS.R2_ACADEMY] : ["1475114013611528274"];
                    await targetMember.roles.add(rolesToAdd).catch(() => null);

                    await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false }).catch(() => null);
                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send({ content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, отправьте сюда скриншот с планшета, чтобы зафиксировать отчет в аудите.` });
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
                        new ChannelSelectMenuBuilder().setCustomId(`call_voice_${targetId}`).setPlaceholder("Выберите голосовой канал для кандидата").addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "⬇️ Выберите войс-канал из списка ниже:", components: [voiceMenu], ephemeral: true });
                    return;
                }

                if (action === "reject") {
                    const modal = new ModalBuilder().setCustomId(`app_reject_modal_${targetId}`).setTitle("Причина отказа по заявке");
                    const reasonInput = new TextInputBuilder()
                        .setCustomId("reject_reason_input").setLabel("Укажите причину отказа:").setPlaceholder("Неподходящие откаты").setRequired(true).setStyle(TextInputStyle.Paragraph);
                    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                    await i.showModal(modal);
                    return;
                }
            }
        }
    } catch (e) {
        console.log(`[INTERACTION ERROR HANDLED]`, e);
    }
});

// =====================================================
// SHUTDOWN
// =====================================================
const shutdown = () => {
    console.log(`[BOT] [${INSTANCE_ID}] Получен сигнал выключения. Отключаюсь...`);
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
