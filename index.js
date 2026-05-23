const express = require('express');
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder
} = require('discord.js');

// ====================================================================
// 1. НАСТРОЙКА ВЕБ-СЕРВЕРА ДЛЯ RENDER (ЗАЩИТА ОТ СПЯЧКИ)
// ====================================================================
const app = express();
app.get('/', (req, res) => res.send('Bot Alive'));
app.listen(process.env.PORT || 3000, () => {
    console.log(`[SERVER] Express-сервер успешно запущен.`);
});

// ====================================================================
// 2. КОНФИГУРАЦИЯ БОТА (Обязательно замени ID ниже на свои цифры!)
// ====================================================================
const config = {
    TOKEN: process.env.TOKEN || "ТОКЕН_ТВОЕГО_БОТА", 
    CHANNELS: {
        CATEGORY: "ID_КАТЕГОРИИ_ДЛЯ_ТИКЕТОВ", // Сюда вставь ID категории, где создавать каналы
        LOGS: "ID_КАНАЛА_ЛОГОВ" // Сюда вставь ID канала для отправки скриншотов-отчетов
    },
    ALLOWED_ROLES: [
        "ID_РОЛИ_АДМИНА_1", 
        "ID_РОЛИ_АДМИНА_2"
    ]
};

// Уникальный ID копии бота для логирования
const INSTANCE_ID = Math.random().toString(36).substring(2, 7).toUpperCase();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const modalLocks = new Set();
const applications = new Map();

// ====================================================================
// 3. СОБЫТИЕ ГОТОВНОСТИ БОТА
// ====================================================================
client.once('ready', async () => {
    console.log(`---`);
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);
    console.log(`---`);
    
    try {
        await client.application.commands.set([
            {
                name: 'panel',
                description: 'Отправить панель подачи заявки в Darkness',
            }
        ]);
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (err) {
        console.error(`[ERROR] Ошибка регистрации команд:`, err);
    }
});

