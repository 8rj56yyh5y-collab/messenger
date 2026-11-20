// Тексты встроенной инструкции. Разметка — как в сообщениях: **жирный**, _курсив_, `код`, «- » — пункт списка.
const ru = [
  { id: 'start', icon: 'sparkles', title: 'Быстрый старт', body: `**Gobsek Chat** — корпоративный мессенджер компании: личные чаты, группы отделов, каналы новостей, звонки и видеоконференции, встроенный ИИ-помощник.

- Слева — список чатов, сверху — поиск (**Ctrl+K**) и папки: _Все, Непрочитанные, Личные, Группы, Каналы_.
- Кнопка с карандашом внизу списка — новое сообщение, группа или канал.
- Меню ☰ слева вверху — профиль, статус, «Избранное», сотрудники, звонки, настройки, эта инструкция.
- Нажмите на шапку чата — откроется панель с участниками, файлами и настройками.

Чтобы написать коллеге: ☰ → **Сотрудники**, или просто начните вводить его имя в поиске.` },
  { id: 'chats', icon: 'send', title: 'Чаты и папки', body: `**Виды чатов**
- **Личный** — переписка один на один.
- **Группа** — обсуждение для отдела или проекта, пишут все участники.
- **Канал** — объявления: пишут только администраторы, остальные читают и ставят реакции.
- **Избранное** — ваши заметки, ссылки и файлы «для себя».
- **Gobsek AI** — личный ИИ-помощник.

**Действия с чатом** (правый клик по строке или долгое нажатие на телефоне):
- закрепить наверху (до 10 чатов);
- отключить уведомления на час, 8 часов, день, неделю или навсегда;
- пометить непрочитанным — чтобы вернуться позже;
- отправить в архив — чат пропадёт из списка, но вернётся при новом сообщении.

Черновик сохраняется для каждого чата и виден на других устройствах.` },
  { id: 'messages', icon: 'edit', title: 'Сообщения', body: `**Оформление текста**
- \`**жирный**\` → **жирный**, \`_курсив_\` → _курсив_, \`~~зачёркнутый~~\`, \`__подчёркнутый__\`
- \`||спойлер||\` — скрытый текст, открывается по нажатию
- \`\`код\`\` и блоки кода в тройных обратных кавычках
- строка с \`> \` — цитата, с \`- \` — пункт списка
- **Ctrl+B** / **Ctrl+I** — жирный и курсив для выделенного текста

**Действия** — правый клик по сообщению, долгое нажатие или кнопка 🙂 рядом:
- **Ответить** (или двойной клик, или свайп влево на телефоне)
- **Изменить** — свои сообщения в течение 48 часов (стрелка ↑ в пустом поле — правка последнего)
- **Закрепить**, **Переслать**, **Копировать**, **Удалить у всех**
- **Напомнить** — в нужное время сообщение придёт в «Избранное»
- **Выделить** — несколько сообщений сразу: переслать, скопировать, удалить
- **Кто прочитал** — в группах для ваших сообщений

**Галочки**: ✓ — доставлено, ✓✓ — прочитано.

**Упоминания**: напишите \`@\` и начните вводить имя. \`@all\` — упомянуть всех в группе. Упоминание приходит даже в отключённом чате.

**Отправка**: правый клик по кнопке «Отправить» — **отправить позже** (в выбранное время) или **без звука**.` },
  { id: 'files', icon: 'clip', title: 'Файлы, фото, голосовые', body: `- Скрепка 📎 → фото/видео или файл. Можно перетащить файлы в окно чата или вставить картинку из буфера (**Ctrl+V**).
- Перед отправкой можно добавить подпись и выбрать «отправить как файлы» (без сжатия превью).
- **Голосовое**: при пустом поле нажмите на микрофон, говорите и нажмите «Отправить». Голосовые проигрываются подряд, скорость 1× / 1,5× / 2×.
- Все фото, файлы, ссылки и голосовые чата собраны в панели чата на вкладках.
- Нажмите на фото — откроется просмотр, листайте стрелками ← →.` },
  { id: 'polls', icon: 'poll', title: 'Опросы', body: `В группе: скрепка → **Опрос**. Укажите вопрос и от 2 до 12 вариантов.
- **Анонимный** — никто не видит, кто как голосовал.
- **Несколько ответов** — можно выбрать больше одного варианта.
- Голос можно изменить, нажав на вариант ещё раз. Автор может закрыть опрос.` },
  { id: 'groups', icon: 'users', title: 'Группы и каналы', body: `**Создать**: карандаш → «Новая группа» или «Новый канал», название, описание, участники.

**Открытые** группы и каналы видны всем сотрудникам в **Каталоге** (☰ → Каталог) — вступить можно в один клик. Закрытые — только по приглашению или ссылке.

**Роли**: владелец, администраторы, участники. Администраторы добавляют и исключают участников, закрепляют сообщения, меняют название и фото. Владелец назначает администраторов и может удалить чат.

**Ссылка-приглашение** — в панели чата, её можно сбросить в настройках чата.

**Только администраторы пишут** — переключатель в настройках группы, превращает её в «доску объявлений» с обсуждением в ответах.` },
  { id: 'calls', icon: 'phone', title: 'Звонки и конференции', body: `**Личный звонок**: кнопки 📞 (аудио) или 🎥 (видео) в шапке чата. Собеседнику придёт входящий звонок.

**Конференция**: те же кнопки в группе. Участники увидят плашку «Идёт конференция» и присоединятся одной кнопкой. До 12 участников.

**В звонке**:
- микрофон (**M**), камера (**V**), демонстрация экрана, поднять руку ✋, реакции 👍👏🎉
- нажмите на плитку участника — закрепить его крупно; кнопка сетки — режим «докладчик»
- говорящий подсвечивается рамкой
- свернуть звонок — он останется плашкой внизу, можно переписываться дальше

Пропущенные и состоявшиеся звонки — в чате и в ☰ → **Звонки**. Выбрать микрофон и камеру: Настройки → **Звонки и устройства**.

_Звук и видео идут напрямую между участниками и шифруются (DTLS-SRTP); сервер их не записывает._` },
  { id: 'ai', icon: 'sparkles', title: 'ИИ-помощник', body: `**Gobsek AI** (☰ → Gobsek AI) — помощник для рабочих задач: составить письмо, объяснить, перевести, придумать, посчитать.

**В любом чате** — кнопка с волшебной палочкой в поле ввода:
- **Предложить ответ** — три варианта ответа по контексту переписки
- **Пересказать чат** — главное, решения, открытые вопросы и задачи
- **Улучшить, Официальнее, Дружелюбнее, Короче, Подробнее** — переписать ваш черновик
- **Перевести** черновик на английский, украинский, немецкий, польский

**Перевод сообщения** — в меню сообщения → «Перевести».

ИИ видит только то, что вы ему отправили, или чат, который вы просите пересказать. Если ИИ не подключён, обратитесь к администратору.` },
  { id: 'search', icon: 'search', title: 'Поиск', body: `- **Ctrl+K** — общий поиск: чаты, сотрудники (по имени, должности, отделу), открытые группы и текст сообщений.
- Значок 🔍 в шапке чата — поиск внутри этого чата, найденные слова подсвечиваются.
- **Alt+↑ / Alt+↓** — переключение между чатами.` },
  { id: 'settings', icon: 'settings', title: 'Настройки и приватность', body: `- **Профиль** — фото, имя, «о себе», статус-подпись, контакты.
- **Статус** (☰): на месте, занят, не беспокоить, отошёл, удалённо, в отпуске. В режиме «Не беспокоить» приходят только упоминания.
- **Оформление** — светлая/тёмная тема, цвет, фон чата, размер шрифта, скругление пузырей, компактный режим.
- **Язык** — українська, русский, English, Deutsch, Polski.
- **Уведомления** — на рабочем столе, звуки, показ текста.
- **Приватность** — скрыть время последнего входа, e-mail, телефон.
- **Безопасность** — смена пароля, список устройств, выход на всех остальных.

Приложение можно установить: в браузере «Установить приложение» / «На экран Домой».` },
  { id: 'gobsek', icon: 'shield', title: 'Связь с Gobsek', body: `- **Вход через Gobsek** — если администратор включил, войдите кнопкой «Войти через Gobsek»: должность и отдел подтянутся из системы.
- **Уведомления Gobsek в чат** — администратор группы или канала создаёт вебхук (панель чата → Интеграции). Gobsek и другие системы присылают туда задачи, согласования, протоколы.
- Ссылки на документы Gobsek в сообщениях открываются в один клик.` },
  { id: 'keys', icon: 'keyboard', title: 'Горячие клавиши', body: `- **Ctrl+K** — поиск
- **Alt+↑ / ↓** — предыдущий / следующий чат
- **Esc** — закрыть окно, панель, отменить ответ
- **↑** в пустом поле — изменить последнее сообщение
- **Enter** — отправить, **Shift+Enter** — новая строка (можно поменять в настройках)
- **Ctrl+B / Ctrl+I** — жирный / курсив
- **M / V** в звонке — микрофон / камера
- **Ctrl+,** — настройки` },
  { id: 'faq', icon: 'help', title: 'Вопросы и ответы', body: `**Не приходят уведомления.** Разрешите уведомления для сайта в браузере (Настройки → Уведомления → «Включить»), проверьте, не отключён ли чат и не стоит ли статус «Не беспокоить».

**Собеседник не слышит меня.** Проверьте микрофон в Настройки → Звонки и устройства → «Проверить». Браузер должен иметь разрешение на микрофон и камеру.

**Звонок не соединяется.** В некоторых сетях нужен TURN-сервер — сообщите администратору.

**Забыл пароль.** Администратор сбросит пароль в разделе «Администрирование».

**Где мои сообщения на другом устройстве?** Всё хранится на сервере компании: войдите тем же логином — история, черновики и настройки будут на месте.` },
];

