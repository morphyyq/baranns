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
            CATEGORY: "1513659194832719962", // НОВАЯ КАТЕГОРИЯ ЗАЯВОК (И ТИКЕТОВ)
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            
            // НОВЫЕ КАНАЛЫ
            REPORT_PANEL: "1513649382396919979", // Канал для панели отчетов
            PROMO_NOTIFY: "1513660056338436206", // Канал для уведомлений о повышениях
            AFK_PANEL: "1500519252518768792"     // АФК Канал
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        REPORT_APPROVERS: [ // Те, кто могут принимать отчеты на повышение
            "1471553901433192532", 
            "1458192704524648701", 
            "1458192781217370173"
        ],
        RANKS: {
            TEST: "1513647909965533377", // 1 ранг
            ACADEMY: "1458485405769797848", // 2 ранг
            YOUNG: "1458485351424331903", // 3 ранг
            DARKNESS: "1458485277495656553" // 4 ранг
        },
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
            { id: "1458485405769797848", name: "Academy (2 ранг)" },
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
// DATABASE (Единая база для баланса, отчетов, афк и анкет)
// =====================================================
const DB_FILE = path.join(__dirname, "database.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        return {
            balances: data.balances || {},
            recruits: data.recruits || {},
            reports: data.reports || {},       // { userId: count }
            afk: data.afk || [],               // [userId, ...]
            appsData: data.appsData || {}      // { userId: { recruiterId, timestamp, embed } }
        };
    } catch {
        return { balances: {}, recruits: {}, reports: {}, afk: [], appsData: {} };
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

            const embedsArray = [];
            let totalOnline = 0;
            let totalMembersCount = 0;

            const mainEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setTimestamp();

            for (const roleData of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleData.id);
                if (!role) {
                    embedsArray.push(new EmbedBuilder().setTitle(`❌ ${roleData.name}`).setDescription("Роль не найдена на сервере").setColor("Red"));
                    continue;
                }

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

                const roleEmbed = new EmbedBuilder()
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`)
                    .setDescription(listString)
                    .setColor("#2b2d31");

                embedsArray.push(roleEmbed);
            }

            mainEmbed.setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``);
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
        console.error(`[MONITOR ERROR] [${INSTANCE_ID}] Error updating monitor:`, error);
    }
}


// =====================================================
// HELPER: PROMOTION CHECK
// =====================================================
async function checkPromotion(member, guild, currentCount) {
    const config = SERVERS[guild.id];
    if (!config || !config.RANKS) return;

    const ranks = config.RANKS;
    let shouldPromote = false;
    let targetRole = null;
    let oldRole = null;
    let promoText = "";

    if (member.roles.cache.has(ranks.TEST) && currentCount >= 5) {
        shouldPromote = true;
        targetRole = ranks.ACADEMY;
        oldRole = ranks.TEST;
        promoText = "С 1 ранга (TEST) ➔ 2 ранг (Academy)";
    } else if (member.roles.cache.has(ranks.ACADEMY) && currentCount >= 10) {
        shouldPromote = true;
        targetRole = ranks.YOUNG;
        oldRole = ranks.ACADEMY;
        promoText = "С 2 ранга (Academy) ➔ 3 ранг (Young)";
    } else if (member.roles.cache.has(ranks.YOUNG) && currentCount >= 20) {
        shouldPromote = true;
        targetRole = ranks.DARKNESS;
        oldRole = ranks.YOUNG;
        promoText = "С 3 ранга (Young) ➔ 4 ранг (Darkness)";
    }

    if (shouldPromote) {
        const notifyChannel = await guild.channels.fetch(config.CHANNELS.PROMO_NOTIFY).catch(() => null);
        if (!notifyChannel) return;

        const embed = new EmbedBuilder()
            .setTitle("⬆️ Запрос на повышение")
            .setDescription(`Пользователь <@${member.id}> выполнил норму отчетов!\n\n**Прогресс:** ${currentCount} принятых отчетов\n**Путь:** ${promoText}`)
            .setColor("Gold")
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`promo_acc_${member.id}_${targetRole}_${oldRole}`)
                .setLabel("Принять повышение")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`promo_rej_${member.id}`)
                .setLabel("Отказать")
                .setStyle(ButtonStyle.Danger)
        );

        await notifyChannel.send({ embeds: [embed], components: [row] });
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
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить панель системы повышений"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить панель системы АФК"),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть свою или чужую статистику отчетов")
            .addUserOption(option => option.setName("user").setDescription("Пользователь (оставьте пустым для себя)").setRequired(false)),
        new SlashCommandBuilder().setName("info").setDescription("Посмотреть информацию по заявке игрока")
            .addUserOption(option => option.setName("user").setDescription("Пользователь").setRequired(true))
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
        console.error(`[BOT ERROR] [${INSTANCE_ID}] Не удалось зарегистрировать команды:`, e);
    }

    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);
});


// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        // Убираем из АФК при выходе
        if (db.afk.includes(member.id)) {
            db.afk = db.afk.filter(id => id !== member.id);
            saveDB(db);
        }

        // Логика ЗП
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
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        if (msg.content === "/balance") {
            const currentBal = db.balances[msg.author.id] || 0;
            return msg.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}` });
        }

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ (ОТЧЕТ ПЛАНШЕТА ДЛЯ РЕКРУТОВ)
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
                    new ButtonBuilder()
                        .setCustomId(`audit_accept_${msg.author.id}_${candidateId}`)
                        .setLabel("Принять")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`audit_reject_${msg.author.id}_${candidateId}`)
                        .setLabel("Отказать")
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`audit_verify_${candidateId}`)
                        .setLabel("Проверить")
                        .setStyle(ButtonStyle.Secondary)
                );

                await auditChannel.send({ embeds: [auditEmbed], files: [file], components: [row] });
            }

            await msg.channel.send("✅ Отчёт успешно перенаправлен в аудит! Ожидайте подтверждения руководства. Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

    } catch (e) {
        console.log(`[MESSAGE ERROR] [${INSTANCE_ID}]`, e);
    }
});


