require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const { MongoClient } = require("mongodb");
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
            CATEGORY: "1513659194832719962", 
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076", 
            SBOR: "1458481307351781709",
            NOTIFY_PROMO: "1513660056338436206",
            REPORT_CATEGORY: "1458410646956806196",
            MAIN: "1503001219201761301",
            MAIN_CATEGORY: "1503001195919184023",
            RECRUIT: "1499701507619291206",
            RECRUIT_CATEGORY: "1499701418435809380",
            AUDIT_MAIN: "1503377972541915357",
            AUDIT_RECRUIT: "1507665992497496176",
            AFK: "1520898805103595772"
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1468704257606684712" 
        ],
        ACADEMY_ROLES: [
            "1458410756453306490",
            "1507798049416675531",
            "1513647909965533377"
        ],
        CAPTURE_ROLES: [
            "1458410756453306490",
            "1475114013611528274"
        ],
        MAIN_ROLES: [
            "1475114013611528274"
        ],
        MONITOR_ROLES: [
            { id: ["1513647909965533377", "1458485405769797848", "1458485351424331903", "1458485277495656553"], name: "РП Состав" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1468704257606684712", name: "Рекруты" }
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
// МП СИСТЕМА — МАДЖЕСТИК РП
// =====================================================
const MP_TYPES = {
    "Цеха":    { win: 15, lose: 7 },
    "Диллеры": { win: 15, lose: 7 },
    "Дроп":    { win: 20, lose: 10 },
    "Бизаки":  { win: 8,  lose: 3 },
    "Арена":   { win: 4,  lose: 0 },
    "Остров":  { win: 15, lose: 7 },
    "Тайники": { win: 5,  lose: 2 },
    "Капт":    { win: 20, lose: 10 }
};


// =====================================================
// МП ПОРОГИ ПОВЫШЕНИЯ РАНГОВ
// =====================================================
const MP_RANK_THRESHOLDS = [
    { points: 50,  from: "1513647909965533377", to: "1458485405769797848", label: "1 → 2 ранг" },
    { points: 100, from: "1458485405769797848", to: "1458485351424331903", label: "2 → 3 ранг" },
    { points: 150, from: "1458485351424331903", to: "1458485277495656553", label: "3 → 4 ранг" }
];

const MP_REVIEW_CHANNEL   = "1519416871328288798"; // канал модерации
const MP_REJECTED_CHANNEL = "1519417766380179658"; // канал отклонений

// =====================================================
// DATABASE (MONGODB)
// =====================================================
let db;
let salary = { balances: {}, recruits: {}, reports: {}, afk: {}, archive: {}, auditMessages: {}, mpPoints: {}, mpHistory: {} };

async function connectDB() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db("darknessbot");
    console.log(`[DB] Подключено к MongoDB`);

    // Загружаем все данные из MongoDB в память при старте
    const docs = await db.collection("salary").find({}).toArray();
    for (const doc of docs) {
        if (doc._id === "balances") salary.balances = doc.data || {};
        else if (doc._id === "recruits") salary.recruits = doc.data || {};
        else if (doc._id === "reports") salary.reports = doc.data || {};
        else if (doc._id === "afk") salary.afk = doc.data || {};
        else if (doc._id === "archive") salary.archive = doc.data || {};
        else if (doc._id === "auditMessages") salary.auditMessages = doc.data || {};
        else if (doc._id === "mpPoints") salary.mpPoints = doc.data || {};
        else if (doc._id === "mpHistory") salary.mpHistory = doc.data || {};
    }
    console.log(`[DB] Данные загружены из MongoDB`);
}

async function saveDB(data) {
    // Сохраняем все секции параллельно
    await Promise.all([
        db.collection("salary").updateOne({ _id: "balances" }, { $set: { data: data.balances } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "recruits" }, { $set: { data: data.recruits } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "reports" }, { $set: { data: data.reports } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "afk" }, { $set: { data: data.afk } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "archive" }, { $set: { data: data.archive } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "auditMessages" }, { $set: { data: data.auditMessages } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "mpPoints" }, { $set: { data: data.mpPoints } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "mpHistory" }, { $set: { data: data.mpHistory } }, { upsert: true }),
    ]);
}


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
                let matchedMembers = [];
                
                if (Array.isArray(roleData.id)) {
                    roleData.id.forEach(id => {
                        const r = guild.roles.cache.get(id);
                        if (r) matchedMembers.push(...Array.from(r.members.values()));
                    });
                    matchedMembers = [...new Set(matchedMembers)];
                } else {
                    const role = guild.roles.cache.get(roleData.id);
                    if (role) matchedMembers = Array.from(role.members.values());
                }

                let listString = "";
                let roleOnline = 0;

                if (matchedMembers.length === 0) {
                    listString = "*В этой роли никого нет*";
                } else {
                    matchedMembers.forEach(member => {
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
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${matchedMembers.length}]`)
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
// AFK SYSTEM EMBED UPDATER — стиль как в игре
// =====================================================
async function updateAFKEmbed(guild) {
    try {
        const config = SERVERS[guild.id];
        const afkChannelId = config?.CHANNELS?.AFK || "1520898805103595772";
        const channel = await guild.channels.fetch(afkChannelId).catch(() => null);
        if (!channel) return;

        const afkEntries = Object.entries(salary.afk);
        const total = afkEntries.length;

        // Формируем список участников в АФК как в игре: ник, причина, Вернусь в HH:MM:SS
        let listLines = "";
        afkEntries.forEach(([userId, data], idx) => {
            // data может быть строкой (старый формат) или объектом (новый)
            let reason = "афк";
            let returnTime = null;
            let returnTimestamp = null;

            if (typeof data === "object" && data !== null) {
                reason = data.reason || "афк";
                returnTimestamp = data.returnAt || null;
            } else {
                // старый формат — просто дата начала АФК
                returnTimestamp = null;
            }

            const returnStr = returnTimestamp
                ? `<t:${Math.floor(returnTimestamp / 1000)}:T>`
                : "—";

            listLines += `**${idx + 1}) <@${userId}>** Причина : \`${reason}\` Вернусь в : ${returnStr}\n`;
        });

        if (!listLines) listLines = "*В данный момент никто не находится в АФК режиме.*";

        const embed = new EmbedBuilder()
            .setTitle(`⏱ Люди, находящиеся в АФК:`)
            .setDescription(`**Всего в афк ${total} человек:**\n\n${listLines}`)
            .setColor("#1a1a2e")
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("afk_enter").setLabel("Отошел АФК").setStyle(ButtonStyle.Secondary).setEmoji("💤"),
            new ButtonBuilder().setCustomId("afk_leave").setLabel("Вернулся из АФК").setStyle(ButtonStyle.Secondary).setEmoji("🟢")
        );

        const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes("АФК")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed], components: [row] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
        }
    } catch (e) {
        console.error("[AFK EMBED UPDATE ERROR]", e);
    }
}