const uk = [
  { id: 'start', icon: 'sparkles', title: 'Швидкий старт', body: `**Gobsek Chat** — корпоративний месенджер компанії: особисті чати, групи відділів, канали новин, дзвінки й відеоконференції, вбудований ШІ-помічник.

- Ліворуч — список чатів, угорі — пошук (**Ctrl+K**) і папки: _Усі, Непрочитані, Особисті, Групи, Канали_.
- Кнопка з олівцем унизу списку — нове повідомлення, група або канал.
- Меню ☰ ліворуч угорі — профіль, статус, «Обране», співробітники, дзвінки, налаштування, ця інструкція.
- Натисніть на шапку чату — відкриється панель з учасниками, файлами й налаштуваннями.

Щоб написати колезі: ☰ → **Співробітники**, або просто почніть вводити ім'я в пошуку.` },
  { id: 'chats', icon: 'send', title: 'Чати й папки', body: `**Види чатів**
- **Особистий** — листування сам на сам.
- **Група** — обговорення для відділу чи проєкту, пишуть усі учасники.
- **Канал** — оголошення: пишуть лише адміністратори, решта читає й ставить реакції.
- **Обране** — ваші нотатки, посилання й файли «для себе».
- **Gobsek AI** — особистий ШІ-помічник.

**Дії з чатом** (правий клік по рядку або довге натискання на телефоні):
- закріпити вгорі (до 10 чатів);
- вимкнути сповіщення на годину, 8 годин, день, тиждень або назавжди;
- позначити непрочитаним — щоб повернутися пізніше;
- архівувати — чат зникне зі списку, але повернеться з новим повідомленням.

Чернетка зберігається для кожного чату й видна на інших пристроях.` },
  { id: 'messages', icon: 'edit', title: 'Повідомлення', body: `**Оформлення тексту**
- \`**жирний**\` → **жирний**, \`_курсив_\` → _курсив_, \`~~закреслений~~\`, \`__підкреслений__\`
- \`||спойлер||\` — прихований текст, відкривається натисканням
- \`\`код\`\` і блоки коду в потрійних зворотних лапках
- рядок з \`> \` — цитата, з \`- \` — пункт списку
- **Ctrl+B** / **Ctrl+I** — жирний і курсив для виділеного тексту

**Дії** — правий клік по повідомленню, довге натискання або кнопка 🙂 поруч:
- **Відповісти** (або подвійний клік, або свайп ліворуч на телефоні)
- **Змінити** — свої повідомлення протягом 48 годин (стрілка ↑ у порожньому полі — правка останнього)
- **Закріпити**, **Переслати**, **Копіювати**, **Видалити для всіх**
- **Нагадати** — у потрібний час повідомлення прийде в «Обране»
- **Виділити** — кілька повідомлень одразу
- **Хто прочитав** — у групах для ваших повідомлень

**Галочки**: ✓ — доставлено, ✓✓ — прочитано.

**Згадки**: напишіть \`@\` і почніть вводити ім'я. \`@all\` — згадати всіх у групі. Згадка приходить навіть у вимкненому чаті.

**Надсилання**: правий клік по кнопці «Надіслати» — **надіслати пізніше** або **без звуку**.` },
  { id: 'files', icon: 'clip', title: 'Файли, фото, голосові', body: `- Скріпка 📎 → фото/відео або файл. Можна перетягнути файли у вікно чату або вставити картинку з буфера (**Ctrl+V**).
- Перед надсиланням можна додати підпис і вибрати «надіслати як файли».
- **Голосове**: при порожньому полі натисніть мікрофон, говоріть і натисніть «Надіслати». Голосові відтворюються підряд, швидкість 1× / 1,5× / 2×.
- Усі фото, файли, посилання й голосові чату зібрані в панелі чату на вкладках.` },
  { id: 'polls', icon: 'poll', title: 'Опитування', body: `У групі: скріпка → **Опитування**. Вкажіть питання й від 2 до 12 варіантів.
- **Анонімне** — ніхто не бачить, хто як голосував.
- **Кілька відповідей** — можна вибрати більше одного варіанта.
- Голос можна змінити. Автор може закрити опитування.` },
  { id: 'groups', icon: 'users', title: 'Групи й канали', body: `**Створити**: олівець → «Нова група» або «Новий канал», назва, опис, учасники.

**Відкриті** групи й канали видно всім співробітникам у **Каталозі** (☰ → Каталог). Закриті — лише за запрошенням або посиланням.

**Ролі**: власник, адміністратори, учасники. Адміністратори додають і виключають учасників, закріплюють повідомлення, змінюють назву й фото. Власник призначає адміністраторів і може видалити чат.

**Писати лише адміністраторам** — перемикач у налаштуваннях групи.` },
  { id: 'calls', icon: 'phone', title: 'Дзвінки й конференції', body: `**Особистий дзвінок**: кнопки 📞 (аудіо) або 🎥 (відео) у шапці чату.

**Конференція**: ті самі кнопки в групі. Учасники побачать плашку «Триває конференція» й приєднаються однією кнопкою. До 12 учасників.

**У дзвінку**: мікрофон (**M**), камера (**V**), демонстрація екрана, підняти руку ✋, реакції. Натисніть на плитку — закріпити учасника. Згорніть дзвінок — він залишиться плашкою, можна листуватися далі.

Вибрати мікрофон і камеру: Налаштування → **Дзвінки й пристрої**.

_Звук і відео йдуть напряму між учасниками й шифруються (DTLS-SRTP); сервер їх не записує._` },
  { id: 'ai', icon: 'sparkles', title: 'ШІ-помічник', body: `**Gobsek AI** (☰ → Gobsek AI) — помічник для робочих задач: скласти лист, пояснити, перекласти, придумати, порахувати.

**У будь-якому чаті** — кнопка з чарівною паличкою в полі введення:
- **Запропонувати відповідь** — три варіанти за контекстом
- **Переказати чат** — головне, рішення, відкриті питання й задачі
- **Покращити, Офіційніше, Дружніше, Коротше, Докладніше** — переписати чернетку
- **Перекласти** чернетку

**Переклад повідомлення** — у меню повідомлення → «Перекласти».` },
  { id: 'search', icon: 'search', title: 'Пошук', body: `- **Ctrl+K** — загальний пошук: чати, співробітники, відкриті групи й текст повідомлень.
- 🔍 у шапці чату — пошук усередині чату.
- **Alt+↑ / Alt+↓** — перемикання між чатами.` },
  { id: 'settings', icon: 'settings', title: 'Налаштування й приватність', body: `- **Профіль** — фото, ім'я, «про себе», контакти.
- **Статус** (☰): на місці, зайнятий, не турбувати, відійшов, віддалено, у відпустці. «Не турбувати» — приходять лише згадки.
- **Оформлення** — тема, колір, фон чату, розмір шрифту, скруглення, компактний режим.
- **Мова** — українська, русский, English, Deutsch, Polski.
- **Приватність** — приховати час останнього входу, e-mail, телефон.
- **Безпека** — зміна пароля, пристрої, вихід на всіх інших.` },
  { id: 'gobsek', icon: 'shield', title: 'Зв\'язок з Gobsek', body: `- **Вхід через Gobsek** — посада й відділ підтягнуться із системи.
- **Сповіщення Gobsek у чат** — адміністратор групи створює вебхук (панель чату → Інтеграції), і Gobsek надсилає туди задачі, погодження, протоколи.` },
  { id: 'keys', icon: 'keyboard', title: 'Гарячі клавіші', body: `- **Ctrl+K** — пошук
- **Alt+↑ / ↓** — попередній / наступний чат
- **Esc** — закрити вікно, панель
- **↑** у порожньому полі — змінити останнє повідомлення
- **Enter** — надіслати, **Shift+Enter** — новий рядок
- **M / V** у дзвінку — мікрофон / камера` },
  { id: 'faq', icon: 'help', title: 'Питання й відповіді', body: `**Не приходять сповіщення.** Дозвольте сповіщення в браузері, перевірте, чи не вимкнений чат і чи не стоїть статус «Не турбувати».

**Співрозмовник мене не чує.** Перевірте мікрофон у Налаштування → Дзвінки й пристрої.

**Забув пароль.** Адміністратор скине пароль у розділі «Адміністрування».` },
];

