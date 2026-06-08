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
            CATEGORY: "1513659194832719962",       // НОВАЯ Категория для заявок в семью
            REPORT_CATEGORY: "1458410646956806196", // Категория для тикетов отчетов
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076",
            SBOR: "1458481307351781709",
            PROMO_PANEL: "1513649382396919979",     // Канал с панелью для отчетов
            PROMO_NOTIFY: "1513660056338436206",    // Канал уведомлений о повышениях
            AFK_CHANNEL: "1500519252518768792"      // Канал AFK панели
        },
        ALLOWED_ROLES: [ // Роли, имеющие доступ к управлению (в т.ч. отчетами)
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
            { id: "1458485405769797848", name: "Academy" }, // Обновлено
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
const DB_FILE = path.join(__dirname, "db.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.reports) data.reports = {}; // Статистика принятых отчетов { userId: count }
        if (!data.afk) data.afk = []; // Массив ID пользователей в AFK
        if (!data.memberInfo) data.memberInfo = {}; // { userId: { acceptedBy, timestamp, appEmbed } }
        return data;
    } catch {
        return { balances: {}, recruits: {}, reports: {}, afk: [], memberInfo: {} };
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
// AFK PANEL UPDATER
// =====================================================
async function updateAfkPanel(guildId) {
    try {
        const config = SERVERS[guildId];
        if (!config || !config.CHANNELS.AFK_CHANNEL) return;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.CHANNELS.AFK_CHANNEL).catch(() => null);
        if (!channel) return;

        let afkList = db.afk.map(id => `• <@${id}>`).join("\n");
        if (db.afk.length === 0) afkList = "*В данный момент никто не находится в AFK.*";

        const embed = new EmbedBuilder()
            .setTitle("💤 Панель AFK")
            .setDescription(`**Список пользователей, находящихся в AFK:**\n\n${afkList}\n\n*Пользователи из этого списка не будут получать уведомления о массовых сборах в ЛС. Нажмите кнопку ниже, чтобы изменить свой статус.*`)
            .setColor("#2b2d31")
            .setImage("https://media.discordapp.net/attachments/1118182559092822157/1169335805563600986/line.gif")
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`afk_toggle`)
                .setLabel("Встать / Выйти из AFK")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🌙")
        );

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💤 Панель AFK")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed], components: [row] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
        }
    } catch (error) {
        console.error(`[AFK PANEL ERROR]`, error);
    }
}