// =====================================================
// SYNC CROSS-SERVER JOIN ROLES
// =====================================================
client.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id === "1504470399268819115") {
        const darknessGuild = await client.guilds.fetch("1458190222042075251").catch(() => null);
        if (darknessGuild) {
            const isMemberOfDarkness = await darknessGuild.members.fetch(member.id).catch(() => null);
            if (isMemberOfDarkness) {
                await member.roles.add("1504470450305241288").catch(() => null);
            }
        }
    }
});


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("all")
            .setDescription("Разослать сообщение в ЛС всему составу")
            .addStringOption(opt => 
                opt.setName("message")
                .setDescription("Текст, который будет отправлен в ЛС")
                .setRequired(true)
            )
            .setDefaultMemberPermissions(0),
        
        // --- ОБНОВЛЕННАЯ КОМАНДА /panel ---
        new SlashCommandBuilder()
            .setName("panel")
            .setDescription("Отправить panel для подачи заявок")
            .addAttachmentOption(opt => 
                opt.setName("image")
                .setDescription("Прикрепите картинку для баннера панели")
                .setRequired(true)
            )
            .setDefaultMemberPermissions(0),

        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить panel управления сборами").setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("reset_salary")
            .setDescription("Полностью очистить все балансы игроков")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("deduct")
            .setDescription("Снять сумму с баланса рекрута")
            .addUserOption(opt =>
                opt.setName("user").setDescription("Рекрут").setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("amount").setDescription("Сумма для списания (например 10000)").setRequired(true).setMinValue(1)
            )
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("add_salary")
            .setDescription("Добавить зарплату рекруту")
            .addUserOption(opt =>
                opt.setName("user").setDescription("Рекрут").setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("amount").setDescription("Сумма для начисления (например 10000)").setRequired(true).setMinValue(1)
            )
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить широкую panel системы повышений").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить panel ручного управления АФК статусом").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("afk_list").setDescription("Вызвать / обновить панель АФК списка в канале").setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("afk_kick")
            .setDescription("Кикнуть участника из АФК с причиной (отправит ЛС)")
            .addUserOption(opt => opt.setName("user").setDescription("Участник в АФК").setRequired(true))
            .addStringOption(opt => opt.setName("reason").setDescription("Причина кика из АФК").setRequired(true))
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("composition_panel").setDescription("Отправить ручную panel контроля состава").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("main_panel").setDescription("Отправить панель заявки в Main состав").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("recruit_panel").setDescription("Отправить панель заявки в отдел Recruit").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику выполненных отчетов").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя")).setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("info").setDescription("Получить личное дело и карточку заявки игрока").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя").setRequired(true)).setDefaultMemberPermissions(0),

        // МП СИСТЕМА
        new SlashCommandBuilder().setName("mp_panel").setDescription("Отправить панель отчётов об МПшках").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("mp_points").setDescription("Посмотреть свои МП баллы").addUserOption(opt => opt.setName("user").setDescription("Посмотреть баллы другого игрока")),
        new SlashCommandBuilder().setName("mp_history").setDescription("Создать ветку с историей скринов игрока").addUserOption(opt => opt.setName("user").setDescription("Игрок").setRequired(true)).setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("mp_deduct")
            .setDescription("Снять МП баллы с игрока")
            .addUserOption(opt => opt.setName("user").setDescription("Игрок").setRequired(true))
            .addIntegerOption(opt => opt.setName("amount").setDescription("Кол-во баллов для снятия").setRequired(true).setMinValue(1))
            .setDefaultMemberPermissions(0),

        // ПАНЕЛЬ ВЗАИМОДЕЙСТВИЯ
        new SlashCommandBuilder()
            .setName("interaction_panel")
            .setDescription("Отправить панель взаимодействия с функционалом бота")
            .setDefaultMemberPermissions(0)
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

    const mainGuild = await client.guilds.fetch("1458190222042075251").catch(() => null);
    if (mainGuild) {
        await updateOnlineMonitor();
        await updateAFKEmbed(mainGuild);
    }
    setInterval(updateOnlineMonitor, 60000);

    // =====================================================
    // ЕЖЕНЕДЕЛЬНЫЙ СБРОС ЗАРПЛАТ — каждое воскресенье в 20:00 МСК
    // =====================================================
    setInterval(async () => {
        const now = new Date();
        // МСК = UTC+3
        const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const isSunday  = msk.getUTCDay()    === 0;
        const isHour    = msk.getUTCHours()  === 20;
        const isMinute  = msk.getUTCMinutes() === 0;
        if (!isSunday || !isHour || !isMinute) return;

        try {
            const guild = await client.guilds.fetch("1458190222042075251").catch(() => null);
            if (!guild) return;

            const auditChannel = await guild.channels.fetch("1500501911848095906").catch(() => null);
            if (!auditChannel) return;

            // Формируем итоговую таблицу
            let list = "";
            let total = 0;
            for (const [recruiterId, bal] of Object.entries(salary.balances)) {
                if (bal > 0) {
                    list += `• <@${recruiterId}> — **$${bal.toLocaleString()}**\n`;
                    total += bal;
                }
            }
            if (!list) list = "*На этой неделе выплат не было.*";

            const reportEmbed = new EmbedBuilder()
                .setTitle("📋 Еженедельная ведомость зарплат рекрут-состава")
                .setDescription(`Итоговый отчёт за неделю. После этого сообщения балансы сброшены.\n\n${list}`)
                .addFields({ name: "💵 Итого к выплате:", value: `**$${total.toLocaleString()}**`, inline: false })
                .setColor("Gold")
                .setTimestamp();

            await auditChannel.send({ embeds: [reportEmbed] }).catch(() => null);

            // Сбрасываем балансы и привязки
            salary.balances = {};
            salary.recruits = {};
            salary.auditMessages = {};
            await saveDB(salary);

            // Обновляем embed зарплат
            await updateSalaryEmbed(guild);

            console.log(`[WEEKLY RESET] Зарплаты сброшены в воскресенье.`);
        } catch (e) {
            console.error("[WEEKLY RESET ERROR]", e);
        }
    }, 60000); // проверяем каждую минуту
});


// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        if (salary.afk && salary.afk[member.id]) {
            delete salary.afk[member.id];
            await saveDB(salary);
            await updateAFKEmbed(member.guild);
        }

        if (salary.recruits && salary.recruits[member.id]) {
            const recruiterId = salary.recruits[member.id];

            // Если у участника перед выходом осталась только одна роль (DEDUCT_ROLE_ID),
            // значит GuildMemberUpdate уже списал $10,000 — не списываем второй раз
            const rolesWithoutEveryone = member.roles.cache.filter(r => r.id !== member.guild.id);
            const alreadyDeducted = rolesWithoutEveryone.size === 1 && rolesWithoutEveryone.has(DEDUCT_ROLE_ID);

            if (!alreadyDeducted) {
                if (salary.balances[recruiterId]) {
                    salary.balances[recruiterId] -= 10000;
                    if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
                }
            }

            if (salary.auditMessages && salary.auditMessages[member.id]) {
                const config = SERVERS[member.guild.id];
                if (config && config.CHANNELS && config.CHANNELS.AUDIT) {
                    const auditChannel = await member.guild.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
                    if (auditChannel) {
                        const auditMsgId = salary.auditMessages[member.id];
                        const auditMsg = await auditChannel.messages.fetch(auditMsgId).catch(() => null);
                        
                        if (auditMsg) {
                            const reaction = auditMsg.reactions.cache.find(r => r.emoji.name === "✅");
                            if (reaction) {
                                await reaction.users.remove(client.user.id).catch(() => null);
                            }
                            await auditMsg.react("❌").catch(() => null);
                        }
                    }
                }
                delete salary.auditMessages[member.id];
            }

            delete salary.recruits[member.id];
            await saveDB(salary);
            await updateSalaryEmbed(member.guild);

            // Уведомление только если списание произошло именно здесь (не было раньше через MemberUpdate)
            if (!alreadyDeducted) {
                const newBal = salary.balances[recruiterId] || 0;
                const notifyChannel = await member.guild.channels.fetch("1518544382985371698").catch(() => null);
                if (notifyChannel) {
                    await notifyChannel.send({
                        content: `⚠️ <@${recruiterId}>, с вашего баланса списано **$10,000** — <@${member.id}> **вышел с сервера**.\nВаш баланс: **$${newBal.toLocaleString()}**`
                    }).catch(() => null);
                }
            }
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

        // =====================================================
        // МП СКРИН — ожидание скриншота от игрока
        // =====================================================
        const awaitKey = `mp_await_${msg.author.id}`;
        if (applications.has(awaitKey)) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return; // ждём именно картинку

            const mpData = applications.get(awaitKey);
            applications.delete(awaitKey);

            // Забираем временный доступ обратно
            const mpScreenChannel = await client.channels.fetch(mpData.channelId).catch(() => null);
            if (mpScreenChannel) {
                await mpScreenChannel.permissionOverwrites.delete(msg.author.id).catch(() => null);
            }

            const reviewChannel = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);
            if (!reviewChannel) return;

            const file = new AttachmentBuilder(att.url, { name: "mp_screen.png" });

            const embed = new EmbedBuilder()
                .setTitle(`🎮 МП Отчёт | ${mpData.mpType}`)
                .setDescription(`👤 **Игрок:** <@${msg.author.id}>\n🎮 **МПшка:** ${mpData.mpType}\n${mpData.result === "win" ? "✅" : "❌"} **Результат:** ${mpData.result === "win" ? "Win" : "Lose"}\n🏆 **Баллов к начислению:** +${mpData.points}`)
                .setImage("attachment://mp_screen.png")
                .setColor(mpData.result === "win" ? "Blue" : "Orange")
                .setTimestamp();

            const safeId = `${msg.author.id}_${mpData.mpType.replace(/ /g,"")}_${mpData.result}_${mpData.points}_${mpData.channelId}`;
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`mp_accept_${safeId}`)
                    .setLabel("✅ Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`mp_reject_${safeId}`)
                    .setLabel("❌ Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            await reviewChannel.send({ embeds: [embed], files: [file], components: [row] });

            // Удаляем сообщение со скрином от игрока
            await msg.delete().catch(() => null);

            // Уведомление в канал уведомлений
            const mpNotifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (mpNotifChannel) {
                const sentMsg = await mpNotifChannel.send({ content: `📨 <@${msg.author.id}>, ваш отчёт по МПшке **${mpData.mpType}** отправлен на проверку. Ожидайте решения администрации.` }).catch(() => null);
                if (sentMsg) setTimeout(() => sentMsg.delete().catch(() => null), 10000);
            }
            return;
        }

        if (msg.content === "/balance") {
            const currentBal = salary.balances[msg.author.id] || 0;
            return msg.reply({
                content: `💰 Баланс: $${currentBal.toLocaleString()}`
            });
        }

        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 }).catch(() => null);
            let candidateText = "Не удалось определить";
            let candidateId = "unknown";

            if (channelMessages) {
                const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith("Заявление"));
                if (appMessage) {
                    const description = appMessage.embeds[0].description || "";
                    const userMatch = description.match(/<@(\d+)>/);
                    if (userMatch) {
                        candidateId = userMatch[1];
                        candidateText = `<@${candidateId}>`;
                    }
                }
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                const file = new AttachmentBuilder(att.url, { name: "screen.png" });
                
                const auditMsg = await auditChannel.send({ 
                    content: `📋 **Отчёт по принятой заявке**\n👤 **Рекрутер:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``,
                    files: [file] 
                });

                await auditMsg.react("✅").catch(() => null);

                salary.balances[msg.author.id] = (salary.balances[msg.author.id] || 0) + 10000;
                
                if (candidateId && candidateId !== "unknown") {
                    salary.recruits[candidateId] = msg.author.id;
                    salary.auditMessages[candidateId] = auditMsg.id; 
                }

                await saveDB(salary);
                await updateSalaryEmbed(msg.guild);
            }

            await msg.channel.send("✅ Отчёт успешно зафиксирован в аудите! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

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
        }

    } catch (e) {
        console.log(`[MESSAGE ERROR] [${INSTANCE_ID}]`, e);
    }
});


// =====================================================
// INTERACTIONS & SLASH COMMANDS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        if (i.isChatInputCommand()) {
            
            if (i.commandName !== "rank" && i.commandName !== "balance" && i.commandName !== "all" && i.commandName !== "mp_points" && i.commandName !== "mp_history" && i.commandName !== "afk_kick" && i.commandName !== "afk_list" && i.commandName !== "afk_panel") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.reply({ content: "❌ Вы не имеете доступа к управлению этой командой.", ephemeral: true });
                    return;
                }
            }

            if (i.commandName === "all") {
                const textMsg = i.options.getString("text"); 
                
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (может занять время)...", ephemeral: true });

                try {
                    await i.guild.members.fetch();
                    const targetMembers = i.guild.members.cache.filter(m => 
                        m.roles.cache.has("1458410756453306490") && 
                        !m.user.bot &&
                        !salary.afk[m.id]
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Оповещение от <@${i.user.id}>:**\n\n## ${textMsg} ##`);
                            successCount++;
                        } catch (e) {}
                    }
                    
                    await i.editReply({ content: `✅ Рассылка завершена! Сообщение доставлено: **${successCount}** участникам с ролью.` });
                } catch (e) {
                    console.error("[ALL COMMAND ERROR]", e);
                    await i.editReply({ content: "❌ Произошла ошибка при попытке рассылки в ЛС." });
                }
                return;
            }

            if (i.commandName === "balance") {
                const currentBal = salary.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "reset_salary") {
                salary.balances = {};
                salary.recruits = {};
                salary.auditMessages = {};
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы и привязки игроков были полностью аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "deduct") {
                const targetUser = i.options.getUser("user");
                const amount    = i.options.getInteger("amount");

                const currentBal = salary.balances[targetUser.id] || 0;
                if (currentBal === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> баланс уже **$0** — списывать нечего.`, ephemeral: true });
                    return;
                }

                const newBal = Math.max(0, currentBal - amount);
                salary.balances[targetUser.id] = newBal;
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);

                await i.reply({
                    content: `✅ С баланса <@${targetUser.id}> списано **$${amount.toLocaleString()}**.\nБыло: **$${currentBal.toLocaleString()}** → Стало: **$${newBal.toLocaleString()}**`,
                    ephemeral: true
                });
                return;
            }

            if (i.commandName === "add_salary") {
                const targetUser = i.options.getUser("user");
                const amount     = i.options.getInteger("amount");

                const currentBal = salary.balances[targetUser.id] || 0;
                const newBal = currentBal + amount;
                salary.balances[targetUser.id] = newBal;
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);

                await i.reply({
                    content: `✅ Рекруту <@${targetUser.id}> начислено **$${amount.toLocaleString()}**.\nБыло: **$${currentBal.toLocaleString()}** → Стало: **$${newBal.toLocaleString()}**`,
                    ephemeral: true
                });
                return;
            }


            // =====================================================
            // МП ПАНЕЛЬ
            // =====================================================
            if (i.commandName === "mp_panel") {
                const mpMenuRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("mp_select_type")
                        .setPlaceholder("Выберите МПшку для отчёта")
                        .addOptions(
                            { label: "Цеха", description: "+15 win / +7 lose", value: "Цеха", emoji: "🏭" },
                            { label: "Диллеры", description: "+15 win / +7 lose", value: "Диллеры", emoji: "💊" },
                            { label: "Дроп", description: "+20 win / +10 lose", value: "Дроп", emoji: "📦" },
                            { label: "Бизаки", description: "+8 win / +3 lose", value: "Бизаки", emoji: "💼" },
                            { label: "Арена", description: "+4 win / +0 lose", value: "Арена", emoji: "🏟️" },
                            { label: "Остров", description: "+15 win / +7 lose", value: "Остров", emoji: "🏝️" },
                            { label: "Тайники", description: "+5 win / +2 lose", value: "Тайники", emoji: "🗺️" },
                            { label: "Капт", description: "+20 win / +10 lose", value: "Капт", emoji: "⚔️" }
                        )
                );

                const mpPanelText = `@everyone
# СИСТЕМА ПОВЫШЕНИЯ
**•  1 → 2 РАНГ**
<:df:1516907994552602634> 50 PR + фамилия • 3+ дня в семье,
<:df:1516907994552602634> Фамилия \`Darkness\`

**•  2 → 3 РАНГ**
<:df:1516907994552602634> 100 PR • 14+ дней в семье

**•  3 → 4 РАНГ | Main RP and Capture**
<:df:1516907994552602634> 150 PR • заявка → <#1503001219201761301>
<:df:1516907994552602634> 20+ дней • адекватность

**•  5 РАНГ — Recruit**
<:df:1516907994552602634> Заявка → <#1499701507619291206>

**•  6 РАНГ** — High and Chief - Rec, Capt, Farm
**•  7 РАНГ** — Dep. Leader
**•  8 РАНГ** — Owner
————————————————————————————————————————————————
# СЕМЕЙНЫЕ БАЛЛЫ
Цеха: \`+15\` WIN | \`+7\` LOSE
Диллеры: \`+15\` WIN | \`+7\` LOSE
Дроп: \`+20\` WIN | \`+10\` LOSE
Бизаки: \`+8\` WIN | \`+3\` LOSE
Арена: \`+4\` 1st | \`+0\` LOSE
Остров: \`+15\` WIN | \`+7\` LOSE
Тайники: \`+5\` WIN | \`+2\` LOSE
Капт: \`+20\` WIN | \`+10\` LOSE`;

                await i.channel.send({ content: mpPanelText, components: [mpMenuRow], allowedMentions: { parse: ["everyone"] } });
                await i.reply({ content: "✅ Панель МП отчётов создана!", ephemeral: true });
                return;
            }

            // =====================================================
            // МП БАЛЛЫ
            // =====================================================
            if (i.commandName === "mp_deduct") {
                const targetUser = i.options.getUser("user");
                const amount = i.options.getInteger("amount");
                const current = salary.mpPoints[targetUser.id] || 0;

                if (current === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> баллов уже **0** — снимать нечего.`, ephemeral: true });
                    return;
                }

                const newPoints = Math.max(0, current - amount);
                salary.mpPoints[targetUser.id] = newPoints;
                await saveDB(salary);

                await i.reply({
                    content: `✅ С <@${targetUser.id}> снято **${amount}** МП баллов.\nБыло: **${current}** → Стало: **${newPoints}**`,
                    ephemeral: true
                });
                return;
            }

            if (i.commandName === "mp_points") {
                const targetUser = i.options.getUser("user") || i.user;
                const points = salary.mpPoints[targetUser.id] || 0;
                const history = salary.mpHistory[targetUser.id] || [];
                const lastEntries = history.slice(-5).reverse();

                let historyText = lastEntries.length > 0
                    ? lastEntries.map(h => `• **${h.mp}** — ${h.result === "win" ? "✅ Win" : "❌ Lose"} (+${h.points} баллов) <t:${h.ts}:R>`).join("\n")
                    : "*Нет отчётов.*";

                const embed = new EmbedBuilder()
                    .setTitle("🎮 МП Баллы")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Игрок:** <@${targetUser.id}>\n🏆 **Всего баллов:** \`${points}\`\n\n**Последние 5 МПшек:**\n${historyText}`)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            // =====================================================
            // МП ИСТОРИЯ СКРИНОВ (ВЕТКА)
            // =====================================================
            if (i.commandName === "mp_history") {
                const targetUser = i.options.getUser("user");
                const history = salary.mpHistory[targetUser.id] || [];

                if (history.length === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> нет ни одного принятого отчёта.`, ephemeral: true });
                    return;
                }

                await i.deferReply({ ephemeral: true });

                const thread = await i.channel.threads.create({
                    name: `МП скрины — ${targetUser.username}`,
                    autoArchiveDuration: 1440,
                    reason: `История МП скринов игрока ${targetUser.username}`
                }).catch(() => null);

                if (!thread) {
                    await i.editReply({ content: "❌ Не удалось создать ветку. Убедитесь что бот имеет права на создание тредов." });
                    return;
                }

                const headerEmbed = new EmbedBuilder()
                    .setTitle(`🗂️ История МП скринов | ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Игрок:** <@${targetUser.id}>\n🏆 **Всего баллов:** \`${salary.mpPoints[targetUser.id] || 0}\`\n📋 **Всего отчётов:** \`${history.length}\``)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await thread.send({ embeds: [headerEmbed] });

                for (const entry of history) {
                    const entryEmbed = new EmbedBuilder()
                        .setTitle(`${entry.result === "win" ? "✅" : "❌"} ${entry.mp} — ${entry.result === "win" ? "Win" : "Lose"}`)
                        .setDescription(`+**${entry.points}** баллов | <t:${entry.ts}:F>`)
                        .setColor(entry.result === "win" ? "Green" : "Red");

                    if (entry.imageUrl) entryEmbed.setImage(entry.imageUrl);
                    await thread.send({ embeds: [entryEmbed] }).catch(() => null);
                }

                await i.editReply({ content: `✅ Ветка со всеми скринами создана: ${thread}` });
                return;
            }

            if (i.commandName === "rank") {
                const targetUser = i.options.getUser("user") || i.user;
                const totalReports = salary.reports[targetUser.id] || 0;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                
                let currentRankName = "Отсутствует / Гость";
                if (targetMember) {
                    if (targetMember.roles.cache.has("1513647909965533377")) currentRankName = "TEST [1 Rank]";
                    else if (targetMember.roles.cache.has("1458485405769797848")) currentRankName = "Academy [2 Rank]";
                    else if (targetMember.roles.cache.has("1458485351424331903")) currentRankName = "Young [3 Rank]";
                    else if (targetMember.roles.cache.has("1458485277495656553")) currentRankName = "Darkness [4 Rank]";
                }

                const rankEmbed = new EmbedBuilder()
                    .setTitle("📊 Профиль квалификации и ранга")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Пользователь:** <@${targetUser.id}>\nℹ️ **Текущий ранг:** \`${currentRankName}\`\n✅ **Всего одобренных отчетов:** \`${totalReports}\``)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [rankEmbed], ephemeral: true });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                
                if (!targetMember) {
                    await i.reply({ content: "❌ Пользователь не найден на сервере.", ephemeral: true });
                    return;
                }

                const archiveData = salary.archive[targetUser.id];
                const acceptedByText = archiveData ? `<@${archiveData.acceptedBy}>` : "`Данные отсутствуют`";
                
                const joinedDiff = Date.now() - targetMember.joinedAt.getTime();
                const daysOnServer = Math.floor(joinedDiff / (1000 * 60 * 60 * 24));

                const infoEmbed = new EmbedBuilder()
                    .setTitle("📂 Личное дело участника")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Пользователь:** <@${targetUser.id}>\n🆔 **Discord ID:** \`${targetUser.id}\`\n📝 **Кто принял в тикете:** ${acceptedByText}\n⏳ **Времени на сервере:** \`${daysOnServer} дней\` (c ${targetMember.joinedAt.toLocaleDateString("ru-RU")})`)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder();
                if (archiveData) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`view_archive_app_${targetUser.id}`)
                            .setLabel("Посмотреть анкету заявки")
                            .setStyle(ButtonStyle.Secondary)
                    );
                    await i.reply({ embeds: [infoEmbed], components: [row], ephemeral: true });
                } else {
                    await i.reply({ embeds: [infoEmbed], ephemeral: true });
                }
                return;
            }

            // =====================================================
            // ОБНОВЛЕННАЯ ПАНЕЛЬ С ЗАГРУЗКОЙ КАРТИНКИ
            // =====================================================
            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                
                const embed = new EmbedBuilder()
                    .setColor("#2b2d31")
                    // .setImage("attachment://banner.png") // Эту строку мы убрали
                    .setDescription(
`## <:hello:1516906998715912334> Путь в семью начинается здесь!

-# <:df:1516907994552602634> Заявки в семью принимаются только на сервере **Denver**. 
<:df:1516907994552602634> **Внимательно прочитайте все пункты** при подаче заявки. **Если не ответили на все пункты** — заявка будет **отклонена**.

**・Срок рассмотрения заявки:** от 1 до 5 дней.
**・Важно:** если у вас нет подходящих откатов — заявка будет **отклонена**.

### - Дополнительные правила к подаче заявки:
<:df:1516907994552602634> Откаты с GG — не более 1 недели назад (не менее 6 минут).
<:df:1516907994552602634> Откаты с МП (ВЗЗ, MCL, Capt) — не более 60 дней назад. — **__при наличии!__**
<:df:1516907994552602634> Откаты должны быть не в виде мувика/нарезки.
<:df:1516907994552602634> Откаты должны быть с сайги и со спешика (минимум 2 отката).
<:df:1516907994552602634> Подать заявку можно только при открытом наборе. Если нет доступа к подаче — набор закрыт.
**・Выберите пункт в выпадающем меню:**`
                    );

                const menu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("apply_menu")
                        .setPlaceholder("Нажмите на меня, чтобы открыть меню")
                        .addOptions(
                            { label: "Academy", description: "Ник, статик, имя/возраст, онлайн, семья", value: "academy" },
                            { label: "Capture", description: "Ник, статик, имя/возраст, онлайн, семья, откаты", value: "capture" }
                        )
                );

                // Отправляем без файлов
                await channel.send({ 
                    embeds: [embed], 
                    components: [menu] 
                });

                await i.reply({ content: "✅ Панель успешно создана (без баннера)!", ephemeral: true });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ЗАЯВКИ В MAIN СОСТАВ
            // =====================================================
            if (i.commandName === "main_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.MAIN) return;
                const channel = await client.channels.fetch(config.CHANNELS.MAIN);

                const embed = new EmbedBuilder()
                    .setColor("#2b2d31")
                    .setDescription(
`## Заявка в Main состав

Main состав — основа нашей семьи. Здесь играют люди, готовые участвовать во всём контенте семьи: капты, MCL, турниры, и т.д.

**Требования для подачи:**
• Откаты стрельбы от 5 минут с GG
• или откаты с любой МП/капта/массового мероприятия

━━━━━━━━━━━━━━

**Важно:**
• Заявки без откатов не рассматриваются
• Рассмотрение занимает от 2 до 4 дней
• Подгонять администрацию запрещено
• Если заявка отклонена — решение окончательное

**Вступая в Main состав, вы становитесь частью основного комьюнити Darkness и участвуете во всём семейном контенте.**`
                    );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_main_modal")
                        .setLabel("Подать заявку")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель заявки в Main успешно создана!", ephemeral: true });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ЗАЯВКИ В RECRUIT ОТДЕЛ
            // =====================================================
            if (i.commandName === "recruit_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.RECRUIT) return;
                const channel = await client.channels.fetch(config.CHANNELS.RECRUIT);

                const embed = new EmbedBuilder()
                    .setColor("#2b2d31")
                    .setDescription(
`## Заявки в отдел Recruit | Darkness ##

**Recruit — отдел, который отвечает за набор новых игроков и развитие семьи.**
• Поиск новых участников.
• Помощь новичкам.
• Продвижение семьи.
• Поддержание актива.

### Важно ###
• Заявки оформляйте адекватно.
• Рассмотрение заявки занимает до 4 дней.
• Спам администрации запрещён.

🚀 **Recruit — будущее семьи Darkness.**`
                    );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_recruit_modal")
                        .setLabel("Подать заявку")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель заявки в Recruit успешно создана!", ephemeral: true });
                return;
            }

            if (i.commandName === "report_panel") {
                const embed = new EmbedBuilder()
                    .setDescription(
`Повышение выдается только при соблюдении всех требований и по решению старшего состава семьи.

### 📝 TEST ➔ 🧬 ACADEMY ###
**Требования:**
• 5 МП
• Фамилия Darkness
• Знание правил семьи и сервера
• Актив в игре больше 3 часов в день

### 🔮 ACADEMY ➔ 🍸 YOUNG ###
**Требования:**
• 10 МП суммарно
• Умение слушать и выполнять коллы
• Грамотная и адекватная игра
• Отсутствие серьёзных нарушений, варнов, жалоб со стороны софракцевцев, софамцев

### 🍸 YOUNG ➔ 🟣 DARKNESS ###
**Требования:**
• 20 МП суммарно
• Стабильный онлайн (больше 100 часов in игре)
• Помощь семье
• Хорошая коммуникация

### 🟣 DARKNESS ➔ 👑 RECRUIT ###
**Требования:**
• Уметь грамотно общаться
• Стабильный онлайн (3+ часа в день)
• Адекватность
• Иметь ответственность

━━━━━━━━━━━━━━━
⚠️ Повышение не выдаётся автоматически без ручного одобрения старшего состава в планшете. Нажмите кнопку ниже, чтобы прикрепить доказательства.`)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_report_modal")
                        .setLabel("Подать отчет")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Широкая панель системы повышения призвана!", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                const config = SERVERS[i.guild.id];
                const afkChannelId = config?.CHANNELS?.AFK || "1520898805103595772";
                const channel = await i.guild.channels.fetch(afkChannelId).catch(() => null);
                if (!channel) return i.reply({ content: "❌ Канал АФК не найден.", ephemeral: true });

                await updateAFKEmbed(i.guild);
                await i.reply({ content: "✅ АФК панель обновлена и отправлена в канал.", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_list") {
                await updateAFKEmbed(i.guild);
                await i.reply({ content: "✅ АФК список обновлён в канале.", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_kick") {
                await i.deferReply({ ephemeral: true });

                const config = SERVERS[i.guild.id];
                const hasPermission = config?.ALLOWED_ROLES?.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.editReply({ content: "❌ У вас нет прав для использования этой команды." });
                    return;
                }

                const targetUser = i.options.getUser("user");
                const reason = i.options.getString("reason");

                if (targetUser.id === i.user.id) {
                    await i.editReply({ content: "❌ Нельзя кикнуть самого себя из АФК. Используйте кнопку «Вернулся из АФК» в канале." });
                    return;
                }

                if (!salary.afk[targetUser.id]) {
                    await i.editReply({ content: `❌ <@${targetUser.id}> не находится в АФК.` });
                    return;
                }

                delete salary.afk[targetUser.id];
                await saveDB(salary);
                await updateAFKEmbed(i.guild);

                let dmSent = false;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                if (targetMember) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle("🚫 Вас кикнули из АФК")
                        .setDescription(`Администратор <@${i.user.id}> принудительно снял ваш АФК статус.\n\n**Причина:** ${reason}`)
                        .setColor("Red")
                        .setTimestamp();
                    dmSent = await targetMember.send({ embeds: [dmEmbed] }).then(() => true).catch(() => false);
                }

                await i.editReply({
                    content: `✅ <@${targetUser.id}> удалён из АФК.\n${dmSent ? "📩 ЛС с причиной отправлено." : "⚠️ ЛС не доставлено (закрыты личные сообщения)."}\n**Причина:** ${reason}`
                });
                return;
            }

            if (i.commandName === "composition_panel") {
                await updateOnlineMonitor();
                await i.reply({ content: "✅ Панель состава обновлена и вызвана.", ephemeral: true });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ВЗАИМОДЕЙСТВИЯ
            // =====================================================
            if (i.commandName === "interaction_panel") {
                const BANNER_URL = "https://media.discordapp.net/attachments/1506711652483993686/1521245082546868336/29f7dc94-f64c-476f-8001-9bdb67a93a1c.png?ex=6a442163&is=6a42cfe3&hm=29cdd15e146bc2fa35943e6589f619e62137c9a4499abe59aa1c8577f4a82acf&=&format=webp&quality=lossless&width=1876&height=625";

                // Трюк: одинаковый setURL на обоих embed — Discord склеивает их в один визуальный блок
                const MERGE_URL = "https://darkness.family";

                // Первый embed — только картинка (будет сверху после склейки)
                const bannerEmbed = new EmbedBuilder()
                    .setURL(MERGE_URL)
                    .setImage(BANNER_URL)
                    .setColor("#2b2d31");

                // Второй embed — заголовок и текст (будет снизу после склейки)
                const textEmbed = new EmbedBuilder()
                    .setURL(MERGE_URL)
                    .setTitle("Взаимодействие с функционалом бота")
                    .setDescription(
                        "<:df:1516907994552602634> **Отпуск** \u2014 взять долгосрочный отпуск, отдых из игры.\n" +
                        "<:df:1516907994552602634> **Портфель** \u2014 создать портфель.\n" +
                        "\uD83D\uDD34 **Откат** \u2014 открыть гайд по оформлению отката.\n" +
                        "<:df:1516907994552602634> **РП отчёт** \u2014 информация по РП отчётам и скринам IT, разное грин."
                    )
                    .setColor("#2b2d31");

                const interactionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("interaction_otpusk")
                        .setLabel("Отпуск")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("\uD83C\uDF34"),
                    new ButtonBuilder()
                        .setCustomId("interaction_portfolio")
                        .setLabel("Портфель")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("\uD83D\uDCBC"),
                    new ButtonBuilder()
                        .setCustomId("interaction_otkat")
                        .setLabel("Откат")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("\uD83D\uDD34"),
                    new ButtonBuilder()
                        .setCustomId("interaction_rp_report")
                        .setLabel("РП отчёт")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("\uD83D\uDCCB")
                );

                // Отправляем оба embed в одном сообщении — Discord склеит их визуально
                await i.channel.send({ embeds: [bannerEmbed, textEmbed], components: [interactionRow] });
                await i.reply({ content: "\u2705 Панель взаимодействия успешно создана!", ephemeral: true });
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
        } // end isChatInputCommand


        // =====================================================
        // МП КНОПКА СТАРТ — выбор типа МПшки
        // =====================================================
        // =====================================================
        // МП ВЫБОР ТИПА → показ выбора результата
        // =====================================================
        if (i.isStringSelectMenu() && i.customId === "mp_select_type") {
            const selectedMp = i.values[0];

            const resultMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`mp_select_result_${selectedMp}`)
                    .setPlaceholder("Выберите результат")
                    .addOptions(
                        { label: "Win (Победа)", value: "win", emoji: "✅" },
                        { label: "Lose (Поражение)", value: "lose", emoji: "❌" }
                    )
            );

            await i.reply({
                content: `🎮 **МП:** ${selectedMp}

**Шаг 2:** Выберите результат:`,
                components: [resultMenu],
                ephemeral: true
            });
            return;
        }

        // =====================================================
        // МП ВЫБОР РЕЗУЛЬТАТА → просьба скинуть скрин
        // =====================================================
        if (i.isStringSelectMenu() && i.customId.startsWith("mp_select_result_")) {
            const mpType = i.customId.replace("mp_select_result_", "");
            const result = i.values[0];
            const points = MP_TYPES[mpType] ? MP_TYPES[mpType][result] : 0;

            // Выдаём временный доступ на отправку сообщений и файлов в этот канал
            await i.channel.permissionOverwrites.edit(i.user.id, {
                SendMessages: true,
                AttachFiles: true,
                ViewChannel: true
            }).catch(() => null);

            // Сохраняем в Map для ожидания скрина
            applications.set(`mp_await_${i.user.id}`, { mpType, result, points, channelId: i.channelId });

            const uploadEmbed = new EmbedBuilder()
                .setColor("#5865F2")
                .setTitle("📎 Загрузка доказательства")
                .setDescription(
                    `✅ **МП:** ${mpType} | **Результат:** ${result === "win" ? "Win ✅" : "Lose ❌"} | **Баллы:** +${points}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📂 **Шаг 3: Прикрепите скриншот к сообщению**\n\n` +
                    `> 🖱️ Перетащите файлы сюда или **выберите**\n` +
                    `> Загрузите до **1 файла** размером не более **10 МБ**\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⚠️ *У вас есть **1 минута** на отправку скриншота. После этого доступ будет закрыт.*`
                )
                .setFooter({ text: "Поддерживаются форматы: PNG, JPG, JPEG, WEBP" })
                .setTimestamp();

            await i.update({
                content: "",
                embeds: [uploadEmbed],
                components: []
            });

            // Таймер: если за 60 секунд скрин не пришёл — убираем доступ
            setTimeout(async () => {
                if (applications.has(`mp_await_${i.user.id}`)) {
                    applications.delete(`mp_await_${i.user.id}`);
                    await i.channel.permissionOverwrites.delete(i.user.id).catch(() => null);
                    await i.channel.send({ content: `⏰ <@${i.user.id}>, время вышло! Вы не успели отправить скриншот. Начните заново.` })
                        .then(m => setTimeout(() => m.delete().catch(() => null), 8000))
                        .catch(() => null);
                }
            }, 60000);
            return;
        }

        // =====================================================
        // МП КНОПКИ ПРИНЯТЬ / ОТКЛОНИТЬ (в канале модерации)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("mp_accept_")) {
            const parts = i.customId.split("_");
            // mp_accept_USERID_MP_RESULT_POINTS_CHANNELID
            const userId = parts[2];
            const mpType = parts[3];
            const result = parts[4];
            const points = parseInt(parts[5]);
            const panelChannelId = parts[6] || null;

            salary.mpPoints[userId] = (salary.mpPoints[userId] || 0) + points;
            if (!salary.mpHistory[userId]) salary.mpHistory[userId] = [];

            // Получаем url картинки из embed
            const imgUrl = i.message.embeds[0]?.image?.url || null;

            salary.mpHistory[userId].push({
                mp: mpType, result, points,
                ts: Math.floor(Date.now() / 1000),
                imageUrl: imgUrl
            });

            await saveDB(salary);

            const acceptEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Green")
                .setTitle(`✅ МП Отчёт принят | ${mpType}`)
                .addFields({ name: "Принял", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [acceptEmbed], components: [] });

            // Уведомляем игрока в канале уведомлений
            const acceptNotifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (acceptNotifChannel) {
                await acceptNotifChannel.send({
                    content: `✅ <@${userId}>, ваш отчёт по МПшке **${mpType}** (${result === "win" ? "Win" : "Lose"}) **принят!** Начислено **+${points}** баллов. Всего баллов: **${salary.mpPoints[userId]}**`
                }).catch(() => null);
            }

            // Проверяем пороги повышения ранга
            const totalPts = salary.mpPoints[userId];
            const member = await i.guild.members.fetch(userId).catch(() => null);
            if (member) {
                for (const threshold of MP_RANK_THRESHOLDS) {
                    if (totalPts >= threshold.points && member.roles.cache.has(threshold.from)) {
                        const reviewChan = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);
                        if (reviewChan) {
                            const rankEmbed = new EmbedBuilder()
                                .setTitle(`🏆 Повышение ранга | ${threshold.label}`)
                                .setDescription(`👤 **Игрок:** <@${userId}>
📊 **Баллов:** \`${totalPts}\`
🎯 **Порог:** \`${threshold.points}\`

⬆️ Готов к повышению: **${threshold.label}**`)
                                .setColor("Gold")
                                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                                .setTimestamp();

                            const rankRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`rank_accept_${userId}_${threshold.from}_${threshold.to}_${threshold.points}`)
                                    .setLabel("✅ Повысить")
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`rank_reject_${userId}_${threshold.points}`)
                                    .setLabel("❌ Отказать")
                                    .setStyle(ButtonStyle.Danger)
                            );

                            await reviewChan.send({ embeds: [rankEmbed], components: [rankRow] });
                        }
                        break; // только один порог за раз
                    }
                }
            }
            return;
        }

        if (i.isButton() && i.customId.startsWith("mp_reject_")) {
            const parts = i.customId.split("_");
            const userId = parts[2];
            const mpType = parts[3];

            const rejectEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Red")
                .setTitle(`❌ МП Отчёт отклонён | ${mpType}`)
                .addFields({ name: "Отклонил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [rejectEmbed], components: [] });

            // Уведомление в канал отклонений
            const rejectChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (rejectChannel) {
                await rejectChannel.send({ content: `❌ <@${userId}>, ваш отчёт по МПшке **${mpType}** был **отклонён**.` });
            }
            return;
        }


        // =====================================================
        // РАНГ КНОПКА — ПОВЫСИТЬ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("rank_accept_")) {
            const parts = i.customId.split("_");
            // rank_accept_USERID_FROMROLE_TOROLE_THRESHOLD
            const userId = parts[2];
            const fromRole = parts[3];
            const toRole = parts[4];
            const threshold = parseInt(parts[5]);

            const member = await i.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await i.reply({ content: "❌ Игрок не найден на сервере.", ephemeral: true });
                return;
            }

            await member.roles.remove(fromRole).catch(() => null);
            await member.roles.add(toRole).catch(() => null);

            await saveDB(salary);

            const acceptEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Green")
                .setTitle(`✅ Повышение выдано | ${i.message.embeds[0].title?.split("|")[1]?.trim() || ""}`)
                .addFields({ name: "Повысил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [acceptEmbed], components: [] });

            // Уведомляем игрока в канале уведомлений
            const notifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (notifChannel) {
                await notifChannel.send({
                    content: `🎉 <@${userId}>, поздравляем! Вам выдано повышение ранга. Баллы сброшены, продолжайте набирать!`
                }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // РАНГ КНОПКА — ОТКАЗАТЬ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("rank_reject_")) {
            const parts = i.customId.split("_");
            // rank_reject_USERID_THRESHOLD
            const userId = parts[2];
            const threshold = parseInt(parts[3]);

            // Баллы не сбрасываем — игрок продолжает с текущим счётом

            const rejectEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Red")
                .setTitle(`❌ Повышение отклонено | ${i.message.embeds[0].title?.split("|")[1]?.trim() || ""}`)
                .addFields({ name: "Отклонил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [rejectEmbed], components: [] });

            // Уведомляем игрока в ЛС
            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (targetUser) {
                await targetUser.send(`❌ **Ваша заявка на повышение ранга была отклонена.**\nВаши баллы сброшены до **0**. Продолжайте набирать баллы для следующей попытки.`).catch(() => null);
            }
            return;
        }

        if (i.isButton() && i.customId.startsWith("view_archive_app_")) {
            const tId = i.customId.replace("view_archive_app_", "");
            const arch = salary.archive[tId];
            if (!arch || !arch.fields) {
                return i.reply({ content: "❌ Анкета не найдена в базе данных.", ephemeral: true });
            }

            const appEmbed = new EmbedBuilder()
                .setTitle(`Архивная заявка от пользователя`)
                .setDescription(`**Статик и Никнейм:** ${arch.fields.q1}\n\n**Имя и Возраст:** ${arch.fields.q2}\n\n**Опыт:** ${arch.fields.q3}\n\n**Почему именно мы:** ${arch.fields.q4}${arch.fields.q5 ? `\n\n**Откаты:** ${arch.fields.q5}` : ""}`)
                .setColor("#1f8b4c");

            await i.reply({ embeds: [appEmbed], ephemeral: true });
            return;
        }

        if (i.isButton() && (i.customId === "afk_enter" || i.customId === "afk_leave")) {
            if (i.customId === "afk_enter") {
                // Показываем модалку для ввода причины и времени возврата
                const afkModal = new ModalBuilder()
                    .setCustomId("afk_enter_modal")
                    .setTitle("Уход в АФК");

                const reasonInput = new TextInputBuilder()
                    .setCustomId("afk_reason_input")
                    .setLabel("Причина АФК")
                    .setPlaceholder("дела / сон / еда / афк...")
                    .setRequired(true)
                    .setMaxLength(60)
                    .setStyle(TextInputStyle.Short);

                const returnInput = new TextInputBuilder()
                    .setCustomId("afk_return_input")
                    .setLabel("Вернусь через (минут) или время HH:MM")
                    .setPlaceholder("Например: 30 или 14:30")
                    .setRequired(false)
                    .setMaxLength(10)
                    .setStyle(TextInputStyle.Short);

                afkModal.addComponents(
                    new ActionRowBuilder().addComponents(reasonInput),
                    new ActionRowBuilder().addComponents(returnInput)
                );

                await i.showModal(afkModal);
            } else {
                if (salary.afk[i.user.id]) {
                    delete salary.afk[i.user.id];
                    await saveDB(salary);
                }
                await i.reply({ content: "🏃 Вы вернулись из АФК! Уведомления о сборах возобновлены.", ephemeral: true });
                await updateAFKEmbed(i.guild);
            }
            return;
        }

        // =====================================================
        // АФК МОДАЛКА — обработка причины и времени возврата
        // =====================================================
        if (i.isModalSubmit() && i.customId === "afk_enter_modal") {
            const reason = i.fields.getTextInputValue("afk_reason_input") || "афк";
            const returnRaw = i.fields.getTextInputValue("afk_return_input")?.trim() || "";

            let returnAt = null;

            if (returnRaw) {
                // Если формат "HH:MM" — трактуем как МСК (UTC+3)
                if (/^\d{1,2}:\d{2}$/.test(returnRaw)) {
                    const [hh, mm] = returnRaw.split(":").map(Number);
                    const nowUtc = Date.now();
                    const MSK_OFFSET = 3 * 60 * 60 * 1000; // UTC+3
                    // Текущее время в МСК
                    const nowMsk = new Date(nowUtc + MSK_OFFSET);
                    // Строим целевое время в МСК (как UTC дату со смещением)
                    const ret = new Date(nowMsk);
                    ret.setUTCHours(hh, mm, 0, 0);
                    // Если время уже прошло сегодня по МСК — завтра
                    if (ret.getTime() <= nowMsk.getTime()) ret.setUTCDate(ret.getUTCDate() + 1);
                    // Переводим обратно в реальный UTC timestamp
                    returnAt = ret.getTime() - MSK_OFFSET;
                } else if (/^\d+$/.test(returnRaw)) {
                    // Число минут — просто прибавляем
                    returnAt = Date.now() + parseInt(returnRaw) * 60 * 1000;
                }
            }

            salary.afk[i.user.id] = { reason, returnAt, since: Date.now() };
            await saveDB(salary);
            await updateAFKEmbed(i.guild);

            const returnText = returnAt
                ? `\n⏰ Ожидаемый возврат: <t:${Math.floor(returnAt / 1000)}:T>`
                : "";

            await i.reply({
                content: `💤 Вы ушли в АФК.\n📝 Причина: **${reason}**${returnText}\n\nУведомления о сборах приостановлены.`,
                ephemeral: true
            });
            return;
        }

        if (i.isButton() && i.customId === "open_report_modal") {
            const modal = new ModalBuilder()
                .setCustomId("modal_report_submit")
                .setTitle("Подача отчета на повышение");

            const staticInput = new TextInputBuilder()
                .setCustomId("report_static_id")
                .setLabel("СТАТИК ИГРОВОГО ПЕРСОНАЖА (ТОЛЬКО ЦИФРЫ)")
                .setPlaceholder("Пример: 21074")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const linkInput = new TextInputBuilder()
                .setCustomId("report_proof_link")
                .setLabel("ССЫЛКА НА ДОКАЗАТЕЛЬСТВА (IMGUR И Т.Д.)")
                .setPlaceholder("https://imgur.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            modal.addComponents(
                new ActionRowBuilder().addComponents(staticInput),
                new ActionRowBuilder().addComponents(linkInput)
            );

            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "modal_report_submit") {
            const staticIdStr = i.fields.getTextInputValue("report_static_id");
            const proofLink = i.fields.getTextInputValue("report_proof_link");

            if (!/^\d+$/.test(staticIdStr)) {
                await i.reply({ content: "❌ Ошибка: В строке статического ID должны быть только цифры!", ephemeral: true });
                return;
            }

            await i.guild.channels.fetch().catch(() => null);
            const reportCategory = config.CHANNELS.REPORT_CATEGORY || config.CHANNELS.CATEGORY;

            const reportChannel = await i.guild.channels.create({
                name: `report-${i.user.username}`,
                type: ChannelType.GuildText,
                parent: reportCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("📑 Новый отчет на повышение")
                .setDescription(`👤 **Отправитель:** <@${i.user.id}>\n🆔 **Статик:** \`${staticIdStr}\`\n🔗 **Доказательства:** ${proofLink}`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`report_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`report_reject_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            await reportChannel.send({ embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Ваш отчет отправлен! Создан тикет проверки: <#${reportChannel.id}>`, ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("report_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для проверки отчетов.", ephemeral: true });
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                if (targetMember) {
                    await targetMember.send("❌ Ваш отчет на повышение был проверен и отклонен администрацией.").catch(() => null);
                }
                await i.reply({ content: "❌ Отчет отклонен. Тикет закрывается..." });
                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }

            if (action === "accept") {
                salary.reports[targetId] = (salary.reports[targetId] || 0) + 1;
                await saveDB(salary);

                await i.reply({ content: "✅ Отчет успешно зафиксирован!" });

                const currentCount = salary.reports[targetId];
                let triggerPromo = false;
                let fromRankName = "", toRankName = "", removeRoleId = "", addRoleId = "";

                if (targetMember) {
                    if (targetMember.roles.cache.has("1513647909965533377") && currentCount >= 5) {
                        triggerPromo = true; fromRankName = "TEST"; toRankName = "Academy"; removeRoleId = "1513647909965533377"; addRoleId = "1458485405769797848";
                    } else if (targetMember.roles.cache.has("1458485405769797848") && currentCount >= 10) {
                        triggerPromo = true; fromRankName = "Academy"; toRankName = "Young"; removeRoleId = "1458485405769797848"; addRoleId = "1458485351424331903";
                    } else if (targetMember.roles.cache.has("1458485351424331903") && currentCount >= 20) {
                        triggerPromo = true; fromRankName = "Young"; toRankName = "Darkness"; removeRoleId = "1458485351424331903"; addRoleId = "1458485277495656553";
                    }
                }

                if (triggerPromo) {
                    const notifyChannel = await i.guild.channels.fetch(config.CHANNELS.NOTIFY_PROMO).catch(() => null);
                    if (notifyChannel) {
                        const promoEmbed = new EmbedBuilder()
                            .setTitle("📈 Заявка на утверждение повышения")
                            .setDescription(`👤 Игрок <@${targetId}> успешно выполнил требования по количеству отчетов (**${currentCount} шт.**).\nПожалуйста, подтвердите его повышение в планшете с **${fromRankName}** до **${toRankName}**.`)
                            .setColor("Purple");

                        const promoRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`p_confirm_${targetId}_${removeRoleId}_${addRoleId}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`p_deny_${targetId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                        );

                        await notifyChannel.send({ embeds: [promoEmbed], components: [promoRow] });
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }
        }

        if (i.isButton() && i.customId.startsWith("p_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для утверждения рангов.", ephemeral: true });
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "deny") {
                if (targetMember) {
                    await targetMember.send("❌ Ваше ручное повышение в планшете было отклонено старшим составом.").catch(() => null);
                }
                await i.reply({ content: "❌ Повышение отклонено.", ephemeral: true });
                await i.message.delete().catch(() => null);
                return;
            }

            if (action === "confirm") {
                const remRole = parts[3];
                const addRole = parts[4];

                if (targetMember) {
                    if (remRole) await targetMember.roles.remove(remRole).catch(() => null);
                    if (addRole) await targetMember.roles.add(addRole).catch(() => null);
                    await targetMember.send(`🎉 Поздравляем! Ваш ранг на сервере был успешно обновлен!`).catch(() => null);
                }

                await i.reply({ content: "✅ Роли игрока перевыданы, повышение зафиксировано!", ephemeral: true });
                await i.message.delete().catch(() => null);
                return;
            }
        }

        if (i.isButton() && i.customId.startsWith("group_start_")) {
            const faction = i.customId.replace("group_start_", "");
            
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`group_select_${faction}`)
                    .setPlaceholder("Выберите тип мероприятие")
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
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (может занять время)...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        targetConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !salary.afk[m.id]
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений.` });
                } catch (e) {
                    await i.editReply({ content: "❌ Произошла ошибка при попытке рассылки в ЛС." });
                }
            }
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");

            const isMainCh = i.channel.name.startsWith("main");
            const isRecruitCh = i.channel.name.startsWith("recruit");
            const logChannelId = isMainCh
                ? (config.CHANNELS.AUDIT_MAIN || config.CHANNELS.AUDIT_APP)
                : isRecruitCh
                    ? (config.CHANNELS.AUDIT_RECRUIT || config.CHANNELS.AUDIT_APP)
                    : (config.CHANNELS.AUDIT_APP || "1464575195418460417");
            const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);

            if (logChannel) {
                let originalEmbed;
                const messages = await i.channel.messages.fetch({ limit: 50 }).catch(() => null);
                if (messages) {
                    const msg = messages.find(m => m.embeds.length > 0 && (
                        m.embeds[0].description?.includes("ВАШ СТАТИЧЕСКИЙ ID") ||
                        m.embeds[0].description?.includes("Ваш статик") ||
                        m.embeds[0].description?.includes("НИК И СТАТИК") ||
                        m.embeds[0].title?.startsWith("Заявление")
                    ));
                    if (msg) originalEmbed = msg.embeds[0];
                }

                const rejectEmbed = new EmbedBuilder()
                    .setTitle(`❌ Заявка отклонена | ${isMainCh ? "Main состав" : isRecruitCh ? "Recruit" : "Семья"}`)
                    .setColor("Red")
                    .setTimestamp();

                if (originalEmbed?.description) {
                    rejectEmbed.setDescription(originalEmbed.description);
                }

                rejectEmbed.addFields(
                    { name: "Кого", value: `<@${targetId}>`, inline: true },
                    { name: "Отклонил", value: `<@${i.user.id}>`, inline: true },
                    { name: "Причина", value: reason, inline: false }
                );

                await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
            }

            await i.reply({ content: `❌ Заявка успешно отклонена. Причина зафиксирована в канале логирования.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        if (!config) return;

        if (i.isButton() && i.customId === "open_main_modal") {
            const type = "main";
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle("Заявка в Main");

            const fields = [
                { id: "q1", label: "Ваш статик", placeholder: "21074", style: TextInputStyle.Short },
                { id: "q5", label: "Предоставьте ваши откаты", placeholder: "Откат стрельбы от 5 минут с GG или с МП/капта", style: TextInputStyle.Paragraph }
            ];

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        if (i.isButton() && i.customId === "open_recruit_modal") {
            const modal = new ModalBuilder()
                .setCustomId("apply_modal_recruit")
                .setTitle("Заявка в Recruit");

            const fields = [
                { id: "q1", label: "Ваш ник и статик", placeholder: "Hugo Darkness | 21074", style: TextInputStyle.Short },
                { id: "q2", label: "Имя и возраст (в реале)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "Почему хотите попасть в Recruit?", placeholder: "Хочу помогать семье, набирать новых игроков...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "Есть ли опыт в рекрутинге или схожих ролях?", placeholder: "Да, был рекрутером в семье... / Нет, но готов учиться", style: TextInputStyle.Paragraph }
            ];

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : type === "main" ? "Заявка в Main" : "Заявка в Capture");

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
            if (i.customId === "apply_modal_recruit") {
                // Handled separately below
            } else {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const targetCategory = type === "main" ? config.CHANNELS.MAIN_CATEGORY : config.CHANNELS.CATEGORY;
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === targetCategory && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
                return;
            }

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: type === "main" ? null : i.fields.getTextInputValue("q2"),
                q3: type === "main" ? null : i.fields.getTextInputValue("q3"),
                q4: type === "main" ? null : i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null,
                userId: i.user.id
            };

            applications.set(i.user.id, data);

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: targetCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...(config.ALLOWED_ROLES ? config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] })) : []),
                    { id: "1468704257606684712", allow: ["ViewChannel", "SendMessages"] } 
                ]
            });

            const rolesPing = config.ALLOWED_ROLES ? config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ") : "";
            const topContent = `${rolesPing} <@&1468704257606684712>\n**Предыдущие заявки:**\nЗаявок не найдено.`;

            let embedDescription;

            if (type === "main") {
                embedDescription = `**Ваш статик**
${data.q1}

**Предоставьте ваши откаты**
${data.q5}`;
            } else {
                embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**
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

            // Аудит лог — новая заявка (main / capture / academy)
            if (type === "main" && config.CHANNELS.AUDIT_MAIN) {
                const auditCh = await i.guild.channels.fetch(config.CHANNELS.AUDIT_MAIN).catch(() => null);
                if (auditCh) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle("Заявление — Main состав")
                        .setColor("#1f8b4c")
                        .setDescription(
`**Ваш статик**
${data.q1}

**Предоставьте ваши откаты**
${data.q5}

**Пользователь**
<@${i.user.id}>`)
                        .addFields(
                            { name: "Username", value: i.user.username, inline: true },
                            { name: "ID", value: i.user.id, inline: true },
                            { name: "Тикет", value: `<#${channel.id}>`, inline: true }
                        )
                        .setTimestamp();
                    await auditCh.send({ embeds: [auditEmbed] }).catch(() => null);
                }
            }

            return;
            } // end else (not recruit)
        }

        // =====================================================
        // ОБРАБОТКА ЗАЯВКИ В RECRUIT ОТДЕЛ
        // =====================================================
        if (i.isModalSubmit() && i.customId === "apply_modal_recruit") {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const recruitCategory = config.CHANNELS.RECRUIT_CATEGORY || config.CHANNELS.CATEGORY;
            const expectedChannelName = `recruit-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c =>
                c.parentId === recruitCategory &&
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
                return;
            }

            const recruitData = {
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                userId: i.user.id
            };

            const RECRUIT_ROLE_ID = "1519806507011805215";

            const recruitChannel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: recruitCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    { id: RECRUIT_ROLE_ID, allow: ["ViewChannel", "SendMessages"] }
                ]
            });

            const topContent = `<@&${RECRUIT_ROLE_ID}>\n**Предыдущие заявки:**\nЗаявок не найдено.`;

            const embedDescription = `**НИК И СТАТИК**
${recruitData.q1}

**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**
${recruitData.q2}

**ПОЧЕМУ ХОТИТЕ ПОПАСТЬ В RECRUIT?**
${recruitData.q3}

**ОПЫТ В РЕКРУТИНГЕ / СХОЖИХ РОЛЯХ**
${recruitData.q4}

**Пользователь**
<@${i.user.id}>`;

            const recruitEmbed = new EmbedBuilder()
                .setTitle("Заявление — Recruit")
                .setDescription(embedDescription)
                .setColor("#2b2d31")
                .addFields(
                    { name: "Username", value: i.user.username, inline: true },
                    { name: "ID", value: i.user.id, inline: true }
                );

            const recruitRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await recruitChannel.send({ content: topContent, embeds: [recruitEmbed], components: [recruitRow] });
            await i.reply({ content: `✅ Заявка в Recruit создана! Канал: <#${recruitChannel.id}>`, ephemeral: true });

            // Аудит лог — новая заявка (recruit)
            if (config.CHANNELS.AUDIT_RECRUIT) {
                const auditCh = await i.guild.channels.fetch(config.CHANNELS.AUDIT_RECRUIT).catch(() => null);
                if (auditCh) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle("Заявление — Recruit")
                        .setColor("#2b2d31")
                        .setDescription(
`**НИК И СТАТИК**
${recruitData.q1}

**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**
${recruitData.q2}

**ПОЧЕМУ ХОТИТЕ ПОПАСТЬ В RECRUIT?**
${recruitData.q3}

**ОПЫТ В РЕКРУТИНГЕ / СХОЖИХ РОЛЯХ**
${recruitData.q4}

**Пользователь**
<@${i.user.id}>`)
                        .addFields(
                            { name: "Username", value: i.user.username, inline: true },
                            { name: "ID", value: i.user.id, inline: true },
                            { name: "Тикет", value: `<#${recruitChannel.id}>`, inline: true }
                        )
                        .setTimestamp();
                    await auditCh.send({ embeds: [auditEmbed] }).catch(() => null);
                }
            }

            return;
        }

        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];

            const messages = await i.channel.messages.fetch({ limit: 20 }).catch(() => null);
            if (messages) {
                const appMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith("Заявление"));
                if (appMessage) {
                    const embed = EmbedBuilder.from(appMessage.embeds[0]);
                    embed.setColor("Orange").setTitle("Заявление (Вызов на обзвон)");
                    await appMessage.edit({ embeds: [embed] }).catch(() => null);
                }
            }

            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;

            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон администратором <@${i.user.id}>!\nПожалуйста, перейдите в голосовой канал: [Войти в голосовой канал](${voiceUrl}) (<#${voiceChannelId}>).`);

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) {
                await targetMember.send({
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** на сервере **${i.guild.name}** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовой канале по прямой ссылке:\n${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                });
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            if (parts[0] === "group" && parts[1] === "start") return;
            if (i.customId === "open_report_modal" || i.customId === "afk_enter" || i.customId === "afk_leave") return;
            if (parts[0] === "report") return;
            if (parts[0] === "p") return;

            if (parts[0] === "audit") {
                const action = parts[1];

                if (action === "verify") {
                    const cId = parts[2];
                    if (!cId || cId === "unknown") {
                        await i.reply({ content: "❌ Не удалось считать корректный Discord ID кандидата.", ephemeral: true });
                        return;
                    }
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    if (isPresent) {
                        await i.reply({ content: `🟢 Пользователь <@${cId}> (\`${cId}\`) **находится** на сервере.`, ephemeral: true });
                    } else {
                        await i.reply({ content: `🔴 Пользователь с ID \`${cId}\` **не найден** на сервере (вышел или не заходил).`, ephemeral: true });
                    }
                    return;
                }

                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.reply({ content: "❌ У вас нет прав для управления аудитом.", ephemeral: true });
                    return;
                }

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.reply({ content: "❌ Отчёт планшета отклонён. Сообщение удалено.", ephemeral: true });
                    await i.message.delete().catch(() => null);
                    return;
                }

                if (action === "accept") {
                    salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 10000;
                    
                    if (candidateId && candidateId !== "unknown") {
                        salary.recruits[candidateId] = recruiterId;
                    }

                    await saveDB(salary);
                    await updateSalaryEmbed(i.guild);

                    await i.reply({ content: "✅ Отчёт успешно подтвержден! Рекрутеру начислено $10,000.", ephemeral: true });
                    await i.message.delete().catch(() => null);
                    return;
                }
            }

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав для нажатия этих кнопок.", ephemeral: true });
                return;
            }

            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary.balances[targetId] = (salary.balances[targetId] || 0) + 1000;
                    await saveDB(salary);
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
                    if (!targetMember) {
                        await i.reply({ content: "❌ Пользователь вышел с сервера.", ephemeral: true });
                        return;
                    }
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const isMain = i.channel.name.startsWith("main");
                    const isRecruit = i.channel.name.startsWith("recruit");
                    let rolesToAdd;
                    if (isAcademy) rolesToAdd = config.ACADEMY_ROLES;
                    else if (isMain) rolesToAdd = config.MAIN_ROLES;
                    else if (isRecruit) rolesToAdd = ["1468704257606684712"];
                    else rolesToAdd = config.CAPTURE_ROLES;
                    await targetMember.roles.add(rolesToAdd).catch(() => null);
                    if (isAcademy) await targetMember.roles.remove("1458410670071615580").catch(() => null);

                    const liveData = applications.get(targetId);
                    salary.archive[targetId] = {
                        acceptedBy: i.user.id,
                        timestamp: new Date().toISOString(),
                        fields: liveData || { q1: "Не сохр.", q2: "Не сохр.", q3: "Не сохр.", q4: "Не сохр." }
                    };
                    await saveDB(salary);

                    if (isMain || isRecruit) {
                        embed.setColor("Purple").setTitle("Заявление (Принято)");
                        await i.update({ embeds: [embed], components: [] });
                    } else {
                        await i.channel.permissionOverwrites.edit(targetId, {
                            ViewChannel: false,
                            SendMessages: false
                        }).catch(() => null);

                        const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "").replace("main-", "").replace("recruit-", "");
                        await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                        embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                        await i.update({ embeds: [embed], components: [] });
                    }

                    const auditChannelId = isMain
                        ? config.CHANNELS.AUDIT_MAIN
                        : isRecruit
                            ? config.CHANNELS.AUDIT_RECRUIT
                            : config.CHANNELS.AUDIT_APP;
                    if (auditChannelId) {
                        const auditChannel = await i.guild.channels.fetch(auditChannelId).catch(() => null);
                        if (auditChannel) {
                            const auditLabel = isMain ? "Main состав" : isRecruit ? "Recruit" : "Семья";
                            const auditEmbed = EmbedBuilder.from(i.message.embeds[0])
                                .setColor("Green")
                                .setTitle(`✅ Заявка принята | ${auditLabel}`)
                                .addFields(
                                    { name: "Кого", value: `<@${targetId}>`, inline: true },
                                    { name: "Принял", value: `<@${i.user.id}>`, inline: true }
                                )
                                .setTimestamp();
                            await auditChannel.send({ embeds: [auditEmbed] }).catch(() => null);
                        }
                    }

                    if (isMain || isRecruit) {
                        const dmText = isRecruit
                            ? `👋 **Привет!** Твоя заявка в **отдел Recruit** Darkness на сервере **${i.guild.name}** была проверена.\n\n🎉 Поздравляем, ты успешно принят в Recruit!`
                            : `👋 **Привет!** Твоя заявка в **Main состав** Darkness на сервере **${i.guild.name}** была проверена.\n\n🎉 Поздравляем, кандидат успешно принят в Main состав!`;
                        await targetMember.send({ content: dmText }).catch(() => {
                            i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                        });

                        await i.channel.send({ content: `🎉 Кандидат <@${targetId}> успешно принят! Тикет будет удалён через несколько секунд.` }).catch(() => null);

                        setTimeout(() => {
                            i.channel.delete().catch(() => null);
                        }, 5000);
                    } else {
                        await i.channel.send({
                            content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчет в аудите.`
                        });
                    }
                    return;
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });

                    const isMainR = i.channel.name.startsWith("main");
                    const isRecruitR = i.channel.name.startsWith("recruit");
                    const reviewAuditId = isMainR
                        ? config.CHANNELS.AUDIT_MAIN
                        : isRecruitR
                            ? config.CHANNELS.AUDIT_RECRUIT
                            : config.CHANNELS.AUDIT_APP;
                    if (reviewAuditId) {
                        const auditChannel = await i.guild.channels.fetch(reviewAuditId).catch(() => null);
                        if (auditChannel) {
                            const auditEmbed = EmbedBuilder.from(i.message.embeds[0])
                                .setColor("Yellow")
                                .setTitle("⏳ Заявка на рассмотрении")
                                .addFields(
                                    { name: "Кого", value: `<@${targetId}>`, inline: true },
                                    { name: "Взял на рассмотрение", value: `<@${i.user.id}>`, inline: true }
                                )
                                .setTimestamp();
                            await auditChannel.send({ embeds: [auditEmbed] }).catch(() => null);
                        }
                    }

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
// GUILD MEMBER UPDATE — вычет когда осталась только 1 роль
// =====================================================
const DEDUCT_ROLE_ID = "1458410670071615580";

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        // Роли без @everyone до и после изменения
        const oldRoles = oldMember.roles.cache.filter(r => r.id !== newMember.guild.id);
        const newRoles = newMember.roles.cache.filter(r => r.id !== newMember.guild.id);

        // Условие: раньше ролей было больше одной, теперь осталась ТОЛЬКО 1458410670071615580 и больше ничего
        const wasMoreThanOne = oldRoles.size > 1;
        const nowOnlyDeductRole = newRoles.size === 1 && newRoles.has(DEDUCT_ROLE_ID);

        if (!wasMoreThanOne || !nowOnlyDeductRole) return;

        // Ищем рекрута, который принял этого участника
        const recruiterId = salary.recruits[newMember.id];
        if (!recruiterId) return;

        // Списываем 10к (не уходим в минус)
        salary.balances[recruiterId] = Math.max(0, (salary.balances[recruiterId] || 0) - 10000);
        await saveDB(salary);

        const config = SERVERS[newMember.guild.id];
        if (config) await updateSalaryEmbed(newMember.guild);

        // Уведомление в канал (осталась одна роль)
        const newBal2 = salary.balances[recruiterId] || 0;
        const notifyChannel2 = await newMember.guild.channels.fetch("1518544382985371698").catch(() => null);
        if (notifyChannel2) {
            await notifyChannel2.send({
                content: `⚠️ <@${recruiterId}>, с вашего баланса списано **$10,000** — у <@${newMember.id}> **осталась только одна роль**.
Ваш баланс: **$${newBal2.toLocaleString()}**`
            }).catch(() => null);
        }
    } catch (e) {
        console.error("[MEMBER UPDATE ERROR]", e);
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
connectDB().then(() => {
    client.login(process.env.TOKEN);
}).catch(err => {
    console.error("[DB] Ошибка подключения к MongoDB:", err);
    process.exit(1);
});