const en = [
  { id: 'start', icon: 'sparkles', title: 'Getting started', body: `**Gobsek Chat** is the company messenger: direct chats, department groups, news channels, calls and video conferences, and a built-in AI assistant.

- The chat list is on the left, with search (**Ctrl+K**) and folders: _All, Unread, Personal, Groups, Channels_.
- The pencil button creates a new message, group or channel.
- The ☰ menu holds your profile, status, Saved messages, people, calls, settings and this guide.
- Click a chat header to open the panel with members, files and settings.` },
  { id: 'chats', icon: 'send', title: 'Chats and folders', body: `**Chat types**: **Direct** (one to one), **Group** (everyone writes), **Channel** (admins post, others read and react), **Saved messages** (notes to self), **Gobsek AI** (your assistant).

Right-click a chat (long-press on a phone) to pin it (up to 10), mute it, mark as unread or archive it. Drafts are kept per chat and sync across devices.` },
  { id: 'messages', icon: 'edit', title: 'Messages', body: `**Formatting**: \`**bold**\`, \`_italic_\`, \`~~strike~~\`, \`__underline__\`, \`||spoiler||\`, \`\`code\`\`, \`> quote\`, \`- list\`. **Ctrl+B / Ctrl+I** format the selection.

**Actions** (right-click, long-press or the 🙂 button): reply (also double-click or swipe left), edit (48 h; ↑ edits your last message), pin, forward, copy, delete for everyone, **remind me** (the message comes back in Saved messages), select several, **seen by** in groups.

✓ delivered, ✓✓ read. Type \`@\` to mention someone, \`@all\` for the whole group. Right-click **Send** to **send later** or **send silently**.` },
  { id: 'files', icon: 'clip', title: 'Files, photos, voice', body: `- 📎 → photo/video or file; drag files into the chat or paste an image (**Ctrl+V**).
- Add a caption or send as files.
- **Voice message**: with an empty field press the microphone, speak, press Send. Voice messages play in a row at 1× / 1.5× / 2×.
- Every photo, file, link and voice message is collected in the chat panel tabs.` },
  { id: 'polls', icon: 'poll', title: 'Polls', body: `In a group: 📎 → **Poll**, 2 to 12 options. Choose **anonymous** and/or **multiple answers**. Tap an option again to change your vote; the author can close the poll.` },
  { id: 'groups', icon: 'users', title: 'Groups and channels', body: `Create with the pencil button. **Public** groups and channels are listed in the **Directory** (☰ → Directory); private ones need an invite link. Roles: owner, admins, members. Admins manage members, pins, title and photo; the owner appoints admins and can delete the chat. "Only admins can post" turns a group into an announcement board.` },
  { id: 'calls', icon: 'phone', title: 'Calls and conferences', body: `📞 / 🎥 in a chat header starts a call; in a group it starts a conference (up to 12 people) that others join from the banner.

In a call: mic (**M**), camera (**V**), screen sharing, raise hand ✋, reactions, click a tile to pin it, minimise the call and keep chatting. Choose devices in Settings → **Calls and devices**.

_Audio and video go directly between participants and are encrypted (DTLS-SRTP); the server never records them._` },
  { id: 'ai', icon: 'sparkles', title: 'AI assistant', body: `**Gobsek AI** (☰ → Gobsek AI) helps with work: drafting, explaining, translating, brainstorming.

The magic-wand button in any chat: **suggest a reply**, **summarise the chat**, **improve / more formal / friendlier / shorter / longer**, **translate** your draft. Message menu → **Translate** translates a message. The AI only sees what you send it.` },
  { id: 'search', icon: 'search', title: 'Search', body: `**Ctrl+K** searches chats, people (name, position, department), public groups and message text. 🔍 in a chat header searches inside that chat. **Alt+↑/↓** switches chats.` },
  { id: 'settings', icon: 'settings', title: 'Settings and privacy', body: `Profile, **status** (available, busy, do not disturb, away, remote, on vacation), theme, accent colour, wallpaper, font size, bubble shape, compact mode, language (Українська, Русский, English, Deutsch, Polski), notifications, privacy (hide last seen, e-mail, phone), password and active devices. Install the app from the browser menu.` },
  { id: 'gobsek', icon: 'shield', title: 'Gobsek integration', body: `**Sign in with Gobsek** brings your position and department from the system. Group admins can create a **webhook** (chat panel → Integrations) so Gobsek posts tasks, approvals and minutes into the chat.` },
  { id: 'keys', icon: 'keyboard', title: 'Keyboard shortcuts', body: `- **Ctrl+K** search · **Alt+↑/↓** switch chats · **Esc** close
- **↑** edit last message · **Enter** send · **Shift+Enter** new line
- **Ctrl+B / Ctrl+I** bold / italic · **M / V** mic / camera in a call · **Ctrl+,** settings` },
  { id: 'faq', icon: 'help', title: 'FAQ', body: `**No notifications?** Allow notifications for the site, check the chat is not muted and your status is not "Do not disturb".

**They can't hear me.** Test the microphone in Settings → Calls and devices.

**A call won't connect.** Some networks need a TURN server — tell your administrator.

**Forgot password?** An administrator can reset it.` },
];

