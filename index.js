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
            APP_CATEGORY: "1513659194832719962",        // НОВАЯ КАТЕГОРИЯ ЗАЯВОК В СЕМЬЮ
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076", 
            SBOR: "1458481307351781709",
            REPORT_PANEL: "1513649382396919979",       // КАНАЛ ОТЧЕТОВ
            REPORT_CATEGORY: "1458410646956806196",    // КАТЕГОРИЯ ДЛЯ ТИКЕТОВ ОТЧЕТОВ
            PROMOTION_NOTIFY: "1513660056338436206",   // КАНАЛ УВЕДОМЛЕНИЙ ПОВЫШЕНИЙ
            AFK_CHANNEL: "1500519252518768792"         // КАНАЛ АФК
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
        RANKS: {
            TEST: "1513647909965533377",
            ACADEMY: "1458485405769797848",
            YOUNG: "1458485351424331903",
            DARKNESS: "1458485277495656553"
        },
        MONITOR_ROLES: [
            { id: "1458485405769797848", name: "Academy" },
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
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.reports) data.reports = {};       // Хранит { userId: count }
        if (!data.afk) data.afk = {};               // Хранит { userId: { timestamp, reason } }
        if (!data.appHistory) data.appHistory = {}; // Хранит { userId: { recruiter, date, q1, q2... } }
        return data;
    } catch {
        return { balances: {}, recruits: {}, reports: {}, afk: {}, appHistory: {} };
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
// AFK SYSTEM (ОБНОВЛЕНИЕ ЭМБЕДА В КАНАЛЕ)
// =====================================================
async function updateAfkEmbed(guildId) {
    try {
        const config = SERVERS[guildId];
        if (!config || !config.CHANNELS.AFK_CHANNEL) return;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.CHANNELS.AFK_CHANNEL).catch(() => null);
        if (!channel) return;

        let listString = "";
        const afkUsers = Object.keys(salary.afk);

        if (afkUsers.length === 0) {
            listString = "*На данный момент в АФК никого нет.*";
        } else {
            for (const userId of afkUsers) {
                const data = salary.afk[userId];
                // Используем таймстемпы Discord для красивого отображения времени
                const timeString = `<t:${Math.floor(data.timestamp / 1000)}:R>`;
                listString += `<@${userId}> ✅:\n> встал в АФК: ${timeString}\n> причина: ${data.reason}\n\n`;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("Список АФК")
            .setDescription(listString)
            .setColor("#2b2d31")
            .setTimestamp();

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === "Список АФК") : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    } catch (error) {
        console.error(`[AFK EMBED ERROR]`, error);
    }
}

// =====================================================
// SALARY & MONITORING
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

        if (!hasActiveBalances) listString = "*На этой неделе выплат пока нет.*";
        embed.addFields({ name: "💵 Текущие балансы рекрутов:", value: listString, inline: false });

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💰 Ведомость выплат")) : null;

        if (botMessage) await botMessage.edit({ embeds: [embed] }).catch(() => null);
        else await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (error) {}
}

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

            if (botMessage) await botMessage.edit({ embeds: embedsArray }).catch(() => null);
            else await channel.send({ embeds: embedsArray }).catch(() => null);
        }
    } catch (error) {}
}

// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить панель для подачи отчетов на повышение"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить панель управления АФК"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить панель управления сборами"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("delete").setDescription("Полностью очистить все балансы игроков"),
        new SlashCommandBuilder().setName("rank")
            .setDescription("Посмотреть статистику отчетов и ранг")
            .addUserOption(option => option.setName("user").setDescription("Пользователь (необязательно)")),
        new SlashCommandBuilder().setName("info")
            .setDescription("Посмотреть информацию об игроке")
            .addUserOption(option => option.setName("user").setDescription("Пользователь").setRequired(true))
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR]`, e);
    }

    await updateOnlineMonitor();
    for (const guildId of Object.keys(SERVERS)) {
        await updateAfkEmbed(guildId);
    }
    setInterval(updateOnlineMonitor, 60000);
});

// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        if (salary.recruits && salary.recruits[member.id]) {
            const recruiterId = salary.recruits[member.id];
            if (salary.balances[recruiterId]) {
                salary.balances[recruiterId] -= 10000;
                if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
            }
            delete salary.recruits[member.id];
        }
        
        if (salary.afk && salary.afk[member.id]) {
            delete salary.afk[member.id];
            await updateAfkEmbed(member.guild.id);
        }

        saveDB(salary);
        await updateSalaryEmbed(member.guild);
    } catch (e) {}
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
            const currentBal = salary.balances[msg.author.id] || 0;
            return msg.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}` });
        }

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
    } catch (e) {
        console.log(`[MESSAGE ERROR]`, e);
    }
});

// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // ==========================================
        // СЛЭШ-КОМАНДЫ
        // ==========================================
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                const currentBal = salary.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "delete") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                salary.balances = {};
                salary.recruits = {};
                saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Балансы аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "rank") {
                const targetUser = i.options.getUser("user") || i.user;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                const count = salary.reports[targetUser.id] || 0;
                
                let nextRankText = "Максимальный ранг достигнут";
                if (targetMember) {
                    if (targetMember.roles.cache.has(config.RANKS.TEST)) nextRankText = `До Academy: ${Math.max(0, 5 - count)} отчетов`;
                    else if (targetMember.roles.cache.has(config.RANKS.ACADEMY)) nextRankText = `До Young: ${Math.max(0, 10 - count)} отчетов`;
                    else if (targetMember.roles.cache.has(config.RANKS.YOUNG)) nextRankText = `До Darkness: ${Math.max(0, 20 - count)} отчетов`;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📊 Статистика: ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setDescription(`**Всего одобренных отчетов (суммарно):** \`${count}\`\n**Прогресс:** ${nextRankText}`)
                    .setColor("#2b2d31");

                await i.reply({ embeds: [embed] });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                const joinDate = targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : "Неизвестно";
                
                const appData = salary.appHistory[targetUser.id];
                const recruiterText = appData ? `<@${appData.recruiter}>` : "Нет данных";

                const embed = new EmbedBuilder()
                    .setTitle(`ℹ️ Информация об игроке`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                    .addFields(
                        { name: "Пользователь", value: `<@${targetUser.id}>`, inline: true },
                        { name: "На сервере", value: joinDate, inline: true },
                        { name: "Кто принял", value: recruiterText, inline: true }
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`view_app_${targetUser.id}`)
                        .setLabel("Посмотреть заявку")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!appData)
                );

                await i.reply({ embeds: [embed], components: [row] });
                return;
            }

            if (i.commandName === "report_panel") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const channel = await client.channels.fetch(config.CHANNELS.REPORT_PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("СИСТЕМА ПОВЫШЕНИЯ")
                    .setDescription(`**С 1 ранга (TEST) > 2 ранг (Academy)**\n• 5 МП\n• Фамилия Darkness\n• Знание правил семьи/сервера\n• Актив в игре больше 3 часов в день\n\n**С 2 ранга (Academy) > 3 ранг (Young)**\n• 10 МП суммарно\n• Уметь слушать коллы\n• Адекватная игра\n• Отсутствие серьёзных нарушений\n\n**С 3 ранга (Young) > 4 ранг (Darkness)**\n• 20 МП суммарно\n• Стабильный онлайн\n• Помощь семье\n\n**С 4 ранга (Darkness) > 5 ранг (Recruit)**\n• Уметь грамотно общаться\n• Адекватность, ответственность`)
                    .setImage("https://i.imgur.com/r3bA3bK.png") // Широкий прозрачный разделитель для ширины
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_report_modal")
                        .setLabel("Подать отчет")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("📝")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель отчетов отправлена", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const channel = await client.channels.fetch(config.CHANNELS.AFK_CHANNEL);
                const embed = new EmbedBuilder()
                    .setTitle("Управление режимом АФК")
                    .setDescription("Нажмите кнопку ниже, чтобы встать в АФК или выйти из него. Находясь в АФК, вы не будете получать рассылки о сборах.")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("toggle_afk")
                        .setLabel("Встать / Выйти из АФК")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель АФК отправлена", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(`Нажмите на кнопку ниже, чтобы подать заявку...\n*(Условия вступления)*\n\n**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**`)
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
                    .setDescription("**Функционал:**\n• Выбор типа мероприятия\n• Ручная панель рассылки")
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

        // ==========================================
        // КНОПКА "Посмотреть заявку" (/info)
        // ==========================================
        if (i.isButton() && i.customId.startsWith("view_app_")) {
            const targetId = i.customId.replace("view_app_", "");
            const appData = salary.appHistory[targetId];
            if (!appData) return i.reply({ content: "Данных нет.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle("Архив: Заявление")
                .setDescription(`**Статик и Ник:**\n${appData.q1}\n\n**Имя и Возраст:**\n${appData.q2}\n\n**Опыт:**\n${appData.q3}\n\n**Почему Darkness:**\n${appData.q4}`)
                .setColor("#2b2d31");

            await i.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // ==========================================
        // СИСТЕМА ОТЧЕТОВ (Модалки и тикеты)
        // ==========================================
        if (i.isButton() && i.customId === "open_report_modal") {
            const modal = new ModalBuilder().setCustomId("report_modal").setTitle("Подача отчета");
            const staticInput = new TextInputBuilder().setCustomId("report_static").setLabel("Введите ваш статик (только цифры)").setStyle(TextInputStyle.Short).setRequired(true);
            const proofInput = new TextInputBuilder().setCustomId("report_proof").setLabel("Ссылка на скриншот (Imgur/YouTube)").setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(staticInput), new ActionRowBuilder().addComponents(proofInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "report_modal") {
            const staticId = i.fields.getTextInputValue("report_static");
            const proofUrl = i.fields.getTextInputValue("report_proof");

            if (!/^\d+$/.test(staticId)) {
                return i.reply({ content: "❌ Статик должен состоять только из цифр!", ephemeral: true });
            }

            const expectedName = `rep-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');
            const channel = await i.guild.channels.create({
                name: expectedName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.REPORT_CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("Новый отчет на повышение")
                .setDescription(`**Пользователь:** <@${i.user.id}>\n**Статик:** \`${staticId}\`\n\n**Доказательства:**\n${proofUrl}`)
                .setColor("#2b2d31");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rep_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rep_reject_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: `<@${i.user.id}>, ожидайте проверки.`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Отчет подан! Тикет: <#${channel.id}>`, ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("rep_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                if (targetMember) {
                    await targetMember.send(`❌ Привет! Твой отчет на сервере Darkness Famq 🌴 был отклонен администратором <@${i.user.id}>.`).catch(() => null);
                }
                await i.reply({ content: "❌ Отчет отклонен. Тикет закрывается." });
                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }

            if (action === "accept") {
                salary.reports[targetId] = (salary.reports[targetId] || 0) + 1;
                saveDB(salary);

                await i.reply({ content: "✅ Отчет принят! Тикет закрывается." });
                setTimeout(() => i.channel.delete().catch(() => null), 3000);

                // Проверка на повышение
                if (targetMember) {
                    const count = salary.reports[targetId];
                    let roleToGive = null, roleToRemove = null;

                    if (targetMember.roles.cache.has(config.RANKS.TEST) && count >= 5) {
                        roleToGive = config.RANKS.ACADEMY; roleToRemove = config.RANKS.TEST;
                    } else if (targetMember.roles.cache.has(config.RANKS.ACADEMY) && count >= 10) {
                        roleToGive = config.RANKS.YOUNG; roleToRemove = config.RANKS.ACADEMY;
                    } else if (targetMember.roles.cache.has(config.RANKS.YOUNG) && count >= 20) {
                        roleToGive = config.RANKS.DARKNESS; roleToRemove = config.RANKS.YOUNG;
                    }

                    if (roleToGive) {
                        const notifyChannel = await i.guild.channels.fetch(config.CHANNELS.PROMOTION_NOTIFY).catch(() => null);
                        if (notifyChannel) {
                            const pEmbed = new EmbedBuilder()
                                .setTitle("Уведомление о повышении")
                                .setDescription(`Игрок <@${targetId}> набрал необходимое количество отчетов (**${count}**) для повышения до <@&${roleToGive}>.`)
                                .setColor("#2b2d31");
                            const pRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`promo_accept_${targetId}_${roleToGive}_${roleToRemove}`).setLabel("Повысить").setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`promo_reject_${targetId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                            );
                            await notifyChannel.send({ embeds: [pEmbed], components: [pRow] });
                        }
                    }
                }
                return;
            }
        }

        if (i.isButton() && i.customId.startsWith("promo_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "accept") {
                const roleGive = parts[3];
                const roleRem = parts[4];
                if (targetMember) {
                    await targetMember.roles.add(roleGive).catch(() => null);
                    await targetMember.roles.remove(roleRem).catch(() => null);
                }
                await i.update({ content: `✅ <@${targetId}> успешно повышен пользователем <@${i.user.id}>!`, embeds: [], components: [] });
            } else {
                await i.update({ content: `❌ Отказано в повышении пользователем <@${i.user.id}>.`, embeds: [], components: [] });
            }
            return;
        }

        // ==========================================
        // СИСТЕМА АФК
        // ==========================================
        if (i.isButton() && i.customId === "toggle_afk") {
            if (salary.afk[i.user.id]) {
                delete salary.afk[i.user.id];
                saveDB(salary);
                await updateAfkEmbed(i.guild.id);
                await i.reply({ content: "✅ Вы успешно вышли из режима АФК.", ephemeral: true });
            } else {
                const modal = new ModalBuilder().setCustomId("afk_modal").setTitle("Режим АФК");
                const reasonInput = new TextInputBuilder().setCustomId("afk_reason").setLabel("Укажите причину и срок").setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await i.showModal(modal);
            }
            return;
        }

        if (i.isModalSubmit() && i.customId === "afk_modal") {
            const reason = i.fields.getTextInputValue("afk_reason");
            salary.afk[i.user.id] = { timestamp: Date.now(), reason };
            saveDB(salary);
            await updateAfkEmbed(i.guild.id);
            await i.reply({ content: "✅ Вы успешно встали в АФК.", ephemeral: true });
            return;
        }

        // ==========================================
        // УПРАВЛЕНИЕ СБОРАМИ
        // ==========================================
        if (i.isButton() && i.customId.startsWith("group_start_")) {
            const faction = i.customId.replace("group_start_", "");
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`group_select_${faction}`).setPlaceholder("Выберите тип мероприятия")
            );

            if (faction === "ballas") {
                menu.components[0].addOptions({ label: "Цеха", value: "цеха" }, { label: "Дроп", value: "дроп" });
            } else {
                menu.components[0].addOptions({ label: "Капты", value: "капты" }, { label: "Контент", value: "контент" });
            }
            await i.reply({ content: "Выберите тип сбора:", components: [menu], ephemeral: true });
            return;
        }

        if (i.isStringSelectMenu() && i.customId.startsWith("group_select_")) {
            const faction = i.customId.replace("group_select_", "");
            const activity = i.values[0];
            const modal = new ModalBuilder().setCustomId(`group_modal_code_${faction}_${activity}`).setTitle("Код группы");
            const codeInput = new TextInputBuilder().setCustomId("group_code_input").setLabel("Код из 5 символов").setMinLength(5).setMaxLength(5).setRequired(true).setStyle(TextInputStyle.Short);
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
                .setTitle("⚙️ Панель управления сбором")
                .setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код:** \`${code}\``)
                .setColor("Yellow");

            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`sbor_channel_${guildId}_${activity}_${code}`).setLabel("Отправить в канал").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`sbor_dms_${guildId}_${activity}_${code}`).setLabel("Отправить в ЛС").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("sbor_cancel").setLabel("Скрыть").setStyle(ButtonStyle.Danger)
            );

            await i.reply({ embeds: [controlEmbed], components: [controlRow], ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("sbor_")) {
            if (i.customId === "sbor_cancel") return i.update({ content: "✅ Закрыто.", embeds: [], components: [] });

            const parts = i.customId.split("_");
            const action = parts[1];
            const guildId = parts[2];
            const activity = parts[3];
            const code = parts[4];
            const cfg = SERVERS[guildId];
            if (!cfg) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${cfg.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(cfg.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) await targetChannel.send(messageContent);
                await i.reply({ content: "✅ Отправлено в канал!", ephemeral: true });
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку...", ephemeral: true });
                await targetGuild.members.fetch();
                
                const targetMembers = targetGuild.members.cache.filter(m => 
                    cfg.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !salary.afk[m.id]
                );

                let successCount = 0;
                for (const [id, member] of targetMembers) {
                    try {
                        await member.send(`🔔 **Внимание!**\n${messageContent}`);
                        successCount++;
                    } catch (e) {}
                }
                await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} (Игнорируя АФК).` });
            }
            return;
        }

        // ==========================================
        // ЗАЯВКИ В СЕМЬЮ (АКАДЕМИЯ / КАПТ)
        // ==========================================
        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder().setCustomId(`apply_modal_${type}`).setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?", placeholder: "Увидел на респе / медиа контент...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат", style: TextInputStyle.Paragraph });

            modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style))));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '');

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.APP_CATEGORY, // НОВАЯ КАТЕГОРИЯ ТУТ
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            applications.set(i.user.id, {
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : "Не требуется"
            });

            const embedDescription = `**СТАТИК И НИК**\n${applications.get(i.user.id).q1}\n\n**ИМЯ И ВОЗРАСТ**\n${applications.get(i.user.id).q2}\n\n**ОПЫТ**\n${applications.get(i.user.id).q3}\n\n**ПОЧЕМУ МЫ**\n${applications.get(i.user.id).q4}\n\n**ОТКАТЫ**\n${applications.get(i.user.id).q5}\n\n**Пользователь:** <@${i.user.id}>`;
            const embed = new EmbedBuilder().setTitle("Заявление").setDescription(embedDescription).setColor("#2b2d31");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" "), embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId.startsWith("app_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "accept") {
                if (!targetMember) return i.reply({ content: "❌ Вышел с сервера.", ephemeral: true });
                
                // Сохранение истории для команды /info
                const appData = applications.get(targetId);
                if (appData) {
                    salary.appHistory[targetId] = { recruiter: i.user.id, ...appData, date: Date.now() };
                    saveDB(salary);
                }

                const isAcademy = i.channel.name.startsWith("academy");
                const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                await targetMember.roles.add(rolesToAdd).catch(() => null);

                await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false }).catch(() => null);
                await i.channel.setName(`closed-${i.channel.name}`).catch(() => null);

                const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("Purple").setTitle("Заявление (Принято)");
                await i.update({ embeds: [embed], components: [] });
                await i.channel.send(`🎉 Принят!\n\n💼 <@${i.user.id}>, скинь скриншот планшета для аудита.`);
                return;
            }

            if (action === "reject") {
                const modal = new ModalBuilder().setCustomId(`app_reject_modal_${targetId}`).setTitle("Отказ");
                const reasonInput = new TextInputBuilder().setCustomId("reject_reason_input").setLabel("Укажите причину:").setRequired(true).setStyle(TextInputStyle.Paragraph);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await i.showModal(modal);
                return;
            }
        }

        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            await i.reply({ content: `❌ Заявка отклонена.` });
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        // ==========================================
        // АУДИТ ПЛАНШЕТОВ
        // ==========================================
        if (i.isButton() && i.customId.startsWith("audit_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            
            if (action === "verify") {
                const cId = parts[2];
                const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                return i.reply({ content: isPresent ? "🟢 На сервере." : "🔴 Не на сервере.", ephemeral: true });
            }

            const recruiterId = parts[2];
            const candidateId = parts[3];

            if (action === "accept") {
                salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 10000;
                if (candidateId && candidateId !== "unknown") salary.recruits[candidateId] = recruiterId;
                saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.message.delete().catch(() => null);
                return i.reply({ content: "✅ Начислено $10,000.", ephemeral: true });
            }

            if (action === "reject") {
                await i.message.delete().catch(() => null);
                return i.reply({ content: "❌ Отклонено.", ephemeral: true });
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
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