// =====================================================
// INTERACTIONS (КОМАНДЫ, КНОПКИ, МОДАЛКИ)
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // ============================
        // СЛЭШ-КОМАНДЫ
        // ============================
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
                    await i.reply({ content: "❌ У вас нет прав для использования этой команды.", ephemeral: true });
                    return;
                }

                db.balances = {};
                db.recruits = {};
                db.reports = {};
                db.appsData = {};
                saveDB(db);
                await updateSalaryEmbed(i.guild);

                await i.reply({ content: "✅ Вся база данных была полностью аннулирована!", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL).catch(() => null);
                if (!channel) return await i.reply({ content: "Канал не найден", ephemeral: true });

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
                        "Используйте кнопки ниже для запуска ручного управления сборами состава.\n\n" +
                        "**Функционал:**\n" +
                        "• Выбор типа мероприятия\n" +
                        "• Ручная панель с кнопками отправки в канал и ЛС\n\n" +
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

            // НОВЫЕ КОМАНДЫ
            if (i.commandName === "report_panel") {
                if (!config || !config.CHANNELS.REPORT_PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.REPORT_PANEL).catch(() => null);
                if (!channel) return await i.reply({ content: "Канал для отчетов не найден", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setImage("https://dummyimage.com/1000x200/ffffff/000000.png&text=%D0%A1%D0%98%D0%A1%D0%A2%D0%95%D0%9C%D0%90+%D0%9F%D0%9E%D0%92%D0%AB%D0%A8%D0%95%D0%9D%D0%98%D0%AF")
                    .setDescription(`**Для повышения вам необходимо выполнять задания и прикреплять доказательства через систему отчетов ниже.**

**С 1 ранга (TEST) ➔ 2 ранг (Academy)**
• 5 МП (Мероприятий)
• Фамилия Darkness
• Знание правил семьи/сервера
• Актив в игре больше 3 часов в день

**С 2 ранга (Academy) ➔ 3 ранг (Young)**
• 10 МП суммарно
• Уметь слушать коллы
• Адекватная игра
• Отсутствие серьёзных нарушений и жалоб

**С 3 ранга (Young) ➔ 4 ранг (Darkness)**
• 20 МП суммарно
• Стабильный онлайн (больше 100 часов в игре)
• Помощь семье, хорошая коммуникация

**С 4 ранга (Darkness) ➔ 5 ранг (Recruit)**
• Уметь грамотно общаться, адекватность
• Стабильный онлайн (3+ часа в день)
• Иметь ответственность

Нажмите на кнопку ниже, чтобы подать отчёт о выполнении МП!`)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_report_modal")
                        .setLabel("Подать отчёт")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("📝")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель системы повышений отправлена!", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                if (!config || !config.CHANNELS.AFK_PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.AFK_PANEL).catch(() => null);
                if (!channel) return await i.reply({ content: "Канал АФК не найден", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("💤 Управление AFK Статусом")
                    .setDescription("Если вы уходите в AFK (отходите от ПК или не сможете играть), нажмите кнопку **«Встать в AFK»**.\n\nПока вы находитесь в AFK, вам **не будут приходить уведомления** в ЛС о сборах на мероприятия.\n\nПо возвращению не забудьте нажать **«Выйти из AFK»**!")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("afk_join")
                        .setLabel("Встать в AFK")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("🛌"),
                    new ButtonBuilder()
                        .setCustomId("afk_leave")
                        .setLabel("Выйти из AFK")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("👋")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель АФК отправлена!", ephemeral: true });
                return;
            }

            if (i.commandName === "rank") {
                const targetUser = i.options.getUser("user") || i.user;
                const reportsCount = db.reports[targetUser.id] || 0;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);

                let rankText = "Нет ранга в системе";
                if (targetMember) {
                    if (targetMember.roles.cache.has(config.RANKS.DARKNESS)) rankText = "4 ранг (Darkness)";
                    else if (targetMember.roles.cache.has(config.RANKS.YOUNG)) rankText = "3 ранг (Young)";
                    else if (targetMember.roles.cache.has(config.RANKS.ACADEMY)) rankText = "2 ранг (Academy)";
                    else if (targetMember.roles.cache.has(config.RANKS.TEST)) rankText = "1 ранг (TEST)";
                }

                const embed = new EmbedBuilder()
                    .setTitle("📊 Статистика активности")
                    .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
                    .addFields(
                        { name: "Текущий статус/ранг:", value: `\`${rankText}\``, inline: true },
                        { name: "Принятых отчетов:", value: `\`${reportsCount}\``, inline: true }
                    )
                    .setColor("#2b2d31")
                    .setThumbnail(targetUser.displayAvatarURL());

                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                
                let daysOnServer = "Неизвестно";
                if (targetMember && targetMember.joinedTimestamp) {
                    const diffTime = Math.abs(Date.now() - targetMember.joinedTimestamp);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    daysOnServer = `${diffDays} дней`;
                }

                const appInfo = db.appsData[targetUser.id];
                const recruiterText = appInfo ? `<@${appInfo.recruiterId}>` : "Нет данных в базе";

                const embed = new EmbedBuilder()
                    .setTitle("ℹ️ Информация об игроке")
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: "Пользователь", value: `<@${targetUser.id}>`, inline: true },
                        { name: "На сервере", value: `\`${daysOnServer}\``, inline: true },
                        { name: "Анкету принял(а)", value: recruiterText, inline: false }
                    )
                    .setColor("#2b2d31");

                const components = [];
                if (appInfo && appInfo.embed) {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`view_app_${targetUser.id}`)
                            .setLabel("Посмотреть анкету")
                            .setStyle(ButtonStyle.Primary)
                    );
                    components.push(row);
                }

                await i.reply({ embeds: [embed], components, ephemeral: false });
                return;
            }
        }

        // =====================================================
        // СБОРЫ (РУЧНОЙ РЕЖИМ) С УЧЕТОМ АФК
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

            const controlEmbed = new EmbedBuilder()
                .setTitle("⚙️ Панель ручного управления сбором")
                .setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код группы:** \`${code}\`\n\nИспользуйте кнопки ниже для рассылки. Кнопку в канал можно нажимать много раз для спама.`)
                .setColor("Yellow");

            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sbor_channel_${guildId}_${activity}_${code}`)
                    .setLabel("Отправить в канал")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📣"),
                new ButtonBuilder()
                    .setCustomId(`sbor_dms_${guildId}_${activity}_${code}`)
                    .setLabel("Отправить в ЛС")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("📩"),
                new ButtonBuilder()
                    .setCustomId("sbor_cancel")
                    .setLabel("Отменить / Скрыть")
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji("❌")
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

            const targetConfig = SERVERS[guildId];
            if (!targetConfig) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${targetConfig.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(targetConfig.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ 1 сообщение успешно отправлено в канал сбора!", ephemeral: true });
                } else {
                    await i.reply({ content: "❌ Ошибка: канал сбора не найден на сервере.", ephemeral: true });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (исключая АФК)...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        targetConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && 
                        !m.user.bot && 
                        !db.afk.includes(m.id) // Исключаем людей в АФК
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений (AFK проигнорированы).` });
                } catch (e) {
                    await i.editReply({ content: "❌ Произошла ошибка при попытке рассылки в ЛС." });
                }
            }
            return;
        }

        // =====================================================
        // AFK СИСТЕМА
        // =====================================================
        if (i.isButton() && i.customId.startsWith("afk_")) {
            const action = i.customId.replace("afk_", "");
            
            if (action === "join") {
                if (!db.afk.includes(i.user.id)) {
                    db.afk.push(i.user.id);
                    saveDB(db);
                }
                await i.reply({ content: "🛏️ Вы успешно **встали в AFK**. Личные сообщения от бота о сборах приостановлены.", ephemeral: true });
            } else if (action === "leave") {
                db.afk = db.afk.filter(id => id !== i.user.id);
                saveDB(db);
                await i.reply({ content: "👋 Вы успешно **вышли из AFK**. Вы снова будете получать уведомления в ЛС.", ephemeral: true });
            }
            return;
        }

        // =====================================================
        // ПРОСМОТР АНКЕТЫ (/info)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("view_app_")) {
            const targetId = i.customId.replace("view_app_", "");
            const appInfo = db.appsData[targetId];

            if (!appInfo || !appInfo.embed) {
                await i.reply({ content: "❌ Анкета не найдена в базе.", ephemeral: true });
                return;
            }

            await i.reply({ embeds: [appInfo.embed], ephemeral: true });
            return;
        }

        // =====================================================
        // СИСТЕМА ПОВЫШЕНИЙ (ОТЧЕТЫ)
        // =====================================================
        if (i.isButton() && i.customId === "open_report_modal") {
            const modal = new ModalBuilder()
                .setCustomId("report_modal_submit")
                .setTitle("Подача отчёта на повышение");

            const staticInput = new TextInputBuilder()
                .setCustomId("report_static")
                .setLabel("Введите ваш статик (только цифры)")
                .setPlaceholder("Например: 12345")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const proofInput = new TextInputBuilder()
                .setCustomId("report_proof")
                .setLabel("Ссылка на доказательства (Imgur/YouTube и т.д.)")
                .setPlaceholder("https://imgur.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Paragraph);

            modal.addComponents(
                new ActionRowBuilder().addComponents(staticInput),
                new ActionRowBuilder().addComponents(proofInput)
            );
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "report_modal_submit") {
            const staticVal = i.fields.getTextInputValue("report_static");
            const proofVal = i.fields.getTextInputValue("report_proof");

            // Проверка, что в статике только цифры
            if (!/^\d+$/.test(staticVal)) {
                await i.reply({ content: "❌ Ошибка: В строке статика должны быть **только цифры**!", ephemeral: true });
                return;
            }

            const expectedChannelName = `report-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.REPORT_APPROVERS.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("📝 Новый отчёт на повышение")
                .setDescription(`**Пользователь:** <@${i.user.id}>\n**Статик:** \`${staticVal}\`\n\n**Доказательства:**\n${proofVal}`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rep_acc_${i.user.id}`)
                    .setLabel("Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`rep_rej_${i.user.id}`)
                    .setLabel("Отказать")
                    .setStyle(ButtonStyle.Danger)
            );

            const pings = config.REPORT_APPROVERS.map(r => `<@&${r}>`).join(" ");
            await channel.send({ content: pings, embeds: [embed], components: [row] });
            
            await i.reply({ content: `✅ Отчет отправлен! Ваш тикет: <#${channel.id}>`, ephemeral: true });
            return;
        }

        // ОБРАБОТКА КНОПОК В ТИКЕТЕ ОТЧЕТА
        if (i.isButton() && i.customId.startsWith("rep_")) {
            const action = i.customId.split("_")[1]; // acc / rej
            const targetId = i.customId.split("_")[2];
            const member = await i.guild.members.fetch(i.user.id);

            const hasPermission = config.REPORT_APPROVERS.some(r => member.roles.cache.has(r));
            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав на проверку отчетов.", ephemeral: true });
                return;
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "rej") {
                await i.message.edit({ components: [] });
                await i.reply({ content: "❌ Отчет отклонен. Тикет закрывается..." });
                if (targetMember) {
                    await targetMember.send(`❌ **Уведомление:** Ваш отчет на повышение был отклонен администратором <@${i.user.id}>. Попробуйте еще раз.`).catch(() => null);
                }
                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }

            if (action === "acc") {
                // Добавляем +1 к статистике
                db.reports[targetId] = (db.reports[targetId] || 0) + 1;
                saveDB(db);

                await i.message.edit({ components: [] });
                await i.reply({ content: `✅ Отчет принят администратором <@${i.user.id}>! Счет отчетов пользователя обновлен. Тикет закрывается...` });
                
                if (targetMember) {
                    await targetMember.send(`✅ **Уведомление:** Ваш отчет на повышение был успешно **принят**! Всего отчетов: ${db.reports[targetId]}.`).catch(() => null);
                    // Проверка на достаточное количество отчетов для повышения
                    await checkPromotion(targetMember, i.guild, db.reports[targetId]);
                }

                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }
        }

        // ОБРАБОТКА КНОПОК ЗАПРОСА НА ПОВЫШЕНИЕ (PROMO NOTIFY)
        if (i.isButton() && i.customId.startsWith("promo_")) {
            const parts = i.customId.split("_");
            const action = parts[1]; // acc / rej
            const targetId = parts[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            const hasPermission = config.REPORT_APPROVERS.some(r => i.member.roles.cache.has(r));
            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });
                return;
            }

            if (action === "rej") {
                const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("Red").setTitle("🛑 Повышение отклонено");
                await i.update({ embeds: [embed], components: [] });
                if (targetMember) {
                    await targetMember.send(`❌ Ваш запрос на повышение был отклонен администрацией.`).catch(() => null);
                }
                return;
            }

            if (action === "acc") {
                const newRole = parts[3];
                const oldRole = parts[4];

                if (targetMember) {
                    await targetMember.roles.add(newRole).catch(() => null);
                    await targetMember.roles.remove(oldRole).catch(() => null);
                    await targetMember.send(`🎉 Поздравляем! Ваше повышение одобрено, выдана новая роль!`).catch(() => null);
                }

                const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("Green").setTitle("✅ Повышение выдано");
                await i.update({ content: `Выдал <@${i.user.id}>`, embeds: [embed], components: [] });
                return;
            }
        }

        // =====================================================
        // ОБРАБОТКА ЗАЯВОК В СЕМЬЮ (ОТКРЫТИЕ И ТИКЕТЫ)
        // =====================================================
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");
            const logChannel = await i.guild.channels.fetch(config.CHANNELS.AUDIT_APP).catch(() => null);

            if (logChannel) {
                const rejectEmbed = new EmbedBuilder()
                    .setTitle("❌ Отказ по заявке в семью")
                    .setDescription(`👤 **Кандидат:** <@${targetId}> (\`${targetId}\`)\n🔒 **Модератор:** <@${i.user.id}>\n📝 **Причина отказа:** ${reason}`)
                    .setColor("Red")
                    .setTimestamp();
                await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) {
                await targetMember.send(`❌ Ваша заявка в семью **Darkness** была отклонена.\n**Причина:** ${reason}`).catch(() => null);
            }

            await i.reply({ content: `❌ Заявка успешно отклонена. Причина зафиксирована.` }).catch(() => null);
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
            
            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**