const de = [
  { id: 'start', icon: 'sparkles', title: 'Erste Schritte', body: `**Gobsek Chat** ist der Firmen-Messenger: Direktchats, Abteilungsgruppen, Kanäle, Anrufe und Videokonferenzen sowie ein KI-Assistent.

- Links: Chatliste, Suche (**Strg+K**) und Ordner.
- Stift-Knopf: neue Nachricht, Gruppe oder Kanal.
- Menü ☰: Profil, Status, Gespeichert, Personen, Anrufe, Einstellungen, Hilfe.` },
  { id: 'messages', icon: 'edit', title: 'Nachrichten', body: `**Formatierung**: \`**fett**\`, \`_kursiv_\`, \`~~durchgestrichen~~\`, \`||Spoiler||\`, \`\`Code\`\`.

Rechtsklick auf eine Nachricht: antworten, bearbeiten (48 Std.), anheften, weiterleiten, kopieren, löschen, **erinnern**, auswählen. ✓ zugestellt, ✓✓ gelesen. \`@\` erwähnt Personen. Rechtsklick auf **Senden**: später oder lautlos senden.` },
  { id: 'calls', icon: 'phone', title: 'Anrufe und Konferenzen', body: `📞 / 🎥 im Chatkopf startet einen Anruf, in Gruppen eine Konferenz (bis 12 Personen). Im Anruf: Mikrofon (**M**), Kamera (**V**), Bildschirm teilen, Hand heben, Reaktionen. Geräte wählen: Einstellungen → Anrufe und Geräte.` },
  { id: 'ai', icon: 'sparkles', title: 'KI-Assistent', body: `**Gobsek AI** hilft bei Texten, Übersetzungen und Ideen. Der Zauberstab-Knopf im Eingabefeld schlägt Antworten vor, fasst den Chat zusammen und überarbeitet Ihren Entwurf.` },
  { id: 'settings', icon: 'settings', title: 'Einstellungen', body: `Profil, Status, Design (hell/dunkel, Farbe, Hintergrund, Schriftgröße), Sprache, Benachrichtigungen, Datenschutz, Passwort und Geräte.` },
  { id: 'keys', icon: 'keyboard', title: 'Tastenkürzel', body: `- **Strg+K** Suche · **Alt+↑/↓** Chat wechseln · **Esc** schließen
- **↑** letzte Nachricht bearbeiten · **Enter** senden · **Umschalt+Enter** neue Zeile` },
];