// ====================================================================
// 4. ОБРАБОТЧИК ВЗАИМОДЕЙСТВИЙ
// ====================================================================
client.on('interactionCreate', async (i) => {
    try {
        // --- 4.1. КОМАНДА /PANEL ---
        if (i.isChatInputCommand() && i.commandName === 'panel') {
            const embed = new EmbedBuilder()
                .setTitle("Заявления в семью Darkness")
                .setDescription("Нажмите на кнопку ниже, соответствующую вашему направлению, чтобы заполнить анкету.")
                .setColor("#1f8b4c");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("open_modal_regular").setLabel("Подать заявку").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("open_modal_academy").setLabel("Подать в Академию").setStyle(ButtonStyle.Primary)
            );

            await i.reply({ embeds: [embed], components: [row] });
            return;
        }

        // --- 4.2. НАЖАТИЕ НА КНОПКУ ПОДАЧИ (ОТКРЫТИЕ МОДАЛКИ) ---
        if (i.isButton() && i.customId.startsWith("open_modal_")) {
            const type = i.customId.replace("open_modal_", "");
            
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Анкета в Академию" : "Анкета в Основу");

            const q1 = new TextInputBuilder().setCustomId("q1").setLabel("ВАШ СТАТИЧЕСКИЙ ID И НИКНЕЙМ").setStyle(TextInputStyle.Short).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId("q2").setLabel("ИМЯ И ВОЗРАСТ (В РЕАЛЕ)").setStyle(TextInputStyle.Short).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId("q3").setLabel("ЕСТЬ ЛИ ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?").setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId("q4").setLabel("ПОЧЕМУ ИМЕННО Darkness? КАК УЗНАЛИ?").setStyle(TextInputStyle.Paragraph).setRequired(true);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(q1),
                new ActionRowBuilder().addComponents(q2),
                new ActionRowBuilder().addComponents(q3),
                new ActionRowBuilder().addComponents(q4)
            );

            if (type !== "academy") {
                const q5 = new TextInputBuilder().setCustomId("q5").setLabel("ПРЕДОСТАВЬТЕ СВОИ ОТКАТЫ").setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(q5));
            }

            await i.showModal(modal);
            return;
        }

        // --- 4.3. ОТПРАВКА ЗАПОЛНЕННОЙ МОДАЛКИ (СОЗДАНИЕ ТИКЕТА) ---
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            // Мгновенно резервируем ответ у Дискорда (защита от "Приложение не отвечает")
            await i.deferReply({ ephemeral: true }).catch(() => null);

            try {
                // Проверка на спам-клики
                if (modalLocks.has(i.user.id)) return;
                modalLocks.add(i.user.id);
                setTimeout(() => modalLocks.delete(i.user.id), 4000);

                // ПРОВЕРКА НАСТРОЕК КОНФИГУРАЦИИ
                if (config.CHANNELS.CATEGORY === "ID_КАТЕГОРИИ_ДЛЯ_ТИКЕТОВ" || isNaN(config.CHANNELS.CATEGORY)) {
                    return await i.editReply({ content: "❌ **Ошибка конфигурации:** Вы забыли указать реальный ID категории для тикетов в начале файла `index.js` (строка 25)." });
                }

                const type = i.customId.replace("apply_modal_", "");
                const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

                await i.guild.channels.fetch().catch(() => null);
                const existingChannel = i.guild.channels.cache.find(c => 
                    c.parentId === config.CHANNELS.CATEGORY && 
                    c.name === expectedChannelName
                );

                if (existingChannel) {
                    return await i.editReply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>` });
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

                // Создание канала для тикета
                const channel = await i.guild.channels.create({
                    name: expectedChannelName,
                    type: ChannelType.GuildText,
                    parent: config.CHANNELS.CATEGORY,
                    permissionOverwrites: [
                        { id: i.guild.id, deny: ["ViewChannel"] },
                        { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                        ...config.ALLOWED_ROLES.filter(roleId => !isNaN(roleId) && roleId.length > 5).map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                    ]
                });

                const rolesPing = config.ALLOWED_ROLES.filter(roleId => !isNaN(roleId) && roleId.length > 5).map(r => `<@&${r}>`).join(" ");
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
                await i.editReply({ content: `✅ Заявка успешно создана! Ваш канал: <#${channel.id}>` });

            } catch (innerError) {
                console.error(`[CRITICAL MODAL SUBMIT ERROR]`, innerError);
                await i.editReply({ content: `❌ **Ошибка при создании заявки:** ${innerError.message}\nУбедитесь, что ID категории указан верно и у бота есть права Администратора.` }).catch(() => null);
            }
            return;
        }

        // --- 4.4. КНОПКА "ПРИНЯТЬ" (СБОР СКРИНШОТОВ) ---
        if (i.isButton() && i.customId.startsWith("app_accept_")) {
            const targetUserId = i.customId.replace("app_accept_", "");
            await i.deferReply().catch(() => null);

            await i.editReply({ 
                content: `📁 **Отчёт (скрин с планшета)**\nПожалуйста, отправьте скриншот-подтверждение прямо в этот чат (прикрепите картинку к сообщению). У вас есть 2 минуты.` 
            }).catch(() => null);

            const filter = m => m.author.id === i.user.id && m.attachments.size > 0;
            const collector = i.channel.createMessageCollector({ filter, max: 1, time: 120000 });

            collector.on('collect', async (message) => {
                const screenshot = message.attachments.first();
                const screenshotUrl = screenshot.url;

                await message.delete().catch(() => null);

                // Отправка в лог-канал
                if (config.CHANNELS.LOGS && !isNaN(config.CHANNELS.LOGS)) {
                    const logChannel = i.guild.channels.cache.get(config.CHANNELS.LOGS);
                    if (logChannel) {
                        await logChannel.send({
                            content: `📈 **Новый отчёт о принятии**\n**Администратор:** <@${i.user.id}>\n**Принят игрок:** <@${targetUserId}>`,
                            files: [screenshotUrl]
                        }).catch(() => null);
                    }
                }

                await i.editReply({ 
                    content: `✅ **Заявка успешно одобрена!** Отчёт со скрином успешно зафиксирован.` 
                }).catch(() => null);

                // Опционально: отправка сообщения игроку в ЛС о принятии
                const targetUser = await i.guild.members.fetch(targetUserId).catch(() => null);
                if (targetUser) {
                    await targetUser.send(`🎉 Поздравляем! Ваша заявка в семью **Darkness** была одобрена!`).catch(() => null);
                }
            });

            collector.on('end', async (collected) => {
                if
