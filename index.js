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
// ВЕБ-СЕРВЕР ДЛЯ ПОДДЕРЖАНИЯ АКТИВНОСТИ (ОБЯЗАТЕЛЬНО ДЛЯ RENDER)
// ====================================================================
const app = express();
app.get('/', function (req, res) {
    res.send('Бот Darkness успешно запущен и работает.');
});
app.listen(process.env.PORT || 3000, function () {
    console.log("[SERVER] Экспресс-сервер запущен на порту " + (process.env.PORT || 3000));
});

// ====================================================================
// БЛОК НАСТРОЕК (ПРОПИШИ СВОИ ID НИЖЕ)
// ====================================================================
const config = {
    TOKEN: process.env.TOKEN || "ТОКЕН_ТВОЕГО_БОТА", 
    CHANNELS: {
        CATEGORY: "ID_КАТЕГОРИИ_ДЛЯ_ТИКЕТОВ", // ID категории, где будут создаваться каналы заявки
        LOGS: "ID_КАНАЛА_ЛОГОВ" // ID текстового канала, куда слать отчеты со скринами
    },
    ALLOWED_ROLES: [
        "ID_РОЛИ_АДМИНА_1", // Первая роль админа, которая должна видеть тикеты
        "ID_РОЛИ_АДМИНА_2"  // Вторая роль админа (если есть, если нет — сотри эту строку)
    ]
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// Защита от спама и хранилище данных
const modalLocks = new Set();

// ====================================================================
// СОБЫТИЕ ГОТОВНОСТИ БОТА
// ====================================================================
client.once('ready', async function () {
    console.log("========================================");
    console.log("Бот " + client.user.tag + " успешно запущен!");
    console.log("========================================");
    
    try {
        await client.application.commands.set([
            {
                name: 'panel',
                description: 'Отправить панель подачи заявки в Darkness',
            }
        ]);
        console.log("[КОМАНДЫ] Слэш-команда /panel успешно зарегистрирована.");
    } catch (err) {
        console.log("[ОШИБКА РЕГИСТРАЦИИ КОМАНД]: " + err.message);
    }
});

// ====================================================================
// ГЛАВНЫЙ ОБРАБОТЧИК СОБЫТИЙ ДИСКОРДА
// ====================================================================
client.on('interactionCreate', async function (interaction) {
    
    // ----------------------------------------------------------------
    // 1. КОМАНДА ВЫЗОВА ПАНЕЛИ /PANEL
    // ----------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'panel') {
            try {
                const embed = new EmbedBuilder()
                    .setTitle("Заявления в семью Darkness")
                    .setDescription("Нажмите на кнопку ниже, соответствующую вашему направлению, чтобы заполнить анкету.")
                    .setColor("#1f8b4c");

                const btnRegular = new ButtonBuilder()
                    .setCustomId("open_modal_regular")
                    .setLabel("Подать заявку")
                    .setStyle(ButtonStyle.Success);

                const btnAcademy = new ButtonBuilder()
                    .setCustomId("open_modal_academy")
                    .setLabel("Подать в Академию")
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(btnRegular, btnAcademy);

                await interaction.reply({ embeds: [embed], components: [row] });
            } catch (err) {
                console.log("[ОШИБКА PANEL]: " + err.message);
            }
            return;
        }
    }

    // ----------------------------------------------------------------
    // 2. НАЖАТИЕ НА КНОПКУ (ОТКРЫВАЕМ МОДАЛЬНОЕ ОКНО)
    // ----------------------------------------------------------------
    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith("open_modal_")) {
            try {
                const type = customId.replace("open_modal_", "");
                
                let modalTitle = "Анкета в Основу";
                if (type === "academy") {
                    modalTitle = "Анкета в Академию";
                }

                const modal = new ModalBuilder()
                    .setCustomId("apply_modal_" + type)
                    .setTitle(modalTitle);

                const q1 = new TextInputBuilder().setCustomId("q1").setLabel("ВАШ СТАТИЧЕСКИЙ ID И НИКНЕЙМ").setStyle(TextInputStyle.Short).setRequired(true);
                const q2 = new TextInputBuilder().setCustomId("q2").setLabel("ИМЯ И ВОЗРАСТ (В РЕАЛЕ)").setStyle(TextInputStyle.Short).setRequired(true);
                const q3 = new TextInputBuilder().setCustomId("q3").setLabel("ЕСТЬ ЛИ ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?").setStyle(TextInputStyle.Paragraph).setRequired(true);
                const q4 = new TextInputBuilder().setCustomId("q4").setLabel("ПОЧЕМУ ИМЕННО Darkness? КАК УЗНАЛИ?").setStyle(TextInputStyle.Paragraph).setRequired(true);
                
                const row1 = new ActionRowBuilder().addComponents(q1);
                const row2 = new ActionRowBuilder().addComponents(q2);
                const row3 = new ActionRowBuilder().addComponents(q3);
                const row4 = new ActionRowBuilder().addComponents(q4);
                
                modal.addComponents(row1, row2, row3, row4);

                if (type !== "academy") {
                    const q5 = new TextInputBuilder().setCustomId("q5").setLabel("ПРЕДОСТАВЬТЕ СВОИ ОТКАТЫ").setStyle(TextInputStyle.Paragraph).setRequired(true);
                    const row5 = new ActionRowBuilder().addComponents(q5);
                    modal.addComponents(row5);
                }

                await interaction.showModal(modal);
            } catch (err) {
                console.log("[ОШИБКА ОТКРЫТИЯ МОДАЛКИ]: " + err.message);
            }
            return;
        }
    }

    // ----------------------------------------------------------------
    // 3. ОТПРАВКА ЗАПОЛНЕННОЙ МОДАЛКИ (СОЗДАНИЕ ТЕКСТОВОГО ТИКЕТА)
    // ----------------------------------------------------------------
    if (interaction.isModalSubmit()) {
        const customId = interaction.customId;

        if (customId.startsWith("apply_modal_")) {
            // Защита Дискорда от зависания "Приложение не отвечает"
            await interaction.deferReply({ ephemeral: true }).catch(function() {});

            try {
                const userId = interaction.user.id;

                // Защита от спам-кликов
                if (modalLocks.has(userId)) {
                    await interaction.editReply({ content: "⚠️ Вы слишком часто нажимаете на кнопку! Подождите несколько секунд." }).catch(function() {});
                    return;
                }
                modalLocks.add(userId);
                setTimeout(function() { modalLocks.delete(userId); }, 5000);

                // Базовая проверка ID категории
                if (config.CHANNELS.CATEGORY === "ID_КАТЕГОРИИ_ДЛЯ_ТИКЕТОВ" || !config.CHANNELS.CATEGORY) {
                    await interaction.editReply({ content: "❌ **Ошибка настроек:** В коде не указан цифровой ID категории для тикетов (строка 32)." }).catch(function() {});
                    return;
                }

                const type = customId.replace("apply_modal_", "");
                const username = interaction.user.username;
                const channelName = type + "-" + username;
                const cleanChannelName = channelName.toLowerCase().replace(/[^a-z0-9-_]/g, '');

                // Проверяем, существует ли уже канал для этого юзера
                await interaction.guild.channels.fetch().catch(function() {});
                let existingChannel = null;
                const currentChannels = interaction.guild.channels.cache.values();
                for (const c of currentChannels) {
                    if (c.parentId === config.CHANNELS.CATEGORY && c.name === cleanChannelName) {
                        existingChannel = c;
                        break;
                    }
                }

                if (existingChannel) {
                    await interaction.editReply({ content: "⚠️ У вас уже создан канал с активной заявкой: <#" + existingChannel.id + ">" }).catch(function() {});
                    return;
                }

                // Сбор ответов из полей формы
                const q1Value = interaction.fields.getTextInputValue("q1");
                const q2Value = interaction.fields.getTextInputValue("q2");
                const q3Value = interaction.fields.getTextInputValue("q3");
                const q4Value = interaction.fields.getTextInputValue("q4");
                let q5Value = "Не предусмотрено для Академии";
                if (type !== "academy") {
                    q5Value = interaction.fields.getTextInputValue("q5");
                }

                // Построение доступов для нового канала вручную через цикл (без фильтров)
                const permissionOverwritesArray = [
                    {
                        id: interaction.guild.id,
                        deny: ["ViewChannel"]
                    },
                    {
                        id: userId,
                        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
                    }
                ];

                // Накатываем права для админских ролей
                let rolesPingString = "";
                if (config.ALLOWED_ROLES && Array.isArray(config.ALLOWED_ROLES)) {
                    for (let i = 0; i < config.ALLOWED_ROLES.length; i++) {
                        const roleId = config.ALLOWED_ROLES[i];
                        if (roleId && roleId !== "ID_РОЛИ_АДМИНА_1" && roleId !== "ID_РОЛИ_АДМИНА_2") {
                            permissionOverwritesArray.push({
                                id: roleId,
                                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
                            });
                            rolesPingString += "<@&" + roleId + "> ";
                        }
                    }
                }

                // Пытаемся создать канал текстового тикета
                const newChannel = await interaction.guild.channels.create({
                    name: cleanChannelName,
                    type: ChannelType.GuildText,
                    parent: config.CHANNELS.CATEGORY,
                    permissionOverwrites: permissionOverwritesArray
                });

                // Формируем текст шапки и анкету внутри эмбеда
                const topText = rolesPingString + "\n**Предыдущие заявки:**\nЗаявок не найдено.";

                let descriptionText = "**ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ**\n" + q1Value + "\n\n" +
                                       "**ИМЯ И ВОЗРАСТ (В РЕАЛЕ)**\n" + q2Value + "\n\n" +
                                       "**ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?**\n" + q3Value + "\n\n" +
                                       "**ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?**\n" + q4Value;

                if (type !== "academy") {
                    descriptionText += "\n\n**Предоставьте свои откаты**\n" + q5Value;
                }
                descriptionText += "\n\n**Пользователь**\n<@" + userId + ">";

                const mainEmbed = new EmbedBuilder()
                    .setTitle("Новое заявление")
                    .setDescription(descriptionText)
                    .setColor("#1f8b4c")
                    .addFields(
                        { name: "Никнейм", value: username, inline: true },
                        { name: "ID Аккаунта", value: userId, inline: true }
                    );

                // Интерактивные кнопки управления заявкой
                const btnAccept = new ButtonBuilder().setCustomId("app_accept_" + userId).setLabel("Принять").setStyle(ButtonStyle.Success);
                const btnReview = new ButtonBuilder().setCustomId("app_review_" + userId).setLabel("Взять на рассмотрение").setStyle(ButtonStyle.Primary);
                const btnCall = new ButtonBuilder().setCustomId("app_call_" + userId).setLabel("Вызвать на обзвон").setStyle(ButtonStyle.Primary);
                const btnReject = new ButtonBuilder().setCustomId("app_reject_" + userId).setLabel("Отклонить").setStyle(ButtonStyle.Danger);

                const actionRow = new ActionRowBuilder().addComponents(btnAccept, btnReview, btnCall, btnReject);

                // Отправляем всё это добро в созданную комнату
                await newChannel.send({ content: topText, embeds: [mainEmbed], components: [actionRow] });
                
                // Рапортуем пользователю, что всё готово
                await interaction.editReply({ content: "✅ Ваше заявление успешно отправлено! Для вас создан канал: <#" + newChannel.id + ">" }).catch(function() {});

            } catch (err) {
                console.log("[КРИТИЧЕСКАЯ ОШИБКА СОЗДАНИЯ ЗАЯВКИ]: " + err.stack);
                await interaction.editReply({ content: "❌ **Ошибка при создании заявки:** " + err.message + "\nПроверьте, выданы ли боту права Администратора и верны ли ID в конфигурации." }).catch(function() {});
            }
            return;
        }
    }

    // ----------------------------------------------------------------
    // 4. ОБРАБОТКА НАЖАТИЯ УПРАВЛЯЮЩИХ КНОПОК АДМИНИСТРАЦИИ
    // ----------------------------------------------------------------
    if (interaction.isButton()) {
        const buttonId = interaction.customId;

        // --- КНОПКА: ПРИНЯТЬ ---
        if (buttonId.startsWith("app_accept_")) {
            const targetPlayerId = buttonId.replace("app_accept_", "");
            await interaction.deferReply().catch(function() {});

            await interaction.editReply({ 
                content: "📁 **Запущена процедура отчёта.**\nПожалуйста, отправьте скриншот с планшета прямо в этот канал. У вас есть 2 минуты на загрузку файла." 
            }).catch(function() {});

            const msgFilter = function (m) {
                return m.author.id === interaction.user.id && m.attachments.size > 0;
            };

            const imageCollector = interaction.channel.createMessageCollector({ filter: msgFilter, max: 1, time: 120000 });

            imageCollector.on('collect', async function (collectedMessage) {
                try {
                    const attachedFile = collectedMessage.attachments.first();
                    const fileUrl = attachedFile.url;

                    // Удаляем сообщение админа со скриншотом для чистоты канала
                    await collectedMessage.delete().catch(function() {});

                    // Отправляем рапорт в лог-канал
                    if (config.CHANNELS.LOGS && config.CHANNELS.LOGS !== "ID_КАНАЛА_ЛОГОВ") {
                        const logsChannel = interaction.guild.channels.cache.get(config.CHANNELS.LOGS);
                        if (logsChannel) {
                            await logsChannel.send({
                                content: "📈 **Новый отчёт о принятии игрока**\n**Модератор:** <@" + interaction.user.id + ">\n**Принятый игрок:** <@" + targetPlayerId + ">",
                                files: [fileUrl]
                            }).catch(function() {});
                        }
                    }

                    await interaction.editReply({ 
                        content: "✅ **Игрок успешно принят!** Скриншот-отчёт сохранён и отправлен в лог-канал." 
                    }).catch(function() {});

                    // Отправляем оповещение игроку в личные сообщения (ЛС)
                    const memberObject = await interaction.guild.members.fetch(targetPlayerId).catch(function() {});
                    if (memberObject) {
                        await memberObject.send("🎉 Поздравляем! Ваше заявление в семью **Darkness** было успешно одобрено администрацией!").catch(function() {});
                    }
                } catch (e) {
                    console.log("[ОШИБКА ОБРАБОТКИ СКРИНШОТА]: " + e.message);
                }
            });

            imageCollector.on('end', async function (collectedData) {
                if (collectedData.size === 0) {
                    await interaction.editReply({ 
                        content: "❌ **Действие прервано.** Скриншот не был получен в течение двух минут." 
                    }).catch(function() {});
                }
            });
            return;
        }

        // --- КНОПКА: ВЗЯТЬ НА РАССМОТРЕНИЕ ---
        if (buttonId.startsWith("app_review_")) {
            await interaction.reply({ content: "👀 Модератор <@" + interaction.user.id + "> взял данное заявление на рассмотрение." }).catch(function() {});
            return;
        }

        // --- КНОПКА: ВЫЗВАТЬ НА ОБЗВОН ---
        if (buttonId.startsWith("app_call_")) {
            const targetPlayerId = buttonId.replace("app_call_", "");

            const voiceMenu = new ChannelSelectMenuBuilder()
                .setCustomId("call_voice_" + targetPlayerId)
                .setPlaceholder('Укажите голосовую комнату для проведения обзвона')
                .addChannelTypes(ChannelType.GuildVoice);

            const componentRow = new ActionRowBuilder().addComponents(voiceMenu);

            await interaction.reply({ content: 'Выберите голосовой канал из списка ниже:', components: [componentRow], ephemeral: true }).catch(function() {});
            return;
        }

        // --- КНОПКА: ОТКЛОНИТЬ ЗАЯВКУ ---
        if (buttonId.startsWith("app_reject_")) {
            await interaction.reply({ content: "❌ Заявление было отклонено. Комната будет полностью удалена через 5 секунд..." }).catch(function() {});
            
            setTimeout(function () {
                interaction.channel.delete().catch(function() {});
            }, 5000);
            return;
        }
    }

    // ----------------------------------------------------------------
    // 5. ОБРАБОТКА ВЫБОРА ГОЛОСОВОГО КАНАЛА ИЗ СЕЛЕКТ-МЕНЮ
    // ----------------------------------------------------------------
    if (interaction.isChannelSelectMenu()) {
        const menuId = interaction.customId;
        if (menuId.startsWith("call_voice_")) {
            const targetPlayerId = menuId.replace("call_voice_", "");
            const selectedChannelId = interaction.values[0];

            await interaction.reply({ 
                content: "📞 Кандидат <@" + targetPlayerId + "> вызван на обзвон в канал <#" + selectedChannelId + "> Администратором <@" + interaction.user.id + ">." 
            }).catch(function() {});
            return;
        }
    }
});

// Глобальные ловушки ошибок, чтобы процесс на Render никогда не падал самостоятельно
process.on('unhandledRejection', function (reason) {
    console.log('[ГЛОБАЛЬНАЯ ОШИБКА REJECTION]: ' + reason);
});
process.on('uncaughtException', function (err) {
    console.log('[ГЛОБАЛЬНАЯ ОШИБКА EXCEPTION]: ' + err.message);
});

client.login(config.TOKEN);
