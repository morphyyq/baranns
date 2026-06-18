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
            CATEGORY: "1513659194832719962", 
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076", 
            SBOR: "1458481307351781709",
            NOTIFY_PROMO: "1513660056338436206",
            REPORT_CATEGORY: "1458410646956806196"
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
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
// DATABASE
// =====================================================
const DB_FILE = path.join(__dirname, "salary.json");

function loadDB() {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        if (!data.balances) data.balances = {};
        if (!data.recruits) data.recruits = {};
        if (!data.reports) data.reports = {};
        if (!data.afk) data.afk = {};
        if (!data.archive) data.archive = {};
        if (!data.auditMessages) data.auditMessages = {};
        return data;
    } catch {
        return { balances: {}, recruits: {}, reports: {}, afk: {}, archive: {}, auditMessages: {} };
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
// AFK SYSTEM EMBED UPDATER
// =====================================================
async function updateAFKEmbed(guild) {
    try {
        const channel = await guild.channels.fetch("1500519252518768792").catch(() => null);
        if (!channel) return;

        let description = "📋 **Список активных участников в АФК режиме:**\n\n";
        const afkEntries = Object.entries(salary.afk);

        if (afkEntries.length === 0) {
            description += "*В данный момент никто не находится в АФК режиме.*";
        } else {
            afkEntries.forEach(([userId, timestamp]) => {
                const timeUnix = Math.floor(new Date(timestamp).getTime() / 1000);
                description += `• <@${userId}> — Встал в АФК: <t:${timeUnix}:R> (<t:${timeUnix}:t>)\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("⏳ Мониторинг АФК статусов")
            .setDescription(description)
            .setColor("#2b2d31")
            .setTimestamp();

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === "⏳ Мониторинг АФК статусов") : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed] }).catch(() => null);
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
            ),
        
        // --- ОБНОВЛЕННАЯ КОМАНДА /panel ---
        new SlashCommandBuilder()
            .setName("panel")
            .setDescription("Отправить panel для подачи заявок")
            .addAttachmentOption(opt => 
                opt.setName("image")
                .setDescription("Прикрепите картинку для баннера панели")
                .setRequired(true)
            ),

        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс"),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить panel управления сборами"),
        new SlashCommandBuilder().setName("delete").setDescription("Полностью очистить все балансы игроков"),
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить широкую panel системы повышений"),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить panel ручного управления АФК статусом"),
        new SlashCommandBuilder().setName("composition_panel").setDescription("Отправить ручную panel контроля состава"),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику выполненных отчетов").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя")),
        new SlashCommandBuilder().setName("info").setDescription("Получить личное дело и карточку заявки игрока").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя").setRequired(true))
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
});


// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        if (salary.afk && salary.afk[member.id]) {
            delete salary.afk[member.id];
            saveDB(salary);
            await updateAFKEmbed(member.guild);
        }

        if (salary.recruits && salary.recruits[member.id]) {
            const recruiterId = salary.recruits[member.id];
            
            if (salary.balances[recruiterId]) {
                salary.balances[recruiterId] -= 10000;
                if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
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
            saveDB(salary);
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

                saveDB(salary);
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
            
            if (i.commandName !== "rank" && i.commandName !== "balance" && i.commandName !== "all") {
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
                        !m.user.bot
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

            if (i.commandName === "delete") {
                salary.balances = {};
                salary.recruits = {};
                salary.auditMessages = {};
                saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы и привязки игроков были полностью аннулированы!", ephemeral: true });
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

                // Получаем прикреплённое изображение из опции команды
                const attachment = i.options.getAttachment("image");
                const bannerUrl = attachment ? attachment.url : null;

                const embed = new EmbedBuilder()
                    .setColor("#2b2d31")
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

                // Если баннер прикреплён — вставляем его как image в embed
                if (bannerUrl) {
                    embed.setImage(bannerUrl);
                }

                const menu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("apply_menu")
                        .setPlaceholder("Нажмите на меня, чтобы открыть меню")
                        .addOptions(
                            { label: "Academy", description: "Ник, статик, имя/возраст, онлайн, семья", value: "academy" },
                            { label: "Capture", description: "Ник, статик, имя/возраст, онлайн, семья, откаты", value: "capture" }
                        )
                );

                await channel.send({ 
                    embeds: [embed], 
                    components: [menu] 
                });

                await i.reply({ 
                    content: bannerUrl 
                        ? "✅ Панель успешно создана с баннером!" 
                        : "✅ Панель успешно создана (без баннера)!", 
                    ephemeral: true 
                });
                return;
            }
                const embed = new EmbedBuilder()
                    .setTitle("🔮 СИСТЕМА ПОВЫШЕНИЯ | DARKNESS FAMQ")
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
                const channel = await i.guild.channels.fetch("1500519252518768792").catch(() => null);
                if (!channel) return i.reply({ content: "❌ Канал АФК не найден.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("⏳ Пульт управления АФК статусом")
                    .setDescription("Используйте интерактивные переключатели ниже для изменения своей активности на сервере.\nПри нахождении в АФК-режиме, вам не будут рассылаться спам-уведомления о сборах групп.")
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("afk_enter").setLabel("Встать в АФК").setStyle(ButtonStyle.Primary).setEmoji("💤"),
                    new ButtonBuilder().setCustomId("afk_leave").setLabel("Выйти с АФК").setStyle(ButtonStyle.Success).setEmoji("🏃")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Управляющая панель АФК отправлена.", ephemeral: true });
                return;
            }

            if (i.commandName === "composition_panel") {
                await updateOnlineMonitor();
                await i.reply({ content: "✅ Панель состава обновлена и вызвана.", ephemeral: true });
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
                salary.afk[i.user.id] = new Date().toISOString();
                saveDB(salary);
                await i.reply({ content: "🟢 Вы успешно перешли в статус АФК. Уведомления о сборах приостановлены.", ephemeral: true });
            } else {
                if (salary.afk[i.user.id]) {
                    delete salary.afk[i.user.id];
                    saveDB(salary);
                }
                await i.reply({ content: "🏃 Вы вышли из режима АФК.", ephemeral: true });
            }
            await updateAFKEmbed(i.guild);
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
                saveDB(salary);

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

            const logChannelId = config.CHANNELS.AUDIT_APP || "1464575195418460417";
            const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);

            if (logChannel) {
                let originalEmbed;
                const messages = await i.channel.messages.fetch({ limit: 50 }).catch(() => null);
                if (messages) {
                    const msg = messages.find(m => m.embeds.length > 0 && m.embeds[0].description?.includes("ВАШ СТАТИЧЕСКИЙ ID"));
                    if (msg) originalEmbed = msg.embeds[0];
                }

                if (originalEmbed) {
                    const rejectEmbed = EmbedBuilder.from(originalEmbed)
                        .setTitle(null)
                        .setColor("Red")
                        .setTimestamp();
                    
                    rejectEmbed.addFields(
                        { name: "Кого", value: `<@${targetId}>`, inline: true },
                        { name: "Отклонил", value: `<@${i.user.id}>`, inline: true },
                        { name: "Причина", value: reason, inline: true }
                    );
                    
                    await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
                } else {
                    const rejectEmbed = new EmbedBuilder()
                        .setTitle("❌ Отказ по заявке в тему")
                        .setDescription(`👤 **Кандидат:** <@${targetId}>\n🔒 **Отклонил:** <@${i.user.id}>\n📝 **Причина:** ${reason}`)
                        .setColor("Red")
                        .setTimestamp();
                    await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
                }
            }

            await i.reply({ content: `❌ Заявка успешно отклонена. Причина зафиксирована в канале логирования.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        if (!config) return;

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
                    ...(config.ALLOWED_ROLES ? config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] })) : []),
                    { id: "1468704257606684712", allow: ["ViewChannel", "SendMessages"] } 
                ]
            });

            const rolesPing = config.ALLOWED_ROLES ? config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" ") : "";
            const topContent = `${rolesPing} <@&1468704257606684712>\n**Предыдущие заявки:**\nЗаявок не найдено.`;

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

                    saveDB(salary);
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

                    const liveData = applications.get(targetId);
                    salary.archive[targetId] = {
                        acceptedBy: i.user.id,
                        timestamp: new Date().toISOString(),
                        fields: liveData || { q1: "Не сохр.", q2: "Не сохр.", q3: "Не сохр.", q4: "Не сохр." }
                    };
                    saveDB(salary);

                    await i.channel.permissionOverwrites.edit(targetId, {
                        ViewChannel: false,
                        SendMessages: false
                    }).catch(() => null);

                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                    embed.setColor("Purple").setTitle("Заявление (Принято и Закрыто)");
                    await i.update({ embeds: [embed], components: [] });

                    const auditChannelId = config.CHANNELS.AUDIT_APP;
                    if (auditChannelId) {
                        const auditChannel = await i.guild.channels.fetch(auditChannelId).catch(() => null);
                        if (auditChannel) {
                            const auditEmbed = EmbedBuilder.from(i.message.embeds[0])
                                .setTitle(null)
                                .setColor("Green")
                                .addFields(
                                    { name: "Кого", value: `<@${targetId}>`, inline: true },
                                    { name: "Принял", value: `<@${i.user.id}>`, inline: true }
                                )
                                .setTimestamp();
                            await auditChannel.send({ embeds: [auditEmbed] }).catch(() => null);
                        }
                    }

                    await i.channel.send({
                        content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчет в аудите.`
                    });
                    return;
                }

                if (action === "review") {
                    embed.setColor("Yellow").setTitle("Заявление (На рассмотрении)");
                    await i.update({ embeds: [embed] });

                    const auditChannelId = config.CHANNELS.AUDIT_APP;
                    if (auditChannelId) {
                        const auditChannel = await i.guild.channels.fetch(auditChannelId).catch(() => null);
                        if (auditChannel) {
                            const auditEmbed = EmbedBuilder.from(i.message.embeds[0])
                                .setTitle(null)
                                .setColor("Yellow")
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
