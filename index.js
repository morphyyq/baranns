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
            CATEGORY: "1458410646956806196", // Старая категория для других нужд
            APP_CATEGORY: "1513659194832719962", // Новая категория для заявок
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            REPORTS: "1513649382396919979", // Канал для отправки панели отчетов
            PROMOTION_NOTIFY: "1513660056338436206", // Канал уведомлений о повышении
            AFK: "1500519252518768792" // Канал АФК системы
        },
        ALLOWED_ROLES: [ // Руководство (могут принимать)
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
            DARKNESS: "1458485277495656553",
            RECRUIT: "1468704257606684712"
        },
        MONITOR_ROLES: [
            { id: "1468704257606684712", name: "Рекруты" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1458485405769797848", name: "Академия" }
        ],
        PING_ROLES: [ "1458410756453306490" ]
    },
    "1504470399268819115": {
        CHANNELS: { SBOR: "1504574610564321290" },
        PING_ROLES: [ "1504470450305241288", "1505558808766971944" ]
    }
};

// =====================================================
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "database.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.ranks) data.ranks = {};
        if (!data.afk) data.afk = {};
        if (!data.users_info) data.users_info = {};
        return data;
    } catch {
        return { balances: {}, recruits: {}, ranks: {}, afk: {}, users_info: {} };
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
// SYSTEMS
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

        if (!hasActiveBalances) listString = "*На этой неделе выплат пока нет.*";

        embed.addFields({ name: "💵 Текущие балансы рекрутов:", value: listString, inline: false });

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💰 Ведомость выплат")) : null;

        if (botMessage) await botMessage.edit({ embeds: [embed] }).catch(() => null);
        else await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (error) {
        console.error(`[SALARY EMBED ERROR]`, error);
    }
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
            let totalOnline = 0;
            let totalMembersCount = 0;

            const mainEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setTimestamp();

            let description = "";

            for (const roleData of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleData.id);
                if (!role) continue;

                let roleOnline = 0;
                const members = Array.from(role.members.values());

                members.forEach(member => {
                    totalMembersCount++;
                    const isOnline = member.presence && member.presence.status !== "offline";
                    if (isOnline) {
                        roleOnline++;
                        totalOnline++;
                    }
                });

                description += `**${roleData.name}**\n🟢 В сети: \`${roleOnline} / ${members.length}\`\n\n`;
            }

            mainEmbed.setDescription(description + `━━━━━━━━━━━━━━\n📈 **Общий онлайн:** \`${totalOnline} из ${totalMembersCount}\``);

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

            if (botMessage) await botMessage.edit({ embeds: [mainEmbed] }).catch(() => null);
            else await channel.send({ embeds: [mainEmbed] }).catch(() => null);
        }
    } catch (error) {
        console.error(`[MONITOR ERROR]`, error);
    }
}

async function updateAfkEmbed(guild) {
    try {
        const config = SERVERS[guild.id];
        if (!config || !config.CHANNELS.AFK) return;
        const channel = await guild.channels.fetch(config.CHANNELS.AFK).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("📋 Список АФК")
            .setColor("#2b2d31");

        let description = "";
        const afkUsers = Object.entries(db.afk);

        if (afkUsers.length === 0) {
            description = "*В данный момент никого нет в АФК.*";
        } else {
            for (const [userId, data] of afkUsers) {
                description += `<@${userId}> ✅:\n> встал в АФК: <t:${Math.floor(data.timestamp / 1000)}:R>\n> причина: ${data.reason}\n\n`;
            }
        }

        embed.setDescription(description);

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === "📋 Список АФК") : null;

        if (botMessage) await botMessage.edit({ embeds: [embed] }).catch(() => null);
        else await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) {
        console.error("[AFK EMBED ERROR]", e);
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
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику отчетов и ранг")
            .addUserOption(opt => opt.setName("user").setDescription("Пользователь").setRequired(false)),
        new SlashCommandBuilder().setName("info").setDescription("Посмотреть информацию о пользователе")
            .addUserOption(opt => opt.setName("user").setDescription("Пользователь").setRequired(true)),
        new SlashCommandBuilder().setName("promotion_panel").setDescription("Отправить панель системы повышений"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить панель управления АФК")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Регистрация слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
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
        let changed = false;

        // Зарплаты рекрутеров
        if (db.recruits && db.recruits[member.id]) {
            const recruiterId = db.recruits[member.id];
            if (db.balances[recruiterId]) {
                db.balances[recruiterId] -= 10000;
                if (db.balances[recruiterId] < 0) db.balances[recruiterId] = 0;
            }
            delete db.recruits[member.id];
            changed = true;
            await updateSalaryEmbed(member.guild);
        }

        // Удаление из АФК при выходе
        if (db.afk && db.afk[member.id]) {
            delete db.afk[member.id];
            changed = true;
            await updateAfkEmbed(member.guild);
        }

        if (changed) saveDB(db);
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

        // Аудит планшета
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
    } catch (e) {
        console.error(`[MESSAGE ERROR]`, e);
    }
});

// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // ------------------ СЛЭШ КОМАНДЫ ------------------
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                const currentBal = db.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "delete") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                db.balances = {}; db.recruits = {};
                saveDB(db);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "rank") {
                const target = i.options.getUser("user") || i.user;
                const targetMember = await i.guild.members.fetch(target.id).catch(() => null);
                if (!targetMember) return i.reply({ content: "❌ Пользователь не найден.", ephemeral: true });

                const reports = db.ranks[target.id] || 0;
                let currentRank = "Не состоит в системе повышений";
                let nextRank = "Максимальный ранг";
                let req = "MAX";

                if (config) {
                    if (targetMember.roles.cache.has(config.RANKS.TEST)) { currentRank = "1 ранг (TEST)"; nextRank = "2 ранг (Academy)"; req = 5; }
                    else if (targetMember.roles.cache.has(config.RANKS.ACADEMY)) { currentRank = "2 ранг (Academy)"; nextRank = "3 ранг (Young)"; req = 10; }
                    else if (targetMember.roles.cache.has(config.RANKS.YOUNG)) { currentRank = "3 ранг (Young)"; nextRank = "4 ранг (Darkness)"; req = 20; }
                    else if (targetMember.roles.cache.has(config.RANKS.DARKNESS)) { currentRank = "4 ранг (Darkness)"; }
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Статистика: ${target.username}`, iconURL: target.displayAvatarURL() })
                    .setColor("#2b2d31")
                    .addFields(
                        { name: "Текущий ранг:", value: `\`${currentRank}\``, inline: true },
                        { name: "Следующий ранг:", value: `\`${nextRank}\``, inline: true },
                        { name: "Принято отчетов:", value: `\`${reports} / ${req}\``, inline: false }
                    );

                await i.reply({ embeds: [embed] });
                return;
            }

            if (i.commandName === "info") {
                const target = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(target.id).catch(() => null);
                
                const info = db.users_info[target.id];
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Информация: ${target.username}`, iconURL: target.displayAvatarURL() })
                    .setColor("#2b2d31")
                    .setThumbnail(target.displayAvatarURL());

                if (targetMember) {
                    embed.addFields({ name: "На сервере с:", value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:D>`, inline: true });
                }

                if (info && info.recruiterId) {
                    embed.addFields({ name: "Принимал (тикет):", value: `<@${info.recruiterId}>`, inline: true });
                } else {
                    embed.addFields({ name: "Статус:", value: "Старый участник (данных об анкете нет)", inline: false });
                }

                const components = [];
                if (info && info.appData) {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`view_app_${target.id}`).setLabel("Посмотреть заявку").setStyle(ButtonStyle.Primary).setEmoji("📄")
                    );
                    components.push(row);
                }

                await i.reply({ embeds: [embed], components });
                return;
            }

            if (i.commandName === "afk_panel") {
                if (!config || !config.ALLOWED_ROLES.some(r => i.member.roles.cache.has(r))) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });
                
                const embed = new EmbedBuilder()
                    .setTitle("🛡️ Управление статусом АФК")
                    .setDescription("Используйте кнопки ниже, чтобы уведомить семью о вашем длительном отсутствии. \nПока вы в АФК, вы не будете получать рассылки в ЛС при сборах.")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("afk_enter").setLabel("Встать в АФК").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("afk_leave").setLabel("Выйти из АФК").setStyle(ButtonStyle.Danger)
                );

                await i.channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель АФК отправлена", ephemeral: true });
                return;
            }

            if (i.commandName === "promotion_panel") {
                if (!config || !config.ALLOWED_ROLES.some(r => i.member.roles.cache.has(r))) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("СИСТЕМА ПОВЫШЕНИЯ")
                    .setDescription(`📈 **Система повышений семьи Darkness**\nОтправляйте отчёты о проделанной работе для автоматического повышения в должности.\n\n` +
                    `🔹 **С 1 ранга (TEST) > 2 ранг (Academy)**\n- **5 МП** (отчетов)\n- Фамилия Darkness\n- Знание правил семьи/сервера\n- Актив в игре больше 3 часов в день\n\n` +
                    `🔹 **С 2 ранга (Academy) > 3 ранг (Young)**\n- **10 МП** суммарно\n- Уметь слушать коллы и адекватная игра\n- Отсутствие серьёзных нарушений\n\n` +
                    `🔹 **С 3 ранга (Young) > 4 ранг (Darkness)**\n- **20 МП** суммарно\n- Стабильный онлайн (больше 100 часов в игре)\n- Помощь семье, хорошая коммуникация\n\n` +
                    `🔹 **С 4 ранга (Darkness) > 5 ранг (Recruit)**\n- Уметь грамотно общаться, адекватность\n- Стабильный онлайн (3+ часа в день)\n\n━━━━━━━━━━━━━━\n\n` +
                    `⚠️ **ПРАВИЛА ПОДАЧИ ОТЧЕТА:**\n1. В поле "Статик" вводите **строго только цифры**.\n2. В поле "Доказательства" должна быть рабочая **ссылка** (Imgur / YouTube и т.д.).\n3. **Без скриншота/отката отчёт будет моментально отклонён!**\n\nВы можете проверить свою статистику командой: \`/rank\``)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("report_submit").setLabel("Подать отчет").setStyle(ButtonStyle.Success).setEmoji("📄")
                );

                await i.channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель повышений отправлена", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription(`Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.\n\n⏳ **Время рассмотрения заявки:** от 1 до 4 дней.\n\n### 🎬 RP-Content состав ###\n• Возможность дальнейшего развития в семье\n• Откаты стрельбы — **не требуются**\n\n### 🔥 Main состав ###\n• Требуются откаты стрельбы от **5 минут GG**\nили\n• Откаты с любой МП/капта/массового мероприятия\n\n━━━━━━━━━━━━━━\n\n### ⚠️ Важно ознакомиться перед подачей заявки ###\n\n• Заявки, оформленные без соблюдения правил (без откатов и т.д.), отклоняются моментально.\n• Мы не принимаем детей, фриков и неадекватных людей.\n• Заявки рассматриваются строго в порядке очереди. Не нужно флудить или торопить администрацию.\n• У нас нет отдельных местах только под капты или MCL — вы вступаете в тему и участвуете во всём контенте.\n• Если заявка была отклонена — это окончательное решение.\n• КД на повторную подачу заявки — **2 дня**.\n\n**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**`)
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
                if (!channel) return i.reply({ content: "❌ Канал 'групп' не найден.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("📡 Управление сборами групп")
                    .setDescription("Используйте кнопки ниже для запуска ручного управления сборами состава.\n\n**Функционал:**\n• Выбор типа мероприятия\n• Ручная панель с кнопками отправки в канал и ЛС\n\n**Darkness & Ballas Central Control**")
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

        // ------------------ КНОПКА: ПРОСМОТР АНКЕТЫ ------------------
        if (i.isButton() && i.customId.startsWith("view_app_")) {
            const targetId = i.customId.replace("view_app_", "");
            const data = db.users_info[targetId]?.appData;
            if (!data) return i.reply({ content: "❌ Данные анкеты не найдены.", ephemeral: true });

            let desc = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n${data.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n${data.q2}\n\n**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${data.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n${data.q4}`;
            if (data.q5) desc += `\n\n**Предоставьте свои откаты**\n${data.q5}`;

            const embed = new EmbedBuilder()
                .setTitle(`Анкета пользователя`)
                .setDescription(desc)
                .setColor("#2b2d31");
            await i.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // ------------------ АФК СИСТЕМА ------------------
        if (i.isButton() && i.customId === "afk_enter") {
            const modal = new ModalBuilder()
                .setCustomId("afk_modal")
                .setTitle("Встать в АФК");

            const reasonInput = new TextInputBuilder()
                .setCustomId("afk_reason")
                .setLabel("Укажите причину (коротко):")
                .setPlaceholder("Уехал к бабушке на месяц / Отдыхаю от сампа")
                .setRequired(true)
                .setMaxLength(100)
                .setStyle(TextInputStyle.Short);

            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "afk_modal") {
            const reason = i.fields.getTextInputValue("afk_reason");
            db.afk[i.user.id] = {
                timestamp: Date.now(),
                reason: reason
            };
            saveDB(db);
            await updateAfkEmbed(i.guild);
            await i.reply({ content: "✅ Вы успешно встали в АФК.", ephemeral: true });
            return;
        }

        if (i.isButton() && i.customId === "afk_leave") {
            if (db.afk[i.user.id]) {
                delete db.afk[i.user.id];
                saveDB(db);
                await updateAfkEmbed(i.guild);
                await i.reply({ content: "✅ Вы успешно вышли из АФК. С возвращением!", ephemeral: true });
            } else {
                await i.reply({ content: "❌ Вы не находитесь в списке АФК.", ephemeral: true });
            }
            return;
        }

        // ------------------ СИСТЕМА ОТЧЕТОВ И ПОВЫШЕНИЙ ------------------
        if (i.isButton() && i.customId === "report_submit") {
            const modal = new ModalBuilder()
                .setCustomId("report_modal")
                .setTitle("Подача отчета");

            const staticInput = new TextInputBuilder()
                .setCustomId("rep_static")
                .setLabel("Введите ваш статик (ТОЛЬКО ЦИФРЫ)")
                .setPlaceholder("Например: 21074")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const proofInput = new TextInputBuilder()
                .setCustomId("rep_proof")
                .setLabel("Ссылка на доказательства")
                .setPlaceholder("https://imgur.com/... или https://youtube.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Paragraph);

            modal.addComponents(
                new ActionRowBuilder().addComponents(staticInput),
                new ActionRowBuilder().addComponents(proofInput)
            );
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "report_modal") {
            const staticVal = i.fields.getTextInputValue("rep_static");
            const proofVal = i.fields.getTextInputValue("rep_proof");

            if (!/^\d+$/.test(staticVal)) {
                return i.reply({ content: "❌ Ошибка: В поле 'Статик' должны быть только цифры!", ephemeral: true });
            }
            if (!proofVal.includes("http")) {
                return i.reply({ content: "❌ Ошибка: В поле 'Доказательства' должна быть корректная ссылка!", ephemeral: true });
            }

            const channelName = `report-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const channel = await i.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.APP_CATEGORY, // Используем ту же категорию, или можно другую
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("Новый отчет на повышение")
                .setDescription(`**Пользователь:** <@${i.user.id}>\n**Статик:** \`${staticVal}\`\n\n**Доказательства:**\n${proofVal}`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rep_accept_${i.user.id}`).setLabel("Принять отчет").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rep_reject_${i.user.id}`).setLabel("Отказать отчет").setStyle(ButtonStyle.Danger)
            );

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            await channel.send({ content: rolesPing, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Отчет успешно создан! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        // Кнопки в тикете отчета
        if (i.isButton() && i.customId.startsWith("rep_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

            const action = i.customId.split("_")[1];
            const targetId = i.customId.split("_")[2];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                await i.channel.delete().catch(() => null);
                if (targetMember) {
                    await targetMember.send("❌ Ваш отчет на повышение был отклонен администрацией. Проверьте правильность доказательств и попробуйте снова.").catch(() => null);
                }
                return;
            }

            if (action === "accept") {
                if (!db.ranks[targetId]) db.ranks[targetId] = 0;
                db.ranks[targetId] += 1;
                const total = db.ranks[targetId];
                saveDB(db);

                await i.reply({ content: `✅ Отчет принят! У пользователя теперь \`${total}\` отчетов. Тикет закрывается...` });
                
                // Проверка на повышение
                if (targetMember) {
                    let shouldPromoteTo = null;
                    if (targetMember.roles.cache.has(config.RANKS.TEST) && total >= 5) shouldPromoteTo = "ACADEMY";
                    else if (targetMember.roles.cache.has(config.RANKS.ACADEMY) && total >= 10) shouldPromoteTo = "YOUNG";
                    else if (targetMember.roles.cache.has(config.RANKS.YOUNG) && total >= 20) shouldPromoteTo = "DARKNESS";

                    if (shouldPromoteTo) {
                        const notifyChannel = await i.guild.channels.fetch(config.CHANNELS.PROMOTION_NOTIFY).catch(() => null);
                        if (notifyChannel) {
                            const notifEmbed = new EmbedBuilder()
                                .setTitle("🔔 Запрос на повышение")
                                .setDescription(`Пользователь <@${targetId}> набрал необходимое количество отчетов (\`${total}\`).\n\nТребуется повышение на ранг: **${shouldPromoteTo}**`)
                                .setColor("Yellow");

                            const notifRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`promo_accept_${targetId}_${shouldPromoteTo}`).setLabel("Повысить").setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`promo_reject_${targetId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                            );
                            await notifyChannel.send({ embeds: [notifEmbed], components: [notifRow] });
                        }
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }
        }

        // Кнопки в канале уведомлений (повышение)
        if (i.isButton() && i.customId.startsWith("promo_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];
            const rankKey = parts[3];
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                await i.message.delete().catch(() => null);
                if (targetMember) await targetMember.send("❌ Руководство отказало вам в повышении, несмотря на количество отчетов. Обратитесь к старшему составу.").catch(() => null);
                return;
            }

            if (action === "accept" && targetMember) {
                let removeRole = null;
                let addRole = config.RANKS[rankKey];

                if (rankKey === "ACADEMY") removeRole = config.RANKS.TEST;
                if (rankKey === "YOUNG") removeRole = config.RANKS.ACADEMY;
                if (rankKey === "DARKNESS") removeRole = config.RANKS.YOUNG;

                if (removeRole) await targetMember.roles.remove(removeRole).catch(() => null);
                if (addRole) await targetMember.roles.add(addRole).catch(() => null);

                await i.message.delete().catch(() => null);
                await i.channel.send(`✅ Пользователь <@${targetId}> успешно повышен до ранга **${rankKey}** администратором <@${i.user.id}>.`);
                if (targetMember) await targetMember.send(`🎉 Поздравляем! Ваша работа оценена, вы повышены до ранга **${rankKey}**!`).catch(() => null);
                return;
            }
        }

        // ------------------ СБОРЫ ГРУПП ------------------
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
                .setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код группы:** \`${code}\`\n\nИспользуйте кнопки ниже для рассылки.`)
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
                await i.update({ content: "✅ Панель закрыта.", embeds: [], components: [] });
                return;
            }

            const parts = i.customId.split("_");
            const action = parts[1];
            const guildId = parts[2];
            const activity = parts[3];
            const code = parts[4];

            const tConfig = SERVERS[guildId];
            if (!tConfig) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${tConfig.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(tConfig.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ Отправлено в канал!", ephemeral: true });
                } else {
                    await i.reply({ content: "❌ Канал сбора не найден.", ephemeral: true });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку (игнорирую тех, кто в АФК)...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        tConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !db.afk[m.id]
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
                    await i.editReply({ content: "❌ Ошибка при рассылке." });
                }
            }
            return;
        }

        // ------------------ ЗАЯВКИ (APPLY) И АУДИТ ------------------
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");
            const logChannelId = "1464576279771873353";
            const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);

            if (logChannel) {
                const rejectEmbed = new EmbedBuilder()
                    .setTitle("❌ Отказ по заявке в семью")
                    .setDescription(`👤 **Кандидат:** <@${targetId}> (\`${targetId}\`)\n🔒 **Модератор:** <@${i.user.id}>\n📝 **Причина отказа:** ${reason}`)
                    .setColor("Red").setTimestamp();
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
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID И НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness?", placeholder: "Увидел на респе / контент...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат", style: TextInputStyle.Paragraph });
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

            await i.guild.channels.fetch().catch(() => null);
            const existingChannel = i.guild.channels.cache.find(c => c.parentId === config.CHANNELS.APP_CATEGORY && c.name === expectedChannelName);

            if (existingChannel) {
                return i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
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
                parent: config.CHANNELS.APP_CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n${data.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n${data.q2}\n\n**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${data.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n${data.q4}`;
            if (type !== "academy") embedDescription += `\n\n**Предоставьте свои откаты**\n${data.q5}`;
            embedDescription += `\n\n**Пользователь**\n<@${i.user.id}>`;

            const embed = new EmbedBuilder()
                .setTitle("Заявление")
                .setDescription(embedDescription)
                .setColor("#1f8b4c")
                .addFields({ name: "Username", value: i.user.username, inline: true }, { name: "ID", value: i.user.id, inline: true });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_review_${i.user.id}`).setLabel("На рассмотрение").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("На обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: rolesPing, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];
            const messages = await i.channel.messages.fetch({ limit: 20 });
            const appMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));

            if (appMessage) {
                const embed = EmbedBuilder.from(appMessage.embeds[0]).setColor("Orange").setTitle("Заявление (Вызов на обзвон)");
                await appMessage.edit({ embeds: [embed] });
            }

            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;
            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон <@${i.user.id}>!\nГолосовой канал: [Войти](${voiceUrl}) (<#${voiceChannelId}>).`);
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) await targetMember.send(`🔔 Тебя вызвали на обзвон! Ссылка: ${voiceUrl}`).catch(() => null);
            await i.reply({ content: "✅ Ссылка отправлена!", ephemeral: true });
            return;
        }

        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            if (parts[0] === "audit") {
                const action = parts[1];
                if (action === "verify") {
                    const cId = parts[2];
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    await i.reply({ content: isPresent ? `🟢 <@${cId}> на сервере.` : `🔴 ID \`${cId}\` не найден.`, ephemeral: true });
                    return;
                }

                if (!config.ALLOWED_ROLES.some(r => member.roles.cache.has(r))) return i.reply({ content: "❌ Нет прав.", ephemeral: true });

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "❌ Отчёт планшета отклонён.", ephemeral: true });
                }

                if (action === "accept") {
                    db.balances[recruiterId] = (db.balances[recruiterId] || 0) + 10000;
                    if (candidateId && candidateId !== "unknown") db.recruits[candidateId] = recruiterId;
                    saveDB(db);
                    await updateSalaryEmbed(i.guild);
                    await i.message.delete().catch(() => null);
                    return i.reply({ content: "✅ Отчёт подтвержден! $10,000 начислено.", ephemeral: true });
                }
            }

            if (parts[0] === "app") {
                if (!config.ALLOWED_ROLES.some(r => member.roles.cache.has(r))) return i.reply({ content: "❌ Нет прав.", ephemeral: true });
                
                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Пользователь вышел.", ephemeral: true });
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    await targetMember.roles.add(rolesToAdd).catch(() => null);

                    await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false }).catch(() => null);
                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    // Сохраняем информацию о принятии в БД
                    const appData = applications.get(targetId) || { q1: embed.data.description.split("**")[2].trim() };
                    db.users_info[targetId] = {
                        recruiterId: i.user.id,
                        joinDate: Date.now(),
                        appData: appData
                    };
                    saveDB(db);

                    await i.channel.send(`🎉 <@${targetId}> принят!\n\n💼 <@${i.user.id}>, отправьте скриншот с планшета для фиксации.`);
                    return;
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`⏳ Администратор <@${i.user.id}> взял заявку.`);
                    return;
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`call_voice_${targetId}`).setPlaceholder("Выберите голосовой канал").addChannelTypes(ChannelType.GuildVoice)
                    );
                    return i.reply({ content: "⬇️ Выберите войс-канал:", components: [voiceMenu], ephemeral: true });
                }

                if (action === "reject") {
                    const modal = new ModalBuilder().setCustomId(`app_reject_modal_${targetId}`).setTitle("Причина отказа");
                    const reasonInput = new TextInputBuilder().setCustomId("reject_reason_input").setLabel("Причина:").setPlaceholder("Неподходящие откаты").setRequired(true).setStyle(TextInputStyle.Paragraph);
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
    console.log(`[BOT] [${INSTANCE_ID}] Выключение...`);
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =====================================================
// LOGIN
// =====================================================
client.login(process.env.TOKEN);