${data.q1}

**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**
${data.q2}

**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**
${data.q3}

**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**
${data.q4}`;

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

            await channel.send({ content: `${rolesPing}`, embeds: [embed], components: [row] });
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
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовому каналу по прямой ссылке:\n${voiceUrl}`
                }).catch(() => null);
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        // ОБРАБОТКА КНОПОК АУДИТА И ЗАЯВОК (ПРИНЯТЬ/ОТКЛОНИТЬ)
        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            // Кнопки аудита отчетов планшета
            if (parts[0] === "audit") {
                const action = parts[1];

                if (action === "verify") {
                    const cId = parts[2];
                    if (!cId || cId === "unknown") return await i.reply({ content: "❌ Не удалось считать корректный Discord ID кандидата.", ephemeral: true });
                    
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    if (isPresent) await i.reply({ content: `🟢 Пользователь <@${cId}> (\`${cId}\`) **находится** на сервере.`, ephemeral: true });
                    else await i.reply({ content: `🔴 Пользователь с ID \`${cId}\` **не найден** на сервере.`, ephemeral: true });
                    return;
                }

                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "❌ Отчёт планшета отклонён. Сообщение удалено.", ephemeral: true });
                    return;
                }

                if (action === "accept") {
                    db.balances[recruiterId] = (db.balances[recruiterId] || 0) + 10000;
                    if (candidateId && candidateId !== "unknown") db.recruits[candidateId] = recruiterId;
                    
                    saveDB(db);
                    await updateSalaryEmbed(i.guild);

                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "✅ Отчёт успешно подтвержден! Рекрутеру начислено $10,000.", ephemeral: true });
                    return;
                }
            }

            // Управление тикетом (app_)
            if (parts[0] === "app") {
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return await i.reply({ content: "❌ Пользователь вышел с сервера.", ephemeral: true });
                    
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

                    // Сохраняем информацию кто принял (Для /info команды)
                    db.appsData[targetId] = {
                        recruiterId: i.user.id,
                        timestamp: Date.now(),
                        embed: embed.toJSON()
                    };
                    saveDB(db);

                    await i.channel.send({
                        content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчет в аудите.`
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

                    await i.reply({
                        content: "⬇️ Выберите из выпадающего списка ниже войс-канал, в который отправить кандидата:",
                        components: [voiceMenu],
                        ephemeral: true
                    });
                    return;
                }

                if (action === "reject") {
                    const modal = new ModalBuilder()
                        .setCustomId(`app_reject_modal_${targetId}`)
                        .setTitle("Причина отказа по заявке");

                    const reasonInput = new TextInputBuilder()
                        .setCustomId("reject_reason_input")
                        .setLabel("Укажите причину отказа:")
                        .setPlaceholder("Неподходящие откаты / Неадекватное поведение в анкете")
                        .setRequired(true)
                        .setStyle(TextInputStyle.Paragraph);

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
