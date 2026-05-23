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
// 2. КОНФИГУРАЦИЯ БОТА (Замени ID на свои или используй env)
// ====================================================================
const config = {
    TOKEN: process.env.TOKEN || "ТОКЕН_ТВОЕГО_БОТА",
    CHANNELS: {
        CATEGORY: "ID_КАТЕГОРИИ_ДЛЯ_ТИКЕТОВ", // Категория, где будут создаваться каналы-заявки
        LOGS: "ID_КАНАЛА_ЛОГОВ" // Канал, куда можно дублировать отчеты (необязательно)
    },
    ALLOWED_ROLES: [
        "ID_РОЛИ_АДМИНА_1", 
        "ID_РОЛИ_АДМИНА_2"
    ]
};

// Генерация уникального ID процесса, чтобы отлавливать дубликаты на хостинге
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

// Хранилища в памяти
const modalLocks = new Set();
const applications = new Map();

// ====================================================================
// 3. СОБЫТИЕ ОБ ИНИЦИАЛИЗАЦИИ БОТА
// ====================================================================
client.once('ready', async () => {
    console.log(`---`);
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);
    console.log(`---`);
    
    // Регистрация слэш-команды /panel внутри бота
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
// 4. ОСНОВНОЙ ОБРАБОТЧИК ВЗАИМОДЕЙСТВИЙ (INTERACTIONS)
// ====================================================================
client.on('interactionCreate', async (i) => {
    try {
        // --- 4.1. СЛЭШ-КОМАНДА /PANEL ---
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

        // --- 4.2. НАЖАТИЕ НА КНОПКУ СТАРТА АНКЕТЫ (ОТКРЫТИЕ МОДАЛКИ) ---
        if (i.isButton() && i.customId.startsWith("open_modal_")) {
            const type = i.customId.replace("open_modal_", ""); // regular или academy
            
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

            // Если это основа — добавляем 5-й пункт для откатов
            if (type !== "academy") {
                const q5 = new TextInputBuilder().setCustomId("q5").setLabel("ПРЕДОСТАВЬТЕ СВОИ ОТКАТЫ").setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(q5));
            }

            await i.showModal(modal);
            return;
        }

        // --- 4.3.ОТПРАВКА ЗАПОЛНЕННОЙ МОДАЛКИ (СОЗДАНИЕ ТИКЕТА) ---
        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            console.log(`[LOG] [${INSTANCE_ID}] Пользователь ${i.user.tag} отправил модалку.`);

            // Защита-замок от двойных прокликов
            if (modalLocks.has(i.user.id)) {
                console.log(`[LOG] [${INSTANCE_ID}] Сработал замок! Отклоняю дубликат.`);
                return;
            }
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            // Резервируем время у Discord (убирает ошибку "Приложение не отвечает")
            await i.deferReply({ ephemeral: true }).catch(() => null);

            const type = i.customId.replace("apply_modal_", "");
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);
            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === config.CHANNELS.CATEGORY && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.editReply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>` }).catch(() => null);
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

            // Создаем канал тикета с правами доступа
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
            
            // Отвечаем пользователю через editReply
            await i.editReply({ content: `✅ Заявка создана! Канал: <#${channel.id}>` }).catch(() => null);
            return;
        }

        // --- 4.4. КНОПКА "ПРИНЯТЬ" (ТРЕБОВАНИЕ СКРИНШОТА-ОТЧЕТА) ---
        if (i.isButton() && i.customId.startsWith("app_accept_")) {
            const targetUserId = i.customId.replace("app_accept_", "");
            
            // Оповещаем Discord об удержании интеракции
            await i.deferReply().catch(() => null);

            await i.editReply({ 
                content: `📁 **Отчёт (скрин с планшета)**\nПожалуйста, отправьте скриншот-подтверждение прямо в этот чат (прикрепите изображение к сообщению). У вас есть 2 минуты.` 
            }).catch(() => null);

            // Фильтр: ждём сообщение только от того админа, кто нажал кнопку, и только с файлом
            const filter = m => m.author.id === i.user.id && m.attachments.size > 0;
            const collector = i.channel.createMessageCollector({ filter, max: 1, time: 120000 });

            collector.on('collect', async (message) => {
                const screenshot = message.attachments.first();
                const screenshotUrl = screenshot.url;

                // Удаляем сообщение админа с файлом для чистоты канала
                await message.delete().catch(() => null);

                // Опционально: Отправка копии отчета в специальный канал логов
                const logChannel = i.guild.channels.cache.get(config.CHANNELS.LOGS);
                if (logChannel) {
                    await logChannel.send({
                        content: `📈 **Новый отчёт о принятии**\n**Администратор:** <@${i.user.id}>\n**Принят игрок:** <@${targetUserId}>`,
                        files: [screenshotUrl]
                    }).catch(() => null);
                }

                // Меняем текст системного сообщения на успешный результат
                await i.editReply({ 
                    content: `✅ **Заявка успешно одобрена!** Отчёт со скрином зафиксирован в системе.` 
                }).catch(() => null);

                // [Сюда можно дописать выдачу роли игроку или отправку сообщения в ЛС]
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    await i.editReply({ 
                        content: `❌ **Действие отменено.** Время ожидания скриншота-отчёта (2 минуты) истекло.` 
                    }).catch(() => null);
                }
            });
            return;
        }

        // --- 4.5. КНОПКА "ВЗЯТЬ НА РАССМОТРЕНИЕ" ---
        if (i.isButton() && i.customId.startsWith("app_review_")) {
            await i.reply({ content: `👀 Администратор <@${i.user.id}> взял заявку на рассмотрение.` }).catch(() => null);
            return;
        }

        // --- 4.6. КНОПКА "ВЫЗВАТЬ НА ОБЗВОН" (ВЫБОР ВОЙСА) ---
        if (i.isButton() && i.customId.startsWith("app_call_")) {
            const targetUserId = i.customId.replace("app_call_", "");

            const selectMenu = new ChannelSelectMenuBuilder()
                .setCustomId(`call_voice_${targetUserId}`)
                .setPlaceholder('Выберите голосовой канал для обзвона')
                .addChannelTypes(ChannelType.GuildVoice);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await i.reply({ content: 'Выбор комнаты для проведения обзвона:', components: [row], ephemeral: true }).catch(() => null);
            return;
        }

        // --- 4.7. ОБРАБОТКА ВЫБОРА КОМНАТЫ ИЗ МЕНЮ ---
        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetUserId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];

            await i.reply({ 
                content: `📞 Кандидат <@${targetUserId}> вызван на обзвон в канал <#${voiceChannelId}> Администратором <@${i.user.id}>.` 
            }).catch(() => null);
            return;
        }

        // --- 4.8. КНОПКА "ОТКЛОНИТЬ" ---
        if (i.isButton() && i.customId.startsWith("app_reject_")) {
            await i.reply({ content: `❌ Заявка была отклонена администратором <@${i.user.id}>. Канал закроется через 5 секунд...` }).catch(() => null);
            
            setTimeout(() => {
                i.channel.delete().catch(() => null);
            }, 5000);
            return;
        }

    } catch (error) {
        console.error(`[INTERACTION ERROR HANDLED] [${INSTANCE_ID}]`, error);
    }
});

// Логирование критических ошибок, чтобы бот не падал на Render
process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]:', error));
process.on('uncaughtException', error => console.error('[UNCAUGHT EXCEPTION]:', error));

client.login(config.TOKEN);
