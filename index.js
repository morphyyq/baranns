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
// CLIENT (Добавлен GuildPresences для отслеживания статусов сети)
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
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076", // Канал для постоянного мониторинга онлайна
            SBOR: "1458481307351781709", // Канал сбора Darkness
            REJECT_LOG: "1464576279771873353" // Канал логов отказов заявок
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
        // Роли для вывода в таблице мониторинга
        MONITOR_ROLES: [
            { id: "1468704257606684712", name: "Рекруты" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1507798049416675531", name: "RP Состав" }
        ],
        PING_ROLES: [ // Роли для пинга при сборе
            "1458410756453306490"
        ]
    },
    // НОВЫЙ СЕРВЕР BALLAS
    "1504470399268819115": {
        CHANNELS: {
            SBOR: "1504574610564321290" // Канал сбора Ballas
        },
        PING_ROLES: [ // Роли баллас
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
        const raw = fs.readFileSync(DB_FILE, "utf8");
        let data = JSON.parse(raw);
        // Адаптация структуры бд под расширенные нужды
        if (!data.balances) {
            if (Object.keys(data).length > 0 && !data.candidates) {
                return { balances: data, candidates: {}, lastReset: "" };
            }
            return { balances: {}, candidates: {}, lastReset: "" };
        }
        return data;
    } catch {
        return { balances: {}, candidates: {}, lastReset: "" };
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
// СБРОС ЗАРПЛАТЫ КАЖДЫЙ ПОНЕДЕЛЬНИК
// =====================================================
function checkMondayReset(guild) {
    const now = new Date();
    const day = now.getDay();
    // Находим дату текущего понедельника недели
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mondayString = new Date(now.setDate(diff)).toDateString();

    if (salary.lastReset !== mondayString) {
        salary.balances = {};
        salary.candidates = {}; // Очищаем связь кандидатов за новую неделю
        salary.lastReset = mondayString;
        saveDB(salary);
        if (guild) updateSalaryEmbed(guild);
        console.log(`[SYSTEM] [${INSTANCE_ID}] Балансы зарплаты успешно сброшены для недели: ${mondayString}`);
    }
}


// =====================================================
// ОБНОВЛЕНИЕ ЕДИНОГО СООБЩЕНИЯ ЗАРПЛАТЫ
// =====================================================
async function updateSalaryEmbed(guild) {
    const config = SERVERS[guild.id];
    if (!config || !config.CHANNELS || !config.CHANNELS.SALARY) return;

    const channel = await guild.channels.fetch(config.CHANNELS.SALARY).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle("💰 Отчёты и Недельный баланс Рекрутов")
        .setDescription("Список рекрутов, чьи отчёты по принятым кандидатам были одобрены администрацией.")
        .setColor("#2b2d31")
        .setTimestamp();

    let listString = "";
    const entries = Object.entries(salary.balances);

    if (entries.length === 0) {
        listString = "*На этой неделе принятых отчётов ещё нет.*";
    } else {
        for (const [userId, balance] of entries) {
            if (balance > 0) {
                listString += `• <@${userId}> — Баланс: **${balance}** рублей\n`;
            }
        }
        if (!listString) listString = "*На этой неделе принятых отчётов ещё нет.*";
    }

    embed.addFields({ name: "📊 Текущие начисления состава", value: listString });

    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💰 Отчёты")) : null;

    if (botMessage) {
        await botMessage.edit({ embeds: [embed] }).catch(() => null);
    } else {
        await channel.send({ embeds: [embed] }).catch(() => null);
    }
}


// =====================================================
// MONITORING SYSTEM (Раздельные Эмбеды для ролей)
// =====================================================
async function updateOnlineMonitor() {
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS || !config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            // Вызываем автоматическую проверку дня недели на сброс балансов
            checkMondayReset(guild);

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) continue;

            await guild.members.fetch();

            let totalOnline = 0;
            let totalMembersCount = 0;
            const embedsArray = [];

            // Сначала считаем общий онлайн по всем отслеживаемым ролям
            for (const roleData of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleData.id);
                if (!role) continue;
                role.members.forEach(member => {
                    totalMembersCount++;
                    const isOnline = member.presence && member.presence.status !== "offline";
                    if (isOnline) totalOnline++;
                });
            }

            // Главный эмбед со статистикой
            const mainEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``)
                .setColor("#2b2d31")
                .setTimestamp();
            
            embedsArray.push(mainEmbed);

            // Создаем РАЗДЕЛЬНЫЕ эмбеды под каждую роль, чтобы они шли отдельными карточками
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
                        const isOnline = member.presence && member.presence.status !== "offline";
                        const statusEmoji = isOnline ? "🟢" : "🔴";
                        if (isOnline) roleOnline++;
                        listString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                const roleEmbed = new EmbedBuilder()
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`)
                    .setDescription(listString)
                    .setColor("#2b2d31");

                embedsArray.push(roleEmbed);
            }

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
// СИСТЕМА ОПОВЕЩЕНИЯ (МАССОВЫЙ СБОР)
// =====================================================
async function startMassNotification(guildId, activity, groupCode) {
    const config = SERVERS[guildId];
    if (!config) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(config.CHANNELS.SBOR).catch(() => null);
    if (!channel) return;

    const pingString = `@everyone ${config.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
    const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${groupCode} ##`;

    let cycles = 0;
    
    const executeSpam = async () => {
        cycles++;
        
        try {
            for (let i = 0; i < 3; i++) {
                await channel.send(messageContent).catch(() => null);
            }
        } catch (e) {
            console.error("Ошибка отправки сбора в канал:", e);
        }

        try {
            await guild.members.fetch();
            const targetMembers = guild.members.cache.filter(m => 
                config.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot
            );

            for (const [id, member] of targetMembers) {
                await member.send(`🔔 **Внимание!**\n${messageContent}`).catch(() => null);
            }
        } catch (e) {
            console.error("Ошибка рассылки в ЛС:", e);
        }

        if (cycles >= 3) {
            clearInterval(spamInterval);
        }
    };

    executeSpam();
    const spamInterval = setInterval(executeSpam, 300000);
}


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить панель управления сборами")
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
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        if (msg.content === "/balance") {
            return msg.reply({
                content: `💰 Баланс: ${salary.balances[msg.author.id] || 0}`
            });
        }

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ (ОТЧЕТ ПЛАНШЕТА)
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 });
            const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));
            
            let candidateId = null;
            if (appMessage) {
                const description = appMessage.embeds[0].description || "";
                const userMatch = description.match(/<@(\d+)>/);
                if (userMatch) candidateId = userMatch[1];
            }

            const candidateText = candidateId ? `<@${candidateId}>` : "Не удалось определить";

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                // Имя файла без спецсимволов для предотвращения дефектов отображения дубликатов
                const file = new AttachmentBuilder(att.url, { name: `report_${Date.now()}.png` });
                
                const auditEmbed = new EmbedBuilder()
                    .setTitle("📋 Отчёт по принятой заявке")
                    .setDescription(`👤 **Администратор/Рекрут:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                    .setImage(`attachment://${file.name}`)
                    .setColor("Purple")
                    .setTimestamp();

                // Три кнопки: Принять, Отказать, Проверить
                const auditRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`audit_accept_${msg.author.id}_${candidateId || "unknown"}`)
                        .setLabel("Принять")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`audit_reject_${msg.author.id}`)
                        .setLabel("Отказать")
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`audit_check_${candidateId || "unknown"}`)
                        .setLabel("Проверить")
                        .setStyle(ButtonStyle.Primary)
                );

                await auditChannel.send({ embeds: [auditEmbed], files: [file], components: [auditRow] });
            }

            await msg.channel.send("✅ Отчёт успешно передан на проверку администрации в аудит! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
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

            const file = new AttachmentBuilder(att.url, { name: `screen_${Date.now()}.png` });

            const embed = new EmbedBuilder()
                .setTitle("📸 Новый отчёт")
                .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
                .setImage(`attachment://${file.name}`)
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
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;

        // СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            const config = SERVERS[i.guild.id];
            
            if (i.commandName === "balance") {
                await i.reply({ content: `💰 Баланс: ${salary.balances[i.user.id] || 0}`, ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
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
                        "Используйте кнопки ниже для запуска массового оповещения состава.\n\n" +
                        "**Функционал:**\n" +
                        "• 3 сообщения в канал сбора\n" +
                        "• 3 рассылки в ЛС (раз в 5 минут)\n" +
                        "• Упоминание всех причастных ролей\n\n" +
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
        }

        // =====================================================
        // ОБРАБОТКА СИСТЕМЫ СБОРОВ
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

            await i.reply({ 
                content: `✅ Запущено оповещение для **${faction}** на **${activity}**. Код группы: **${code}**.\n\nБот отправит по 3 сообщения в канал и 1 в ЛС сейчас, а также повторит это через 5 и 10 минут.`, 
                ephemeral: true 
            });
            
            startMassNotification(guildId, activity, code);
            return;
        }


        // =====================================================
        // МОДАЛКА ПРИЧИНЫ ОТКАЗА ДЛЯ ЗАЯВКИ
        // =====================================================
        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");
            
            const config = SERVERS[i.guild.id];
            const logChannelId = config?.CHANNELS?.REJECT_LOG || "1464576279771873353";
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("❌ Отказ по заявке в семью")
                    .setDescription(`👤 **Кандидат:** <@${targetId}>\n👤 **Проверил рекрут:** <@${i.user.id}>\n📄 **Причина отказа:** ${reason}`)
                    .setColor("Red")
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            await i.reply({ content: `❌ Заявка успешно отклонена. Причина зафиксирована в логи. Тикет удаляется...` });
            setTimeout(() => i.channel.delete().catch(() => null), 15000);
            return;
        }


        // =====================================================
        // ОБРАБОТКА КНОПОК ИЗ АУДИТА (ВЕРИФИКАЦИЯ ОТЧЕТОВ)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("audit_")) {
            const parts = i.customId.split("_");
            const action = parts[1]; // accept, reject, check

            if (action === "check") {
                const targetId = parts[2];
                if (targetId === "unknown") {
                    return i.reply({ content: "❌ Не удалось определить ID кандидата из отчёта для проверки.", ephemeral: true });
                }
                const member = await i.guild.members.fetch(targetId).catch(() => null);
                if (member) {
                    return i.reply({ content: `🟢 Проверка: Пользователь <@${targetId}> (${member.user.tag}) **находится** на сервере.`, ephemeral: true });
                } else {
                    return i.reply({ content: `🔴 Проверка: Пользователь с ID \`${targetId}\` **не найден** на сервере (вышел).`, ephemeral: true });
                }
            }

            const config = SERVERS[i.guild.id];
            const member = await i.guild.members.fetch(i.user.id);
            const hasPermission = config && config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для управления отчётами в аудите.", ephemeral: true });
            }

            if (action === "reject") {
                await i.message.delete().catch(() => null);
                return i.reply({ content: "❌ Отчёт успешно отклонён. Сообщение удалено из аудита.", ephemeral: true });
            }

            if (action === "accept") {
                const recruiterId = parts[2];
                const candidateId = parts[3];

                salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 10000; // Начисляем 10к за человека
                
                if (candidateId && candidateId !== "unknown") {
                    salary.candidates[candidateId] = recruiterId; // Записываем кто кого пригласил для трекинга ливов
                }
                
                saveDB(salary);
                await updateSalaryEmbed(i.guild);

                await i.message.delete().catch(() => null); // Удаляем скриншот из аудита
                return i.reply({ content: "✅ Отчёт одобрен! Зарплата рекруту начислена, таблица обновлена.", ephemeral: true });
            }
        }


        // =====================================================
        // СИСТЕМА ЗАЯВОК И ОСТАЛЬНОЕ
        // =====================================================
        const config = SERVERS[i.guild.id];
        if (!config) return;

        // МЕНЮ ВЫБОРА (ОТКРЫТИЕ МОДАЛКИ)
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

        // ОТПРАВКА МОДАЛКИ И СОЗДАНИЕ ТИКЕТА
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            console.log(`[LOG] [${INSTANCE_ID}] Пользователь ${i.user.tag} отправил модалку.`);

            if (modalLocks.has(i.user.id)) {
                console.log(`[LOG] [${INSTANCE_ID}] Сработал замок! Отклоняю дубликат запроса.`);
                return;
            }
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            console.log(`[LOG] [${INSTANCE_ID}] Проверяю наличие канала ${expectedChannelName}...`);
            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === config.CHANNELS.CATEGORY && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                console.log(`[LOG] [${INSTANCE_ID}] Канал уже существует, отменяю создание.`);
                await i.reply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>`, ephemeral: true }).catch(() => null);
                return;
            }

            console.log(`[LOG] [${INSTANCE_ID}] Всё чисто. Начинаю создание канала...`);

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
            const topContent = `${rolesPing}\n**Предыдущие заявки:**\nЗаявок не найдено.`;

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

            await channel.send({ content: topContent, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана! Канал: <#${channel.id}>`, ephemeral: true });
            return;
        }

        // ОБРАБОТКА ВЫБОРА ВОЙСА (ДЛЯ ОБЗВОНА)
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
                    content: `🔔 **Привет!** Твоя заявка в тему **Darkness** на сервере **${i.guild.name}** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовому каналу по прямой ссылке:\n${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                });
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        // ОБРАБОТКА СТАРЫХ КНОПОК И КНОПОК ЗАЯВОК
        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            
            if (parts[0] === "group" && parts[1] === "start") return;

            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав для нажатия этих кнопок.", ephemeral: true });
                return;
            }

            // Кнопки отчетов скриншотов из SCREEN канала
            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary.balances[targetId] = (salary.balances[targetId] || 0) + 1000;
                    saveDB(salary);
                    embed.setColor("Green").setTitle("📸 Отчёт одобрен");
                    await i.update({ embeds: [embed], components: [] });
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                    await i.update({ embeds: [embed], components: [] });
                }
                return;
            }

            // Кнопки управления заявками (app)
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

                    await i.channel.send({
                        content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчёт в аудите и закрыть тикет.`
                    });
                    setTimeout(updateOnlineMonitor, 4000);
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

                // Переделанная кнопка отклонения — теперь открывает модальное окно причины
                if (action === "reject") {
                    const modal = new ModalBuilder()
                        .setCustomId(`app_reject_modal_${targetId}`)
                        .setTitle("Укажите причину отказа");

                    const reasonInput = new TextInputBuilder()
                        .setCustomId("reject_reason_input")
                        .setLabel("Причина")
                        .setPlaceholder("Не прошли критерии / Плохие откаты / Неадекватность")
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
// ОБРАБОТКА ВЫХОДА ЧЕЛОВЕКА С СЕРВЕРА (МИНУС ЗАРПЛАТА)
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        // Проверяем, закреплен ли вышедший кандидат за каким-то конкретным рекрутером на этой неделе
        if (salary.candidates && salary.candidates[member.id]) {
            const recruiterId = salary.candidates[member.id];
            
            if (salary.balances[recruiterId]) {
                // Вычитаем 10к, баланс не может опуститься ниже нуля
                salary.balances[recruiterId] = Math.max(0, salary.balances[recruiterId] - 10000);
            }
            
            // Удаляем запись о человеке из БД
            delete salary.candidates[member.id];
            saveDB(salary);
            
            // Синхронизируем таблицу зарплат
            await updateSalaryEmbed(member.guild);
            console.log(`[SALARY SYSTEM] Кандидат ${member.user.tag} покинул сервер. С рекрутера <@${recruiterId}> удержано 10,000 руб.`);
        }
    } catch (e) {
        console.error("Ошибка при удержании средств за ливнувшего игрока:", e);
    }
});


// =====================================================
// ПРАВИЛЬНОЕ ВЫКЛЮЧЕНИЕ ДЛЯ RENDER (SIGTERM/SIGINT)
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
