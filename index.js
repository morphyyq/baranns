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
            GROUP: "1508112178610438327",   // Канал с постоянным эмбедом для сборов
            GATHER: "1458481307351781709"  // Канал "сбор" в семье
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
        ]
    },
    // Добавлен конфиг для Ballas
    "1504470399268819115": {
        CHANNELS: {
            GATHER: "1504574610564321290"
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
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return {};
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
// MONITORING SYSTEM (Функция обновления онлайна)
// =====================================================
async function updateOnlineMonitor() {
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS || !config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) continue;

            // Кэшируем всех пользователей сервера для точного определения статусов
            await guild.members.fetch();

            const embed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setTimestamp();

            let totalOnline = 0;
            let totalMembersCount = 0;

            for (const roleData of config.MONITOR_ROLES) {
                const role = guild.roles.cache.get(roleData.id);
                if (!role) {
                    embed.addFields({ name: `❌ ${roleData.name}`, value: "Роль не найдена на сервере", inline: false });
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
                        // Проверяем статус. Если присутствия нет или статус offline — ставим красный круг
                        const isOnline = member.presence && member.presence.status !== "offline";
                        const statusEmoji = isOnline ? "🟢" : "🔴";
                        
                        if (isOnline) {
                            roleOnline++;
                            totalOnline++;
                        }

                        listString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                embed.addFields({
                    name: `👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`,
                    value: listString,
                    inline: false
                });
            }

            embed.setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``);

            // Ищем прошлое сообщение бота в канале, чтобы отредактировать его, а не спамить новыми
            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

            if (botMessage) {
                await botMessage.edit({ embeds: [embed] }).catch(() => null);
            } else {
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    } catch (error) {
        console.error(`[MONITOR ERROR] [${INSTANCE_ID}] Error updating monitor:`, error);
    }
}


// =====================================================
// PANEL GROUP SYSTEM (Инициализация панели сбора)
// =====================================================
async function setupGroupPanel() {
    try {
        const familyConfig = SERVERS["1458190222042075251"];
        const guild = await client.guilds.fetch("1458190222042075251").catch(() => null);
        if (!guild) return;
        
        const channel = await guild.channels.fetch(familyConfig.CHANNELS.GROUP).catch(() => null);
        if (!channel) return;

        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === "📢 Управление сборами");
        
        const embed = new EmbedBuilder()
            .setTitle("📢 Управление сборами")
            .setDescription("Выберите, от кого объявить сбор группы:")
            .setColor("#2b2d31");

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("group_base_select")
                .setPlaceholder("Выберите фракцию или семью")
                .addOptions([
                    { label: "От баллас", value: "ballas", emoji: "🟣" },
                    { label: "От семьи", value: "family", emoji: "🛡️" }
                ])
        );

        if (!botMsg) {
            await channel.send({ embeds: [embed], components: [menu] });
        }
    } catch (e) {
        console.error(`[SETUP GROUP PANEL ERROR]`, e);
    }
}


