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
app.get("/", (_, res) => { res.send(`Bot Alive (Instance: ${INSTANCE_ID})`); });
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
    "1458190222042075251": { // Главный сервер (Darkness)
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            PANEL: "1458410655697731730",
            CATEGORY: "1513659194832719962", // Перенаправлено по требованию
            REPORT_CATEGORY: "1458410646956806196", // Категория для тикетов отчетов
            REPORT_PANEL_CHAN: "1513649382396919979", // Канал панели отчетов
            NOTIF_CHAN: "1513660056338436206", // Канал уведомлений на повышение
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            AFK_CHAN: "1500519252518768792"
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
            { id: "1475114013611528274", name: "Каптеры" }
        ],
        PING_ROLES: ["1458410756453306490"],
        // РОЛИ ДЛЯ СИСТЕМЫ ПОВЫШЕНИЙ
        RANKS: {
            R1: "1513647909965533377", // TEST
            R2: "1458485405769797848", // Academy
            R3: "1458485351424331903", // Young
            R4: "1458485277495656553"  // Darkness
        }
    },
    "1504470399268819115": { // Сервер BALLAS
        CHANNELS: {
            SBOR: "1504574610564321290"
        },
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
        if (!data.reportsCount) data.reportsCount = {}; // Хранение одобренных отчетов
        if (!data.savedApps) data.savedApps = {}; // Хранение анкет для команды /info
        if (!data.afkUsers) data.afkUsers = {}; // Хранение пользователей в АФК
        return data;
    } catch {
        return { balances: {}, recruits: {}, reportsCount: {}, savedApps: {}, afkUsers: {} };
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
// HELPER PERMISSION CHECK
// =====================================================
function hasStaffPermission(member, config) {
    if (!config || !config.ALLOWED_ROLES) return false;
    return config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
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
            .setColor("#1f8b4c")
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
// MONITORING SYSTEM ("СОСТАВ")
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

            // 1. Подсчет РП Состава (Суммирование 4 ролей по ТЗ)
            if (config.RANKS) {
                const rpRoleIds = [config.RANKS.R1, config.RANKS.R2, config.RANKS.R3, config.RANKS.R4];
                let rpOnline = 0;
                let rpTotal = 0;
                let rpListString = "";

                // Собираем уникальных пользователей со всеми 4 ролями
                const rpMembers = new Set();
                rpRoleIds.forEach(id => {
                    const r = guild.roles.cache.get(id);
                    if (r) r.members.forEach(m => rpMembers.add(m));
                });

                if (rpMembers.size === 0) {
                    rpListString = "*В РП составе никого нет*";
                } else {
                    rpMembers.forEach(member => {
                        totalMembersCount++;
                        rpTotal++;
                        const isOnline = member.presence && member.presence.status !== "offline";
                        const statusEmoji = isOnline ? "🟢" : "🔴";
                        if (isOnline) { rpOnline++; totalOnline++; }
                        rpListString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                const rpEmbed = new EmbedBuilder()
                    .setTitle(`👥 РП Состав [В сети: ${rpOnline}/${rpTotal}]`)
                    .setDescription(rpListString)
                    .setColor("#2b2d31");
                embedsArray.push(rpEmbed);
            }

            // 2. Подсчет остальных выводимых ролей (Каптеры, Рекруты)
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
                        if (isOnline) { roleOnline++; totalOnline++; }
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
        console.error(`[MONITOR ERROR]`, error);
    }
}

// =====================================================
// AFK SYSTEM EMBED UPDATE
// =====================================================
async function updateAfkEmbed(guild) {
    const config = SERVERS[guild.id];
    if (!config || !config.CHANNELS || !config.CHANNELS.AFK_CHAN) return;

    const channel = await guild.channels.fetch(config.CHANNELS.AFK_CHAN).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("💤 Список участников в AFK")
        .setColor("#2b2d31")
        .setTimestamp();

    let desc = "";
    const activeAfk = Object.entries(salary.afkUsers || {});
    if (activeAfk.length === 0) {
        desc = "*В данный момент никто не находится в AFK.*";
    } else {
        activeAfk.forEach(([userId, timeStr]) => {
            desc += `• <@${userId}> — Зашёл в AFK: \`${timeStr}\`\n`;
        });
    }

    embed.setDescription(desc);

    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const botMsg = messages ? messages.find(m => m.author.id === client.user.id && m.components.length > 0) : null;

    if (botMsg) {
        await botMsg.edit({ embeds: [embed] }).catch(() => null);
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
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить интерактивную панель системы повышений"),
        new SlashCommandBuilder().setName("monitor_panel").setDescription("Отправить пульт мониторинга состава"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить панель управления режимом AFK"),
        new SlashCommandBuilder().setName("rank").addUserOption(o => o.setName("target").setDescription("Пользователь")).setDescription("Посмотреть статистику отчетов"),
        new SlashCommandBuilder().setName("info").addUserOption(o => o.setName("target").setDescription("Пользователь").setRequired(true)).setDescription("Информация об участнике и его анкете")
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
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команд успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR]`, e);
    }

    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);
});

// =====================================================
// SERVER EVENTS (JOIN / LEAVE / SYNC)
// =====================================================
client.on(Events.GuildMemberAdd, async (member) => {
    // Кросс-серверная выдача ролей Ballas при наличии на основном сервере Darkness
    if (member.guild.id === "1504470399268819115") {
        const mainGuild = client.guilds.cache.get("1458190222042075251");
        if (mainGuild) {
            const hasOnMain = await mainGuild.members.fetch(member.id).catch(() => null);
            if (hasOnMain) {
                await member.roles.add("1504470450305241288").catch(() => null);
            }
        }
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    // Удаление из базы рекрутов
    if (salary.recruits && salary.recruits[member.id]) {
        const recruiterId = salary.recruits[member.id];
        if (salary.balances[recruiterId]) {
            salary.balances[recruiterId] -= 10000;
            if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
        }
        delete salary.recruits[member.id];
    }
    // Удаление из АФК при выходе с сервера
    if (salary.afkUsers && salary.afkUsers[member.id]) {
        delete salary.afkUsers[member.id];
        await updateAfkEmbed(member.guild);
    }
    saveDB(salary);
    await updateSalaryEmbed(member.guild);
});

// =====================================================
// CHAT MESSAGES SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;
        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            if (!hasStaffPermission(msg.member, config)) return;

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

        // ОБЫЧНЫЙ SCREEN SYSTEM ДЛЯ РЕКРУТОВ
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
// INTERACTIONS (SLASH COMMANDS & BUTTONS & MODALS)
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // -----------------------------------------------------
        // СЛЭШ КОМАНДЫ
        // -----------------------------------------------------
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                const currentBal = salary.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "rank") {
                const target = i.options.getUser("target") || i.user;
                const count = salary.reportsCount[target.id] || 0;
                const member = await i.guild.members.fetch(target.id).catch(() => null);

                let currentRankName = "Отсутствует";
                if (member && config?.RANKS) {
                    if (member.roles.cache.has(config.RANKS.R4)) currentRankName = "Darkness (4 Ранг)";
                    else if (member.roles.cache.has(config.RANKS.R3)) currentRankName = "Young (3 Ранг)";
                    else if (member.roles.cache.has(config.RANKS.R2)) currentRankName = "Academy (2 Ранг)";
                    else if (member.roles.cache.has(config.RANKS.R1)) currentRankName = "TEST (1 Ранг)";
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
                    .setTitle("📊 Статистика отчётов повышения")
                    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                    .setColor("#2b2d31")
                    .addFields(
                        { name: "👤 Участник", value: `<@${target.id}>`, inline: true },
                        { name: "🛡️ Текущий Ранг", value: `\`${currentRankName}\``, inline: true },
                        { name: "✅ Принято МП/Скринов", value: `\`${count}\` шт.`, inline: true }
                    )
                    .setFooter({ text: "Darkness Promotion System" })
                    .setTimestamp();

                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            // Ограничение прав на административные команды
            if (["delete", "panel", "group_panel", "report_panel", "monitor_panel", "afk_panel", "info"].includes(i.commandName)) {
                if (!hasStaffPermission(i.member, config)) {
                    await i.reply({ content: "❌ У вас нет прав для использования этой команды.", ephemeral: true });
                    return;
                }
            }

            if (i.commandName === "info") {
                const target = i.options.getUser("target");
                const targetMember = await i.guild.members.fetch(target.id).catch(() => null);
                const savedApp = salary.savedApps[target.id];

                const joinedTime = targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : "Нет данных";
                const interviewer = savedApp?.interviewerId ? `<@${savedApp.interviewerId}>` : "`Автоматически / Нет данных`";

                const embed = new EmbedBuilder()
                    .setTitle(`ℹ️ Информация об участнике`)
                    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                    .setColor("#2b2d31")
                    .addFields(
                        { name: "Пользователь", value: `${target} (\`${target.username}\`)`, inline: false },
                        { name: "Кто принимал в тикете", value: interviewer, inline: true },
                        { name: "Сколько на сервере", value: joinedTime, inline: true }
                    )
                    .setTimestamp();

                const row = new ActionRowBuilder();
                if (savedApp) {
                    row.addComponents(
                        new ButtonBuilder().setCustomId(`view_app_${target.id}`).setLabel("Посмотреть анкету заявки").setStyle(ButtonStyle.Primary).setEmoji("📄")
                    );
                    await i.reply({ embeds: [embed], components: [row], ephemeral: true });
                } else {
                    await i.reply({ embeds: [embed], content: "⚠️ Исходная анкета подачи заявки в базе данных бота не найдена.", ephemeral: true });
                }
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

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription("Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.\n\n⏳ **Время рассмотрения:** от 1 до 4 дней.\n\n**📌 Перед подачей убедитесь, что ваш Discord открыт для связи.**")
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

            if (i.commandName === "report_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.REPORT_PANEL_CHAN) return;
                const channel = await client.channels.fetch(config.CHANNELS.REPORT_PANEL_CHAN);

                const embed = new EmbedBuilder()
                    .setTitle("🔮 СИСТЕМА ПОВЫШЕНИЯ | DARKNESS FAMQ")
                    .setDescription(
`Повышение выдается только при соблюдении всех требований и по решению старшего состава семьи.

🟢 **TEST (1 ранг) ➔ 🎓 ACADEMY (2 ранг)**
**Требования:**
• 5 МП (Скриншотов)
• Фамилия Darkness
• Знание правил семьи и сервера
• Онлайн не менее 3 часов в день
• Адекватное поведение в семье и на сервере

🔮 **ACADEMY (2 ранг) ➔ 🌿 YOUNG (3 ранг)**
**Требования:**
• 10 МП суммарно
• Умение слушать и выполнять коллы
• Грамотная и адекватная игра
• Отсутствие серьезных нарушений, варнов и жалоб от членов семьи/фракции

🌿 **YOUNG (3 ранг) ➔ 🍇 DARKNESS (4 ранг)**
**Требования:**
• 20 МП суммарно
• Стабильный онлайн (100+ часов в игре)
• Помощь семье и младшему составу
• Хорошая коммуникация и командная работа

🍇 **DARKNESS (4 ранг) ➔ 🎖️ RECRUIT (5 ранг)**
**Требования:**
• Грамотное общение и уважение к составу
• Стабильный онлайн (3+ часа в день)
• Адекватность в любых ситуациях
• Ответственность и дисциплина

⚠️ **ВАЖНО:** Старший состав имеет право отказать в повышении. Наличие токсичного поведения — причина отказа. Повышение не является автоматическим в планшете.`
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("submit_report_btn").setLabel("Подать отчет на повышение").setStyle(ButtonStyle.Success).setEmoji("📂")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель системы повышений отправлена!", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.AFK_CHAN) return;
                const channel = await client.channels.fetch(config.CHANNELS.AFK_CHAN);

                const embed = new EmbedBuilder()
                    .setTitle("💤 Управление режимом AFK")
                    .setDescription("Используйте кнопки ниже, чтобы зафиксировать своё состояние ухода/выхода из АФК.")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("afk_go").setLabel("Встать в АФК").setStyle(ButtonStyle.Secondary).setEmoji("🛌"),
                    new ButtonBuilder().setCustomId("afk_leave").setLabel("Выйти из АФК").setStyle(ButtonStyle.Success).setEmoji("🌅")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель АФК успешно развернута!", ephemeral: true });
                await updateAfkEmbed(i.guild);
                return;
            }

            if (i.commandName === "group_panel") {
                const channel = await client.channels.fetch(i.channelId).catch(() => null);
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

        // -----------------------------------------------------
        // ОБРАБОТКА ИНТЕРАКЦИЙ КНОПОК И МОДАЛОК
        // -----------------------------------------------------
        if (i.isButton()) {
            // Кнопка просмотра анкеты из /info
            if (i.customId.startsWith("view_app_")) {
                const targetId = i.customId.replace("view_app_", "");
                const appData = salary.savedApps[targetId];
                if (!appData) return i.reply({ content: "Анкета не найдена.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle(`📋 Сохраненная анкета пользователя`)
                    .setColor("#1f8b4c")
                    .setDescription(
`**Статик и Ник:** ${appData.q1}
**Имя и Возраст:** ${appData.q2}
**Опыт в семьях:** ${appData.q3}
**Почему выбрали нас:** ${appData.q4}
${appData.q5 ? `**Откаты:** ${appData.q5}` : ""}`
                    );
                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            // Кнопки АФК Системы
            if (i.customId === "afk_go") {
                const nowStr = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                if (!salary.afkUsers) salary.afkUsers = {};
                salary.afkUsers[i.user.id] = nowStr;
                saveDB(salary);
                await i.reply({ content: "⏳ Вы вошли в режим AFK. Из рассылок сборов вы исключены.", ephemeral: true });
                await updateAfkEmbed(i.guild);
                return;
            }

            if (i.customId === "afk_leave") {
                if (salary.afkUsers && salary.afkUsers[i.user.id]) {
                    delete salary.afkUsers[i.user.id];
                    saveDB(salary);
                }
                await i.reply({ content: "🌅 Вы вышли из режима AFK.", ephemeral: true });
                await updateAfkEmbed(i.guild);
                return;
            }

            // Кнопка вызова модалки Отчета Повышения
            if (i.customId === "submit_report_btn") {
                const modal = new ModalBuilder().setCustomId("report_submit_modal").setTitle("Подача отчета на повышение");
                const staticInput = new TextInputBuilder()
                    .setCustomId("report_static")
                    .setLabel("Введите статик игрового персонажа (ЦИФРЫ)")
                    .setPlaceholder("Пример: 21074")
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short);

                const urlInput = new TextInputBuilder()
                    .setCustomId("report_proof_url")
                    .setLabel("Ссылка на доказательства (Imgur / Я.Диск)")
                    .setPlaceholder("https://imgur.com/...")
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(staticInput),
                    new ActionRowBuilder().addComponents(urlInput)
                );
                await i.showModal(modal);
                return;
            }

            // Кнопки управления ТИКЕТОМ отчета (Принять / Отказать отчет)
            if (i.customId.startsWith("rep_accept_") || i.customId.startsWith("rep_reject_")) {
                if (!hasStaffPermission(i.member, config)) return i.reply({ content: "Недостаточно прав.", ephemeral: true });
                
                const parts = i.customId.split("_");
                const action = parts[1];
                const targetId = parts[2];

                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

                if (action === "reject") {
                    if (targetMember) await targetMember.send(`❌ Ваш отчет на повышение на сервере **${i.guild.name}** был отклонен модератором.`).catch(() => null);
                    await i.reply({ content: "Отчет отклонен. Тикет закрывается..." });
                    setTimeout(() => i.channel.delete().catch(() => null), 2000);
                    return;
                }

                if (action === "accept") {
                    if (!salary.reportsCount) salary.reportsCount = {};
                    salary.reportsCount[targetId] = (salary.reportsCount[targetId] || 0) + 1;
                    saveDB(salary);

                    if (targetMember) await targetMember.send(`✅ Ваш отчет был успешно одобрен! Статистика обновлена.`).catch(() => null);

                    // ПРОВЕРКА КРИТЕРИЕВ ПОВЫШЕНИЯ ПО РОЛЯМ И ТЗ
                    if (config?.RANKS && targetMember) {
                        const count = salary.reportsCount[targetId];
                        let nextRankRole = null;
                        let nextRankName = "";

                        if (targetMember.roles.cache.has(config.RANKS.R1) && count >= 5) {
                            nextRankRole = config.RANKS.R2; nextRankName = "Academy (2 Ранг)";
                        } else if (targetMember.roles.cache.has(config.RANKS.R2) && count >= 10) {
                            nextRankRole = config.RANKS.R3; nextRankName = "Young (3 Ранг)";
                        } else if (targetMember.roles.cache.has(config.RANKS.R3) && count >= 20) {
                            nextRankRole = config.RANKS.R4; nextRankName = "Darkness (4 Ранг)";
                        }

                        if (nextRankRole) {
                            // Высылаем уведомление старшим в канал уведомлений
                            const notifChan = await i.guild.channels.fetch(config.CHANNELS.NOTIF_CHAN).catch(() => null);
                            if (notifChan) {
                                const upEmbed = new EmbedBuilder()
                                    .setTitle("⚡ Достигнут лимит отчетов на повышение")
                                    .setDescription(`Игрок <@${targetId}> набрал \`${count}\` отчетов.\nРекомендуется повысить его до: **${nextRankName}** в планшете.`)
                                    .setColor("Gold");

                                const upRow = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`prom_accept_${targetId}_${nextRankRole}`).setLabel("Одобрить ранг").setStyle(ButtonStyle.Success),
                                    new ButtonBuilder().setCustomId(`prom_reject_${targetId}`).setLabel("Отклонить ранг").setStyle(ButtonStyle.Danger)
                                );
                                await notifChan.send({ embeds: [upEmbed], components: [upRow] });
                            }
                        }
                    }

                    await i.reply({ content: "Отчет принят! Статистика засчитана. Тикет закрывается..." });
                    setTimeout(() => i.channel.delete().catch(() => null), 2000);
                    return;
                }
            }

            // Кнопки окончательного утверждения ранга руководящими ролями в канале "уведомление"
            if (i.customId.startsWith("prom_accept_") || i.customId.startsWith("prom_reject_")) {
                if (!hasStaffPermission(i.member, config)) return i.reply({ content: "Недостаточно прав.", ephemeral: true });
                const parts = i.customId.split("_");
                const action = parts[1];
                const targetId = parts[2];
                const roleId = parts[3];

                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

                if (action === "reject") {
                    if (targetMember) await targetMember.send("❌ Старший состав отклонил ваше системное повышение.").catch(() => null);
                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "Повышение отклонено.", ephemeral: true });
                    return;
                }

                if (action === "accept" && targetMember && config?.RANKS) {
                    // Снимаем старые ранги
                    const allRanks = Object.values(config.RANKS);
                    for (const r of allRanks) { await targetMember.roles.remove(r).catch(() => null); }
                    // Выдаем новый ранг
                    await targetMember.roles.add(roleId).catch(() => null);

                    if (targetMember) await targetMember.send(`🎉 Поздравляем! Старший состав утвердил ваше повышение до роли <@&${roleId}>!`).catch(() => null);
                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "✅ Ранг успешно обновлен пользователю на сервере Discord!", ephemeral: true });
                    return;
                }
            }

            // Старые кнопки подтверждения выплат рекрутам
            if (i.customId.startsWith("audit_")) {
                if (!hasStaffPermission(i.member, config)) return i.reply({ content: "Недостаточно прав.", ephemeral: true });
                const parts = i.customId.split("_");
                const action = parts[1];

                if (action === "verify") {
                    const cId = parts[2];
                    if (!cId || cId === "unknown") return i.reply({ content: "Невалидный ID", ephemeral: true });
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    return i.reply({ content: isPresent ? `🟢 <@${cId}> на сервере.` : `🔴 Игрок вышел.`, ephemeral: true });
                }

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "Отчёт отклонён.", ephemeral: true });
                }

                if (action === "accept") {
                    salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 10000;
                    if (candidateId && candidateId !== "unknown") salary.recruits[candidateId] = recruiterId;
                    saveDB(salary);
                    await updateSalaryEmbed(i.guild);
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "✅ Отчёт подтвержден! Рекрутеру начислено $10,000.", ephemeral: true });
                }
            }

            // Старые кнопки обычных отчетов скриншотов
            if (i.customId.startsWith("accept_") || i.customId.startsWith("reject_")) {
                if (!hasStaffPermission(i.member, config)) return i.reply({ content: "Недостаточно прав.", ephemeral: true });
                const parts = i.customId.split("_");
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary.balances[targetId] = (salary.balances[targetId] || 0) + 1000;
                    saveDB(salary);
                    await updateSalaryEmbed(i.guild);
                    embed.setColor("Green").setTitle("📸 Отчёт одобрен");
                    await i.update({ embeds: [embed], components: [] });
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                    await i.update({ embeds: [embed], components: [] });
                }
                return;
            }

            // Кнопки управления тикетом заявок в семью (app)
            if (i.customId.startsWith("app_")) {
                if (!hasStaffPermission(i.member, config)) return i.reply({ content: "Недостаточно прав.", ephemeral: true });
                const parts = i.customId.split("_");
                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Пользователь покинул сервер.", ephemeral: true });
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    await targetMember.roles.add(rolesToAdd).catch(() => null);

                    // Сохраняем анкету в базу для команды /info
                    const memoryApp = applications.get(targetId);
                    if (memoryApp) {
                        if (!salary.savedApps) salary.savedApps = {};
                        salary.savedApps[targetId] = { ...memoryApp, interviewerId: i.user.id };
                        saveDB(salary);
                    }

                    await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false }).catch(() => null);
                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send({ content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран. Предоставьте скриншот с планшета сюда для фиксации аудита.` });
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
                        new ChannelSelectMenuBuilder().setCustomId(`call_voice_${targetId}`).setPlaceholder("Выберите голосовой канал").addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "⬇️ Выберите голосовой канал:", components: [voiceMenu], ephemeral: true });
                    return;
                }

                if (action === "reject") {
                    const modal = new ModalBuilder().setCustomId(`app_reject_modal_${targetId}`).setTitle("Причина отказа");
                    const reasonInput = new TextInputBuilder().setCustomId("reject_reason_input").setLabel("Укажите причину:").setRequired(true).setStyle(TextInputStyle.Paragraph);
                    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                    await i.showModal(modal);
                    return;
                }
            }

            // Старая система пульта управления сборами
            if (i.customId.startsWith("group_start_")) {
                const faction = i.customId.replace("group_start_", "");
                const menu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`group_select_${faction}`).setPlaceholder("Выберите тип мероприятия"));
                if (faction === "ballas") {
                    menu.components[0].addOptions({ label: "Цеха", value: "цеха" }, { label: "Диллеры", value: "диллеры" }, { label: "Остров", value: "остров" }, { label: "Поставки", value: "поставки" }, { label: "ФЗ", value: "фз" }, { label: "Контент", value: "контент" }, { label: "Банк", value: "банк" }, { label: "Дроп", value: "дроп" });
                } else {
                    menu.components[0].addOptions({ label: "Капты", value: "капты" }, { label: "Контент", value: "контент" }, { label: "Арену", value: "арену" }, { label: "Тайники", value: "тайники" });
                }
                await i.reply({ content: "Выберите тип сбора:", components: [menu], ephemeral: true });
                return;
            }

            if (i.customId.startsWith("sbor_")) {
                if (i.customId === "sbor_cancel") {
                    await i.update({ content: "✅ Панель закрыта.", embeds: [], components: [] });
                    return;
                }
                const parts = i.customId.split("_");
                const action = parts[1]; const guildId = parts[2]; const activity = parts[3]; const code = parts[4];
                const targetConfig = SERVERS[guildId]; if (!targetConfig) return;
                const targetGuild = await client.guilds.fetch(guildId).catch(() => null); if (!targetGuild) return;

                const pingString = `@everyone ${targetConfig.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
                const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

                if (action === "channel") {
                    const targetChannel = await targetGuild.channels.fetch(targetConfig.CHANNELS.SBOR).catch(() => null);
                    if (targetChannel) {
                        await targetChannel.send(messageContent).catch(() => null);
                        await i.reply({ content: "✅ Успешно отправлено в канал сбора!", ephemeral: true });
                    }
                } else if (action === "dms") {
                    await i.reply({ content: "⏳ Начинаю рассылку в ЛС (Исключая игроков в AFK)...", ephemeral: true });
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => targetConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot);

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        // Исключаем отправку пользователям, которые находятся в списке AFK
                        if (salary.afkUsers && salary.afkUsers[id]) continue;
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений.` });
                }
                return;
            }
        }

        // МЕНЮ ВЫБОРА ВОЙСА (ДЛЯ ОБЗВОНА)
        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];
            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;

            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон! Перейдите: [Войти в канал](${voiceUrl}) (<#${voiceChannelId}>).`);
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) await targetMember.send({ content: `Тебя вызвали на обзвон! Ссылка: ${voiceUrl}` }).catch(() => null);
            await i.reply({ content: "✅ Уведомление отправлено.", ephemeral: true });
            return;
        }

        // СТРОКОВЫЕ МЕНЮ (ЗАЯВКИ / СБОРЫ)
        if (i.isStringSelectMenu()) {
            if (i.customId === "apply_menu") {
                const type = i.values[0];
                const modal = new ModalBuilder().setCustomId(`apply_modal_${type}`).setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");
                const fields = [
                    { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ", placeholder: "21074 | Hugo Darkness" },
                    { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20" },
                    { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в..." },
                    { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?", placeholder: "Увидел на респе..." }
                ];
                if (type !== "academy") fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат" });

                modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.id === "q3" || f.id === "q4" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                )));
                await i.showModal(modal);
                return;
            }

            if (i.customId.startsWith("group_select_")) {
                const faction = i.customId.replace("group_select_", "");
                const activity = i.values[0];
                const modal = new ModalBuilder().setCustomId(`group_modal_code_${faction}_${activity}`).setTitle("Код группы");
                const codeInput = new TextInputBuilder().setCustomId("group_code_input").setLabel("Введите код группы из 5 символов").setMinLength(5).setMaxLength(5).setRequired(true).setStyle(TextInputStyle.Short);
                modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
                await i.showModal(modal);
                return;
            }
        }

        // ОБРАБОТКА SUBMIT MODAL ЗАЯВОК И ОТЧЕТОВ
        if (i.isModalSubmit()) {
            if (i.customId === "report_submit_modal") {
                const staticId = i.fields.getTextInputValue("report_static");
                const url = i.fields.getTextInputValue("report_proof_url");

                // Валидация статика: ТОЛЬКО ЦИФРЫ по ТЗ
                if (!/^\d+$/.test(staticId)) {
                    return i.reply({ content: "❌ Ошибка: В строке статик должны быть только цифры!", ephemeral: true });
                }

                // Создаем тикет отчета в соответствующей категории
                const ticketChannel = await i.guild.channels.create({
                    name: `отчет-${i.user.username}`,
                    type: ChannelType.GuildText,
                    parent: config.CHANNELS.REPORT_CATEGORY,
                    permissionOverwrites: [
                        { id: i.guild.id, deny: ["ViewChannel"] },
                        { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                        ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                    ]
                });

                const embed = new EmbedBuilder()
                    .setTitle("📝 Новый отчет на повышение")
                    .setColor("#1f8b4c")
                    .addFields(
                        { name: "👤 Отправитель", value: `<@${i.user.id}> (\`${i.user.id}\`)` },
                        { name: "🆔 Статик персонажа", value: `\`${staticId}\`` },
                        { name: "🔗 Доказательства (Ссылка)", value: url }
                    )
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`rep_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`rep_reject_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: `✅ Ваш отчет успешно зарегистрирован. Открыт тикет: <#${ticketChannel.id}>`, ephemeral: true });
                return;
            }

            if (i.customId.startsWith("apply_modal_")) {
                if (modalLocks.has(i.user.id)) return;
                modalLocks.add(i.user.id); setTimeout(() => modalLocks.delete(i.user.id), 5000);

                const type = i.customId.replace("apply_modal_", "");
                const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');

                const existingChannel = i.guild.channels.cache.find(c => c.parentId === config.CHANNELS.CATEGORY && c.name === expectedChannelName);
                if (existingChannel) return i.reply({ content: `⚠️ У вас уже создан канал: <#${existingChannel.id}>`, ephemeral: true });

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

                let embedDescription = `**СТАТИК И НИК:** ${data.q1}\n\n**ИМЯ И ВОЗРАСТ:** ${data.q2}\n\n**ОПЫТ:** ${data.q3}\n\n**ПОЧЕМУ МЫ:** ${data.q4}`;
                if (type !== "academy") embedDescription += `\n\n**ОТКАТЫ:** ${data.q5}`;

                const embed = new EmbedBuilder().setTitle("Заявление").setDescription(embedDescription).setColor("#1f8b4c");
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: `${config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ")}`, embeds: [embed], components: [row] });
                await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
                return;
            }

            if (i.customId.startsWith("app_reject_modal_")) {
                const targetId = i.customId.replace("app_reject_modal_", "");
                const reason = i.fields.getTextInputValue("reject_reason_input");
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                if (targetMember) await targetMember.send(`❌ Ваша заявка отклонена по причине: ${reason}`).catch(() => null);
                await i.reply({ content: "Заявка успешно отклонена." });
                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }

            if (i.customId.startsWith("group_modal_code_")) {
                const parts = i.customId.split("_"); const faction = parts[3]; const activity = parts[4];
                const code = i.fields.getTextInputValue("group_code_input").toUpperCase();
                const guildId = faction === "ballas" ? "1504470399268819115" : "1458190222042075251";

                const controlEmbed = new EmbedBuilder().setTitle("⚙️ Панель управления сбором").setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код группы:** \`${code}\``).setColor("Yellow");
                const controlRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`sbor_channel_${guildId}_${activity}_${code}`).setLabel("В канал").setStyle(ButtonStyle.Primary).setEmoji("📣"),
                    new ButtonBuilder().setCustomId(`sbor_dms_${guildId}_${activity}_${code}`).setLabel("В ЛС").setStyle(ButtonStyle.Secondary).setEmoji("📩"),
                    new ButtonBuilder().setCustomId("sbor_cancel").setLabel("Скрыть").setStyle(ButtonStyle.Danger)
                );
                await i.reply({ embeds: [controlEmbed], components: [controlRow], ephemeral: true });
                return;
            }
        }
    } catch (e) {
        console.log(`[INTERACTION ERROR]`, e);
    }
});

// =====================================================
// SHUTDOWN
// =====================================================
const shutdown = () => {
    console.log(`[BOT] Получен сигнал выключения.`);
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
