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
            CATEGORY: "1458410646956806196",
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076"
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1458484199735689299",
            "1468704257606684712"
        ],
        // ОБНОВЛЕННЫЕ РОЛИ ПО ВАШЕМУ ЗАПРОСУ:
        ACADEMY_ROLES: [
            "1458410756453306490", 
            "1507798049416675531"
        ],
        CAPTURE_ROLES: [
            "1458410756453306490", 
            "1475114013611528274"
        ],
        MONITOR_ROLES: [
            { id: "1468704257606684712", name: "Рекруты" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1507798049416675531", name: "RP Состав" }
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
// MONITORING SYSTEM
// =====================================================
async function updateOnlineMonitor() {
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) continue;

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
                    embed.addFields({ name: `❌ ${roleData.name}`, value: "Роль не найдена", inline: false });
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

                embed.addFields({
                    name: `👥 ${roleData.name} [В сети: ${roleOnline}/${members.length}]`,
                    value: listString,
                    inline: false
                });
            }

            embed.setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``);

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

            if (botMessage) {
                await botMessage.edit({ embeds: [embed] }).catch(() => null);
            } else {
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    } catch (error) {
        console.error(`[MONITOR ERROR]`, error);
    }
}


// =====================================================
// READY
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder().setName("panel").setDescription("Отправить панель для подачи заявок"),
        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] Слэш-команды зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR]`, e);
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

        // ПРОВЕРКА СКРИНШОТА ПЛАНШЕТА В ТИКЕТЕ
        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 });
            const appMessage = channelMessages.find(m => m.embeds.length > 0 && m.embeds[0].title.startsWith("Заявление"));
            
            let candidateText = "Не удалось определить";
            if (appMessage) {
                const userMatch = appMessage.embeds[0].description.match(/<@(\d+)>/);
                if (userMatch) candidateText = `<@${userMatch[1]}>`;
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                const file = new AttachmentBuilder(att.url, { name: "tablet_screen.png" });
                const auditEmbed = new EmbedBuilder()
                    .setTitle("📋 Отчёт по принятой заявке")
                    .setDescription(`👤 **Администратор:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``)
                    .setImage(`attachment://tablet_screen.png`)
                    .setColor("Purple")
                    .setTimestamp();

                await auditChannel.send({ embeds: [auditEmbed], files: [file] });
            }

            await msg.channel.send("✅ Отчёт успешно зафиксирован! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

        // SCREEN SYSTEM (Рекруты)
        if (msg.channel.id === config.CHANNELS.SCREEN) {
            const att = msg.attachments.filter(a => a.contentType?.startsWith("image")).first();
            if (!att) return;

            const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
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
            setTimeout(() => msg.delete().catch(() => null), 5000);
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
        if (!config) return;

        if (i.isChatInputCommand()) {
            if (i.commandName === "balance") {
                await i.reply({ content: `💰 Баланс: ${salary[i.user.id] || 0}`, ephemeral: true });
            }
            if (i.commandName === "panel") {
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);
                const embed = new EmbedBuilder()
                    .setTitle("🚀 Заявки в семью Darkness")
                    .setDescription("Нажмите на кнопку ниже, чтобы подать заявку.")
                    .setColor("#2b2d31");

                const menu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("apply_menu")
                        .setPlaceholder("Выберите тип заявки")
                        .addOptions(
                            { label: "Academy", value: "academy", emoji: "🎓" },
                            { label: "Capture", value: "capture", emoji: "⚔️" }
                        )
                );

                await channel.send({ embeds: [embed], components: [menu] });
                await i.reply({ content: "✅ Панель отправлена", ephemeral: true });
            }
            return;
        }

        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИК И НИК", placeholder: "21074 | Hugo Darkness" },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ", placeholder: "Женя | 20" },
                { id: "q3", label: "ОПЫТ В СЕМЬЯХ", placeholder: "Да, был в..." },
                { id: "q4", label: "ПОЧЕМУ МЫ?", placeholder: "Увидел на респе..." }
            ];
            if (type !== "academy") fields.push({ id: "q5", label: "ОТКАТЫ", placeholder: "Ссылка на видео" });

            modal.addComponents(fields.map(f => new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setStyle(TextInputStyle.Paragraph).setRequired(true)
            )));

            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (modalLocks.has(i.user.id)) return;
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const channelName = `${type}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

            const channel = await i.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.CATEGORY,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("Заявление")
                .setColor("#1f8b4c")
                .setDescription(`**Тип:** ${type}\n**Ник:** ${i.fields.getTextInputValue("q1")}\n**Кандидат:** <@${i.user.id}>`);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_call_${i.user.id}`).setLabel("Обзвон").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`app_reject_${i.user.id}`).setLabel("Отклонить").setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: config.ALLOWED_ROLES.map(r => `<@&${r}>`).join(" "), embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Заявка создана: <#${channel.id}>`, ephemeral: true });
            return;
        }

        if (i.isButton()) {
            const [prefix, action, targetId] = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            if (!config.ALLOWED_ROLES.some(r => member.roles.cache.has(r))) {
                return i.reply({ content: "❌ Нет прав", ephemeral: true });
            }

            // Кнопки скриншотов
            if (prefix === "accept" || prefix === "reject") {
                const embed = EmbedBuilder.from(i.message.embeds[0]);
                if (prefix === "accept") {
                    salary[action] = (salary[action] || 0) + 1000;
                    saveDB(salary);
                    embed.setColor("Green").setTitle("📸 Одобрено");
                } else {
                    embed.setColor("Red").setTitle("📸 Отклонено");
                }
                await i.update({ embeds: [embed], components: [] });
                return;
            }

            // Кнопки заявок (app)
            if (prefix === "app") {
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    if (!targetMember) return i.reply({ content: "❌ Вышел", ephemeral: true });
                    
                    // ЛОГИКА ВЫДАЧИ РОЛЕЙ
                    const isAcademy = i.channel.name.startsWith("academy");
                    const rolesToGrant = isAcademy ? config.ACADEMY_ROLES : config.CAPTURE_ROLES;
                    
                    await targetMember.roles.add(rolesToGrant).catch(err => console.log("Role error:", err));

                    await i.channel.permissionOverwrites.edit(targetId, { ViewChannel: false });
                    const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "");
                    await i.channel.setName(`closed-${cleanName}`);

                    embed.setColor("Purple").setTitle("Заявление (Принято)");
                    await i.update({ embeds: [embed], components: [] });
                    await i.channel.send(`🎉 <@${targetId}> принят! <@${i.user.id}>, скинь скриншот планшета для аудита.`);
                }

                if (action === "reject") {
                    embed.setColor("Red").setTitle("Заявление (Отклонено)");
                    await i.update({ embeds: [embed], components: [] });
                    setTimeout(() => i.channel.delete().catch(() => null), 5000);
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`call_voice_${targetId}`)
                            .setPlaceholder("Выберите голосовой канал")
                            .addChannelTypes(ChannelType.GuildVoice)
                    );
                    await i.reply({ content: "Выберите канал для обзвона:", components: [voiceMenu], ephemeral: true });
                }
            }
        }

        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceId = i.values[0];
            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceId}`;

            await i.channel.send(`📞 <@${targetId}>, зайдите в <#${voiceId}> для обзвона!`);
            const target = await i.guild.members.fetch(targetId).catch(() => null);
            if (target) target.send(`Тебя вызвали на обзвон в Darkness: ${voiceUrl}`).catch(() => null);
            
            await i.reply({ content: "Вызван!", ephemeral: true });
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR]`, e);
    }
});

const shutdown = () => {
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(process.env.TOKEN);