const pl = [
  { id: 'start', icon: 'sparkles', title: 'Pierwsze kroki', body: `**Gobsek Chat** to firmowy komunikator: czaty prywatne, grupy działów, kanały, połączenia i wideokonferencje oraz asystent AI.

- Po lewej: lista czatów, wyszukiwanie (**Ctrl+K**) i foldery.
- Przycisk z ołówkiem: nowa wiadomość, grupa lub kanał.
- Menu ☰: profil, status, Zapisane, osoby, połączenia, ustawienia, pomoc.` },
  { id: 'messages', icon: 'edit', title: 'Wiadomości', body: `**Formatowanie**: \`**pogrubienie**\`, \`_kursywa_\`, \`~~przekreślenie~~\`, \`||spoiler||\`, \`\`kod\`\`.

Prawy klik na wiadomości: odpowiedz, edytuj (48 godz.), przypnij, przekaż, kopiuj, usuń, **przypomnij**, zaznacz. ✓ dostarczono, ✓✓ przeczytano. \`@\` oznacza osobę. Prawy klik na **Wyślij**: wyślij później lub bez dźwięku.` },
  { id: 'calls', icon: 'phone', title: 'Połączenia i konferencje', body: `📞 / 🎥 w nagłówku czatu rozpoczyna połączenie, w grupie — konferencję (do 12 osób). W trakcie: mikrofon (**M**), kamera (**V**), udostępnianie ekranu, podniesienie ręki, reakcje.` },
  { id: 'ai', icon: 'sparkles', title: 'Asystent AI', body: `**Gobsek AI** pomaga pisać, tłumaczyć i wymyślać. Przycisk z różdżką w polu wpisywania proponuje odpowiedzi, streszcza czat i poprawia szkic.` },
  { id: 'settings', icon: 'settings', title: 'Ustawienia', body: `Profil, status, wygląd (jasny/ciemny, kolor, tło, rozmiar czcionki), język, powiadomienia, prywatność, hasło i urządzenia.` },
  { id: 'keys', icon: 'keyboard', title: 'Skróty klawiszowe', body: `- **Ctrl+K** szukaj · **Alt+↑/↓** zmień czat · **Esc** zamknij
- **↑** edytuj ostatnią · **Enter** wyślij · **Shift+Enter** nowa linia` },
];

export default { ru, uk, en, de, pl };