// =====================================================
// SALARY & MONITORING SYSTEMS
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

            if (botMessage) await botMessage.edit({ embeds: embedsArray }).catch(() => null);
            else await channel.send({ embeds: embedsArray }).catch(() => null);
        }
    } catch (error) {
        console.error(`[MONITOR ERROR] [${INSTANCE_ID}]`, error);
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
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику своих отчетов и текущий прогресс"),
        new SlashCommandBuilder().setName("promo_panel").setDescription("Отправить панель системы повышений"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить панель AFK системы"),
        new SlashCommandBuilder()
            .setName("info")
            .setDescription("Посмотреть информацию об игроке")
            .addUserOption(option => 
                option.setName("user")
                .setDescription("Укажите пользователя")
                .setRequired(true)
            )
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Обновление слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            await updateAfkPanel(guildId); // Обновляем панель AFK при запуске
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] [${INSTANCE_ID}]`, e);
    }

    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);
});


// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        let needsSave = false;

        // Зарплаты рекрутеров
        if (db.recruits && db.recruits[member.id]) {
            const recruiterId = db.recruits[member.id];
            if (db.balances[recruiterId]) {
                db.balances[recruiterId] -= 10000;
                if (db.balances[recruiterId] < 0) db.balances[recruiterId] = 0;
            }
            delete db.recruits[member.id];
            needsSave = true;
            await updateSalaryEmbed(member.guild);
        }

        // Авто-выход из AFK
        if (db.afk.includes(member.id)) {
            db.afk = db.afk.filter(id => id !== member.id);
            needsSave = true;
            await updateAfkPanel(member.guild.id);
        }

        if (needsSave) saveDB(db);

    } catch (e) {
        console.error("[ERROR AT MEMBER REMOVE]", e);
    }
});


// =====================================================
// INTERACTIONS & COMMANDS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        // СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            
            if (i.commandName === "rank") {
                const count = db.reports[i.user.id] || 0;
                const embed = new EmbedBuilder()
                    .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL({ dynamic: true }) })
                    .setTitle("📊 Статистика повышений")
                    .setDescription(`Вы подали и администрация одобрила: **${count}** отчетов.\n\nПродолжайте проявлять актив, чтобы достичь новых высот в семье!`)
                    .setColor("#2b2d31")
                    .setThumbnail(i.guild.iconURL({ dynamic: true }))
                    .setTimestamp();

                await i.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const info = db.memberInfo[targetUser.id];
                
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Информация: ${targetUser.username}`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .setColor("#2b2d31")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                if (!info) {
                    embed.setDescription("По данному пользователю нет сохраненных данных о принятии в базу.");
                    await i.reply({ embeds: [embed], ephemeral: false });
                    return;
                }

                const dateStr = `<t:${Math.floor(info.timestamp / 1000)}:R>`;
                embed.addFields(
                    { name: "👤 Кто принял", value: `<@${info.acceptedBy}>`, inline: true },
                    { name: "📅 Время принятия", value: dateStr, inline: true }
                );

                const components = [];
                if (info.appEmbed) {
                    components.push(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`view_app_${targetUser.id}`)
                                .setLabel("Посмотреть анкету")
                                .setStyle(ButtonStyle.Primary)
                        )
                    );
                }

                await i.reply({ embeds: [embed], components: components.length > 0 ? components : [], ephemeral: false });
                return;
            }

            if (i.commandName === "promo_panel") {
                if (!config || !config.CHANNELS.PROMO_PANEL) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ Нет прав.", ephemeral: true });

                const channel = await client.channels.fetch(config.CHANNELS.PROMO_PANEL);
                
                const embed = new EmbedBuilder()
                    .setTitle("СИСТЕМА ПОВЫШЕНИЯ")
                    .setDescription(
`Отправляйте отчёты о проделанной работе для автоматического повышения в должности.

🔹 **С 1 ранга (TEST) > 2 ранг (Academy)**
• **5 МП** (отчетов)
• Фамилия Darkness
• Знание правил семьи/сервера
• Актив в игре больше 3 часов в день

🔹 **С 2 ранга (Academy) > 3 ранг (Young)**
• **10 МП** суммарно
• Уметь слушать коллы и адекватная игра
• Отсутствие серьёзных нарушений, варнов, жалоб со стороны софракцевцев, софамцев

🔹 **С 3 ранга (Young) > 4 ранг (Darkness)**
• **20 МП** суммарно
• Стабильный онлайн (больше 100 часов в игре)
• Помощь семье, хорошая коммуникация

🔹 **С 4 ранга (Darkness) > 5 ранг (Recruit)**
• Уметь грамотно общаться, адекватность
• Стабильный онлайн (3+ часа в день)
• Иметь ответственность

━━━━━━━━━━━━━━

⚠️ **ПРАВИЛА ПОДАЧИ ОТЧЕТА:**
1. В поле "Статик" вводите **строго только цифры**.
2. В поле "Доказательства" должна быть рабочая **ссылка** (Imgur / YouTube и т.д.).
3. **Без скриншота/отката отчёт будет моментально отклонён!**

Вы можете проверить свою статистику командой: \`/rank\``
                    )
                    .setColor("#2b2d31")
                    .setImage("https://media.discordapp.net/attachments/1118182559092822157/1169335805563600986/line.gif");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("report_open")
                        .setLabel("Подать отчет")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("📄")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель повышений отправлена.", ephemeral: true });
                return;
            }

            if (i.commandName === "afk_panel") {
                if (!config || !config.CHANNELS.AFK_CHANNEL) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ Нет прав.", ephemeral: true });

                await updateAfkPanel(i.guild.id);
                await i.reply({ content: "✅ Панель AFK обновлена/отправлена.", ephemeral: true });
                return;
            }

            if (i.commandName === "balance") {
                const currentBal = db.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, ephemeral: true });
                return;
            }

            if (i.commandName === "delete") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                db.balances = {};
                db.recruits = {};
                saveDB(db);
                await updateSalaryEmbed(i.guild);

                await i.reply({ content: "✅ Балансы аннулированы!", ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription("Нажмите на кнопку ниже, чтобы подать заявку в нашу семью.\n\n⏳ **Время рассмотрения заявки:** от 1 до 4 дней.\n\n### 🎬 RP-Content состав ###\n• Возможность дальнейшего развития в семье\n• Откаты стрельбы — **не требуются**\n\n### 🔥 Main состав ###\n• Требуются откаты стрельбы от **5 минут GG**\nили\n• Откаты с любой МП/капта/массового мероприятия\n\n━━━━━━━━━━━━━━\n\n### ⚠️ Важно ознакомиться перед подачей заявки ###\n\n• Заявки, оформленные без соблюдения правил (без откатов и т.д.), отклоняются моментально.\n• Мы не принимаем детей, фриков и неадекватных людей.\n• Заявки рассматриваются строго в порядке очереди. Не нужно флудить или торопить администрацию.\n• У нас нет отдельных местах только под капты или MCL — вы вступаете в тему и участвуете во всём контенте.\n• Если заявка была отклонена — это окончательное решение.\n• КД на повторную подачу заявки — **2 дня**.\n\n**📌 Перед подачей заявки убедитесь, что ваш Discord открыт для связи.**")
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
                if (!channel) return await i.reply({ content: "❌ Канал 'групп' не найден.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("📡 Управление сборами групп")
                    .setDescription("**Функционал:**\n• Выбор типа мероприятия\n• Ручная панель с кнопками отправки в канал и ЛС\n\n**Darkness & Ballas Central Control**")
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
        // VIEW APP BUTTON (Из команды /info)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("view_app_")) {
            const targetId = i.customId.replace("view_app_", "");
            const info = db.memberInfo[targetId];
            if (info && info.appEmbed) {
                await i.reply({ embeds: [info.appEmbed], ephemeral: true });
            } else {
                await i.reply({ content: "❌ Анкета не найдена или была удалена.", ephemeral: true });
            }
            return;
        }

        // =====================================================
        // AFK SYSTEM BUTTON
        // =====================================================
        if (i.isButton() && i.customId === "afk_toggle") {
            const userId = i.user.id;
            if (db.afk.includes(userId)) {
                db.afk = db.afk.filter(id => id !== userId);
                await i.reply({ content: "✅ Вы успешно вышли из AFK режима.", ephemeral: true });
            } else {
                db.afk.push(userId);
                await i.reply({ content: "💤 Вы перешли в режим AFK. Уведомления приостановлены.", ephemeral: true });
            }
            saveDB(db);
            await updateAfkPanel(i.guild.id);
            return;
        }

        // =====================================================
        // ОТЧЕТЫ: КНОПКА ОТКРЫТИЯ МОДАЛКИ
        // =====================================================
        if (i.isButton() && i.customId === "report_open") {
            const modal = new ModalBuilder()
                .setCustomId("report_modal")
                .setTitle("Подача отчета");

            const staticInput = new TextInputBuilder()
                .setCustomId("report_static")
                .setLabel("Статик игрового персонажа (только цифры)")
                .setPlaceholder("Например: 21074")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const evidenceInput = new TextInputBuilder()
                .setCustomId("report_evidence")
                .setLabel("Прикрепите доказательство (ссылка)")
                .setPlaceholder("https://imgur.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Paragraph);

            modal.addComponents(
                new ActionRowBuilder().addComponents(staticInput),
                new ActionRowBuilder().addComponents(evidenceInput)
            );

            await i.showModal(modal);
            return;
        }

        // ОТЧЕТЫ: ОБРАБОТКА МОДАЛКИ
        if (i.isModalSubmit() && i.customId === "report_modal") {
            const staticId = i.fields.getTextInputValue("report_static");
            const evidence = i.fields.getTextInputValue("report_evidence");

            if (!/^\d+$/.test(staticId)) {
                await i.reply({ content: "❌ Ошибка: В поле 'Статик' должны быть указаны **строго только цифры**.", ephemeral: true });
                return;
            }
            
            if (!evidence.includes("http://") && !evidence.includes("https://")) {
                await i.reply({ content: "❌ Ошибка: В поле 'Доказательства' должна быть указана рабочая ссылка.", ephemeral: true });
                return;
            }

            const expectedChannelName = `report-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === config.CHANNELS.REPORT_CATEGORY && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.reply({ content: `⚠️ У вас уже есть активный тикет с отчетом: <#${existingChannel.id}>`, ephemeral: true });
                return;
            }

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.REPORT_CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("📝 Отчет на повышение")
                .setColor("#2b2d31")
                .setDescription(`**Пользователь:** <@${i.user.id}>\n**Статик:** \`${staticId}\`\n\n**Доказательства:**\n${evidence}`)
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rep_acc_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`rep_rej_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            await channel.send({ content: `${rolesPing} Новый отчет!`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Отчет успешно создан! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        // ОТЧЕТЫ: ОБРАБОТКА КНОПОК ПРОВЕРКИ
        if (i.isButton() && i.customId.startsWith("rep_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав для проверки отчетов.", ephemeral: true });

            const parts = i.customId.split("_");
            const action = parts[1]; // acc or rej
            const targetId = parts[2];
            
            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "rej") {
                if (targetMember) {
                    await targetMember.send(`Привет! Твой отчет на сервере Darkness Famq был отклонен администратором <@${i.user.id}>.`).catch(() => null);
                }
                await i.channel.delete().catch(() => null);
                return;
            }

            if (action === "acc") {
                if (!db.reports[targetId]) db.reports[targetId] = 0;
                db.reports[targetId] += 1;
                saveDB(db);

                const currentCount = db.reports[targetId];
                await i.reply({ content: `✅ Отчет принят! Всего отчетов у игрока: **${currentCount}**. Тикет удалится через 3 сек.`, ephemeral: false });
                
                // Проверка на повышение
                if (targetMember && config.RANKS) {
                    let readyForPromo = false;
                    let nextRoleName = "";
                    let nextRoleId = "";
                    let oldRoleId = "";

                    if (targetMember.roles.cache.has(config.RANKS.TEST) && currentCount >= 5) {
                        nextRoleName = "Academy"; nextRoleId = config.RANKS.ACADEMY; oldRoleId = config.RANKS.TEST; readyForPromo = true;
                    } else if (targetMember.roles.cache.has(config.RANKS.ACADEMY) && currentCount >= 10) {
                        nextRoleName = "Young"; nextRoleId = config.RANKS.YOUNG; oldRoleId = config.RANKS.ACADEMY; readyForPromo = true;
                    } else if (targetMember.roles.cache.has(config.RANKS.YOUNG) && currentCount >= 20) {
                        nextRoleName = "Darkness"; nextRoleId = config.RANKS.DARKNESS; oldRoleId = config.RANKS.YOUNG; readyForPromo = true;
                    }

                    if (readyForPromo) {
                        const notifyChannel = await i.guild.channels.fetch(config.CHANNELS.PROMO_NOTIFY).catch(() => null);
                        if (notifyChannel) {
                            const promoEmbed = new EmbedBuilder()
                                .setTitle("📈 Заявка на автоматическое повышение")
                                .setDescription(`Игрок <@${targetId}> накопил нужное количество отчетов (**${currentCount}**) и готов к повышению!\n\n**Текущий ранг:** <@&${oldRoleId}>\n**Новый ранг:** <@&${nextRoleId}>`)
                                .setColor("Yellow")
                                .setTimestamp();

                            const promoRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`promo_acc_${targetId}_${nextRoleId}_${oldRoleId}`).setLabel("Повысить").setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`promo_rej_${targetId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                            );

                            const adminPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
                            await notifyChannel.send({ content: adminPing, embeds: [promoEmbed], components: [promoRow] });
                        }
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 3000);
                return;
            }
        }

        // ПОВЫШЕНИЯ: КНОПКИ В КАНАЛЕ УВЕДОМЛЕНИЙ
        if (i.isButton() && i.customId.startsWith("promo_")) {
            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "rej") {
                if (targetMember) {
                    await targetMember.send(`Привет! Твое повышение на сервере Darkness Famq было отклонено администратором <@${i.user.id}>.`).catch(() => null);
                }
                const em = EmbedBuilder.from(i.message.embeds[0]).setColor("Red").setTitle("🛑 Повышение отклонено");
                await i.update({ embeds: [em], components: [] });
                return;
            }

            if (action === "acc") {
                const nextRoleId = parts[3];
                const oldRoleId = parts[4];

                if (targetMember) {
                    await targetMember.roles.add(nextRoleId).catch(() => null);
                    await targetMember.roles.remove(oldRoleId).catch(() => null);
                }

                const em = EmbedBuilder.from(i.message.embeds[0]).setColor("Green").setTitle("✅ Игрок успешно повышен!");
                await i.update({ embeds: [em], components: [] });
                return;
            }
        }


        // =====================================================
        // ОБРАБОТКА СИСТЕМЫ СБОРОВ
        // =====================================================
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

            await i.reply({ content: "Выберите тип сбора:", components: [menu], ephemeral: true });
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
                .setLabel("Введите код (5 символов)")
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
                new ButtonBuilder().setCustomId("sbor_cancel").setLabel("Закрыть").setStyle(ButtonStyle.Danger).setEmoji("❌")
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

            const cfg = SERVERS[guildId];
            if (!cfg) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${cfg.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(cfg.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ Сообщение отправлено в канал!", ephemeral: true });
                } else {
                    await i.reply({ content: "❌ Канал сбора не найден.", ephemeral: true });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (AFK-игроки исключаются)...", ephemeral: true });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        cfg.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !db.afk.includes(m.id)
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


        // =====================================================
        // СИСТЕМА ЗАЯВОК (Анкеты)
        // =====================================================
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

            await i.reply({ content: `❌ Заявка отклонена. Причина зафиксирована.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID И НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ НАС?", placeholder: "Увидел на респе...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "Откаты", placeholder: "Ссылка на откат", style: TextInputStyle.Paragraph });
            }

            modal.addComponents(fields.map(f => new ActionRowBuilder().addComponents(
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
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);
            const existingChannel = i.guild.channels.cache.find(c => c.parentId === config.CHANNELS.CATEGORY && c.name === expectedChannelName);

            if (existingChannel) {
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true });
                return;
            }

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null
            };

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY, // ИСПОЛЬЗУЕТСЯ НОВАЯ КАТЕГОРИЯ
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const rolesPing = config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ");
            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID И НИК НЕЙМ**\n${data.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n${data.q2}\n\n**ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${data.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness?**\n${data.q4}`;
            
            if (type !== "academy") embedDescription += `\n\n**Откаты**\n${data.q5}`;
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

            await channel.send({ content: `${rolesPing}`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана: <#${channel.id}>`, ephemeral: true });
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
            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон: [Войти](${voiceUrl}) (<#${voiceChannelId}>).`);

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) {
                await targetMember.send(`🔔 Твоя заявка проверена. Подключись к голосовому каналу:\n${voiceUrl}`).catch(() => {});
            }
            await i.reply({ content: "✅ Ссылка отправлена!", ephemeral: true });
            return;
        }

        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            // КНОПКИ ЗАЯВОК (app_)
            if (parts[0] === "app") {
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ У вас нет прав.", ephemeral: true });

                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return await i.reply({ content: "❌ Пользователь вышел.", ephemeral: true });
                    
                    const isAcademy = i.channel.name.startsWith("academy");
                    const rolesToAdd = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    await targetMember.roles.add(rolesToAdd).catch(() => null);

                    await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false }).catch(() => null);
                    await i.channel.setName(`closed-${i.channel.name.replace("academy-", "").replace("capture-", "")}`).catch(() => null);

                    // Сохранение информации в команду /info
                    db.memberInfo[targetId] = {
                        acceptedBy: i.user.id,
                        timestamp: Date.now(),
                        appEmbed: embed.toJSON()
                    };
                    saveDB(db);

                    embed.setColor("Purple").setTitle("Заявление (Принято)");
                    await i.update({ embeds: [embed], components: [] });

                    await i.channel.send(`🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, отправьте скриншот с планшета.`);
                    return;
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });
                    await i.channel.send(`⏳ Заявка на рассмотрении у <@${i.user.id}>.`);
                    return;
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`call_voice_${targetId}`).setPlaceholder("Выберите голосовой канал").addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "Выберите войс:", components: [voiceMenu], ephemeral: true });
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

            // КНОПКИ АУДИТА (СКРИНЫ ПЛАНШЕТА)
            if (parts[0] === "audit") {
                const action = parts[1];
                if (action === "verify") {
                    const cId = parts[2];
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    await i.reply({ content: isPresent ? `🟢 <@${cId}> на сервере.` : `🔴 Не найден.`, ephemeral: true });
                    return;
                }

                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) return await i.reply({ content: "❌ Нет прав.", ephemeral: true });

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "❌ Отчёт отклонён.", ephemeral: true });
                    return;
                }

                if (action === "accept") {
                    db.balances[recruiterId] = (db.balances[recruiterId] || 0) + 10000;
                    if (candidateId && candidateId !== "unknown") db.recruits[candidateId] = recruiterId;
                    saveDB(db);
                    await updateSalaryEmbed(i.guild);

                    await i.message.delete().catch(() => null);
                    await i.reply({ content: "✅ Отчёт подтвержден!", ephemeral: true });
                    return;
                }
            }
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR] [${INSTANCE_ID}]`, e);
    }
});


// =====================================================
// MESSAGE SYSTEM (ОТПРАВКА СКРИНОВ С ПЛАНШЕТА В ЗАКРЫТЫЕ ТИКЕТЫ)
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;
        const config = SERVERS[msg.guild.id];
        if (!config) return;

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

            await msg.channel.send("✅ Отчёт перенаправлен в аудит! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

    } catch (e) {
        console.log(`[MESSAGE ERROR] [${INSTANCE_ID}]`, e);
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