// =====================================================
// START GATHERING SPAM LOGIC (Система спама для сборов)
// =====================================================
async function startGatheringSpam(base, targetType, code) {
    try {
        const familyGuildId = "1458190222042075251";
        const ballasGuildId = "1504470399268819115";
        
        let guildId, gatherChannelId, pings;

        if (base === "family") {
            guildId = familyGuildId;
            gatherChannelId = SERVERS[familyGuildId].CHANNELS.GATHER;
            pings = "@everyone @Неизвестная роль"; 
        } else {
            guildId = ballasGuildId;
            gatherChannelId = SERVERS[ballasGuildId].CHANNELS.GATHER;
            pings = "@everyone <@&1504470450305241288> <@&1505558808766971944>";
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;
        const channel = await guild.channels.fetch(gatherChannelId).catch(() => null);
        if (!channel) return;

        const messageContent = `${pings}\nСбор на ${targetType}, всем быть, кого не будет = 2 варна. Группа: ${code}`;

        for (let i = 0; i < 3; i++) {
            // 1. Отправляем в канал
            await channel.send(messageContent).catch(() => null);

            // 2. Отправляем в ЛС всем нужным участникам
            const members = await guild.members.fetch().catch(() => new Map());
            for (const [id, member] of members) {
                if (member.user.bot) continue;
                
                let shouldDM = false;
                if (base === "ballas") {
                    shouldDM = SERVERS[ballasGuildId].PING_ROLES.some(r => member.roles.cache.has(r));
                } else {
                    const famConf = SERVERS[familyGuildId];
                    const famRoles = [...famConf.ALLOWED_ROLES, ...famConf.ACADEMY_ROLES, ...famConf.CAPTURE_ROLES];
                    shouldDM = famRoles.some(r => member.roles.cache.has(r));
                }

                if (shouldDM) {
                    await member.send(messageContent).catch(() => null);
                    await new Promise(r => setTimeout(r, 50)); // небольшая задержка, чтобы не словить спам-блок от Discord
                }
            }

            // Ждем 5 минут перед следующим циклом (если это не последний 3-й круг)
            if (i < 2) {
                await new Promise(r => setTimeout(r, 5 * 60 * 1000));
            }
        }
    } catch (error) {
        console.error(`[SPAM ERROR]`, error);
    }
}


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Начало обновления слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            // Игнорируем гильдию балласов для регистрации старых слеш команд
            if (guildId === "1504470399268819115") continue;
            
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] [${INSTANCE_ID}] Не удалось зарегистрировать команды:`, e);
    }

    // Запускаем мониторинг онлайна при включении бота и настраиваем интервал раз в 60 секунд
    await updateOnlineMonitor();
    setInterval(updateOnlineMonitor, 60000);
    
    // Инициализируем панель управления сборами
    await setupGroupPanel();
});


// =====================================================
// MESSAGE SYSTEM
// =====================================================
client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config || !config.CHANNELS) return; // Проверка, чтобы игнорировать неполные конфиги

        if (msg.content === "/balance") {
            return msg.reply({
                content: `💰 Баланс: ${salary[msg.author.id] || 0}`
            });
        }

        // ПРОВЕРКА СКРИНШОТА В ЗАКРЫТОМ ТИКЕТЕ (ОТЧЕТ ПЛАНШЕТА)
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 });
            const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));
            
            let candidateText = "Не удалось определить";
            if (appMessage) {
                const description = appMessage.embeds[0].description || "";
                const userMatch = description.match(/<@(\d+)>/);
                if (userMatch) candidateText = `<@${userMatch[1]}>`;
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                const file = new AttachmentBuilder(att.url, { name: att.name || "tablet_screen.png" });
                
                const auditEmbed = new EmbedBuilder()
                    .setTitle("📋 Отчёт по принятой заявке")
                    .setDescription(`👤 **Администратор:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                    .setImage(`attachment://${file.name}`)
                    .setColor("Purple")
                    .setTimestamp();

                await auditChannel.send({ embeds: [auditEmbed], files: [file] });
            }

            await msg.channel.send("✅ Отчёт успешно зафиксирован в аудите! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            
            // Сразу триггерим обновление мониторинга ролей, так как состав изменился
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

        // SCREEN SYSTEM (Для обычных отчетов рекрутов)
        if (msg.channel.id !== config.CHANNELS.SCREEN) return;
        
        if (processed.has(msg.id)) return;
        processed.add(msg.id);
        setTimeout(() => { processed.delete(msg.id); }, 120000);

        const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
        if (!att) return;

        const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
        if (!audit) return;

        const file = new AttachmentBuilder(att.url, { name: att.name || "screen.png" });

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

        const config = SERVERS[i.guild.id];
        if (!config) return;

        // СЛЭШ-КОМАНДЫ
        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                await i.reply({ content: `💰 Баланс: ${salary[i.user.id] || 0}`, ephemeral: true });
                return;
            }

            if (i.commandName === "panel") {
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
• У нас нет отдельных местах только под капты или MCL — вы вступаете в семью и участвуете во всём контенте.
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
        }

        // =====================================================
        // ГРУППЫ: ВЫБОР ФРАКЦИИ (ОТ БАЛЛАС / ОТ СЕМЬИ)
        // =====================================================
        if (i.isStringSelectMenu() && i.customId === "group_base_select") {
            const base = i.values[0]; 
            
            let options = [];
            if (base === "ballas") {
                options = ["цеха", "диллеры", "остров", "поставки", "фз", "контент", "банк", "дроп"].map(opt => ({
                    label: opt.charAt(0).toUpperCase() + opt.slice(1),
                    value: opt
                }));
            } else {
                options = ["капты", "контент", "арену", "тайники"].map(opt => ({
                    label: opt.charAt(0).toUpperCase() + opt.slice(1),
                    value: opt
                }));
            }

            const menuTarget = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`group_target_${base}`)
                    .setPlaceholder("Выберите тип сбора")
                    .addOptions(options)
            );

            await i.reply({ content: "➡️ Выберите, на что именно объявляется сбор:", components: [menuTarget], ephemeral: true });
            return;
        }

        // =====================================================
        // ГРУППЫ: ВЫБОР ТИПА СБОРА -> ВЫЗОВ МОДАЛКИ С КОДОМ
        // =====================================================
        if (i.isStringSelectMenu() && i.customId.startsWith("group_target_")) {
            const base = i.customId.replace("group_target_", "");
            const type = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`group_code_${base}_${type}`)
                .setTitle("Код группы");

            const codeInput = new TextInputBuilder()
                .setCustomId("group_code_input")
                .setLabel("Введите код группы (5 символов)")
                .setPlaceholder("Например: ZEUJA")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10); 

            modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            await i.showModal(modal);
            return;
        }


        // МЕНЮ ВЫБОРА ЗАЯВКИ (ОТКРЫТИЕ МОДАЛКИ)
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

        // =====================================================
        // ГРУППЫ: ОТПРАВКА МОДАЛКИ (ЗАПУСК СБОРА)
        // =====================================================
        if (i.isModalSubmit() && i.customId.startsWith("group_code_")) {
            const parts = i.customId.split("_");
            const base = parts[2];
            const type = parts.slice(3).join("_"); 
            const code = i.fields.getTextInputValue("group_code_input");

            await i.reply({ content: `✅ Сбор на **${type}** успешно запущен! Сообщения будут отправляться в канал и ЛС каждые 5 минут.`, ephemeral: true });

            startGatheringSpam(base, type, code);
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

            let embedDescription = `**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n${data.q1}\n\n**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n${data.q2}\n\n**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n${data.q3}\n\n**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n${data.q4}`;

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
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** на сервере **${i.guild.name}** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовому каналу по прямой ссылке:\n${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                });
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", ephemeral: true });
            return;
        }

        // ОБРАБОТКА КНОПОК
        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            const hasPermission = config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав для нажатия этих кнопок.", ephemeral: true });
                return;
            }

            // Кнопки отчетов скриншотов
            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary[targetId] = (salary[targetId] || 0) + 1000;
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

                    // Закрытие тикета для создателя (удаление прав на просмотр)
                    await i.channel.permissionOverwrites.edit(targetId, {
                        ViewChannel: false,
                        SendMessages: false
                    }).catch(() => null);

                    // Переименовываем канал в закрытый
                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    // Обновляем эмбед сообщения
                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    // Запрашиваем скриншот отчета у администратора
                    await i.channel.send({
                        content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчёт в аудите и закрыть тикет.`
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
                    embed.setColor("Red").setTitle("Заявление (Отклонено)");
                    await i.update({ embeds: [embed], components: [] });
                    await i.channel.send(`❌ Заявка отклонена. Канал будет удален через 15 секунд.`);
                    setTimeout(() => i.channel.delete().catch(() => null), 15000);
                    return;
                }
            }
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR HANDLED] [${INSTANCE_ID}]`, e);
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
