// Переводы: push, протокол наради, интеграции (uk, ru, en, de, pl). Запуск: node scripts/i18n-v3.mjs
import fs from 'node:fs';
import path from 'node:path';

const T = {
  'push.title': ['Push-сповіщення на цьому пристрої', 'Push-уведомления на этом устройстве', 'Push notifications on this device', 'Push-Benachrichtigungen auf diesem Gerät', 'Powiadomienia push na tym urządzeniu'],
  'push.checking': ['Перевіряю…', 'Проверяю…', 'Checking…', 'Prüfe…', 'Sprawdzam…'],
  'push.st_on': ['Увімкнено: повідомлення й дзвінки прийдуть, навіть коли застосунок закритий', 'Включены: сообщения и звонки придут, даже когда приложение закрыто', 'On: messages and calls arrive even when the app is closed', 'An: Nachrichten und Anrufe kommen auch bei geschlossener App', 'Włączone: wiadomości i połączenia dotrą nawet przy zamkniętej aplikacji'],
  'push.st_off': ['Вимкнено — без відкритого застосунку сповіщень не буде', 'Выключены — без открытого приложения уведомлений не будет', 'Off — no notifications while the app is closed', 'Aus — keine Benachrichtigungen bei geschlossener App', 'Wyłączone — brak powiadomień przy zamkniętej aplikacji'],
  'push.st_denied': ['Заборонено в браузері — дозвольте в налаштуваннях сайту', 'Запрещены в браузере — разрешите в настройках сайта', 'Blocked in the browser — allow them in site settings', 'Im Browser blockiert — in den Website-Einstellungen erlauben', 'Zablokowane w przeglądarce — zezwól w ustawieniach strony'],
  'push.st_unsupported': ['Браузер не підтримує. На iPhone спочатку встановіть застосунок «На екран Додому»', 'Браузер не поддерживает. На iPhone сначала установите приложение «На экран Домой»', 'Not supported. On iPhone, first add the app to the Home Screen', 'Nicht unterstützt. Auf dem iPhone zuerst zum Home-Bildschirm hinzufügen', 'Nieobsługiwane. Na iPhonie najpierw dodaj aplikację do ekranu głównego'],
  'push.enable': ['Увімкнути', 'Включить', 'Turn on', 'Einschalten', 'Włącz'],
  'push.disable': ['Вимкнути', 'Выключить', 'Turn off', 'Ausschalten', 'Wyłącz'],
  'push.failed': ['Не вдалося увімкнути push', 'Не удалось включить push', 'Could not enable push', 'Push konnte nicht aktiviert werden', 'Nie udało się włączyć push'],

  'min.button': ['Протокол', 'Протокол', 'Minutes', 'Protokoll', 'Protokół'],
  'min.title': ['Протокол: {title}', 'Протокол: {title}', 'Minutes: {title}', 'Protokoll: {title}', 'Protokół: {title}'],
  'min.ai': ['Скласти чернетку з ШІ', 'Составить черновик с ИИ', 'Draft with AI', 'Entwurf mit KI', 'Szkic z AI'],
  'min.ai_wait': ['ШІ читає порядок денний і обговорення…', 'ИИ читает повестку и обсуждение…', 'AI is reading the agenda and discussion…', 'KI liest Agenda und Diskussion…', 'AI czyta agendę i dyskusję…'],
  'min.ai_done': ['Чернетку готово — перевірте й збережіть', 'Черновик готов — проверьте и сохраните', 'Draft ready — review and save', 'Entwurf fertig — prüfen und speichern', 'Szkic gotowy — sprawdź i zapisz'],
  'min.no_ai': ['ШІ не підключено — заповніть протокол вручну.', 'ИИ не подключён — заполните протокол вручную.', 'AI is not connected — fill in the minutes manually.', 'KI nicht verbunden — Protokoll manuell ausfüllen.', 'AI nie jest podłączone — wypełnij protokół ręcznie.'],
  'min.summary': ['Підсумок', 'Итог', 'Summary', 'Zusammenfassung', 'Podsumowanie'],
  'min.summary_ph': ['Про що говорили й до чого дійшли', 'О чём говорили и к чему пришли', 'What was discussed and the outcome', 'Was besprochen wurde und das Ergebnis', 'O czym rozmawiano i jaki jest wynik'],
  'min.decisions': ['Рішення (по одному на рядок)', 'Решения (по одному на строку)', 'Decisions (one per line)', 'Beschlüsse (einer pro Zeile)', 'Decyzje (jedna w wierszu)'],
  'min.decisions_ph': ['Ліміт ЦФО «Склад» на грудень — 200 тис. грн', 'Лимит ЦФО «Склад» на декабрь — 200 тыс. грн', 'December limit for the Warehouse cost centre — 200k UAH', 'Dezember-Limit Kostenstelle Lager — 200 Tsd. UAH', 'Limit MPK „Magazyn” na grudzień — 200 tys. UAH'],
  'min.tasks': ['Доручення — стануть задачами', 'Поручения — станут задачами', 'Action items — become tasks', 'Aufgaben — werden zu Tasks', 'Zadania — staną się zadaniami'],
  'min.add_task': ['Доручення', 'Поручение', 'Action item', 'Aufgabe', 'Zadanie'],
  'min.save': ['Зберегти протокол', 'Сохранить протокол', 'Save minutes', 'Protokoll speichern', 'Zapisz protokół'],
  'min.saved': ['Протокол збережено, задач створено: {n}', 'Протокол сохранён, задач создано: {n}', 'Minutes saved, tasks created: {n}', 'Protokoll gespeichert, Aufgaben erstellt: {n}', 'Protokół zapisany, utworzono zadań: {n}'],

  'admin.integr': ['Інтеграції', 'Интеграции', 'Integrations', 'Integrationen', 'Integracje'],
  'integ.gobsek_events': ['Події в Gobsek', 'События в Gobsek', 'Events to Gobsek', 'Ereignisse an Gobsek', 'Zdarzenia do Gobsek'],
  'integ.events_stat': ['доставлено {d} · у черзі {p} · не вдалося {f}', 'доставлено {d} · в очереди {p} · не удалось {f}', 'delivered {d} · queued {p} · failed {f}', 'zugestellt {d} · wartend {p} · fehlgeschlagen {f}', 'dostarczono {d} · w kolejce {p} · nieudane {f}'],
  'integ.events_off': ['Не налаштовано (GOBSEK_EVENTS_URL)', 'Не настроено (GOBSEK_EVENTS_URL)', 'Not configured (GOBSEK_EVENTS_URL)', 'Nicht eingerichtet (GOBSEK_EVENTS_URL)', 'Nieskonfigurowane (GOBSEK_EVENTS_URL)'],
  'integ.sso': ['Вхід через Gobsek', 'Вход через Gobsek', 'Sign in with Gobsek', 'Anmeldung mit Gobsek', 'Logowanie przez Gobsek'],
  'integ.sso_off': ['Не налаштовано (GOBSEK_SSO_SECRET)', 'Не настроено (GOBSEK_SSO_SECRET)', 'Not configured (GOBSEK_SSO_SECRET)', 'Nicht eingerichtet (GOBSEK_SSO_SECRET)', 'Nieskonfigurowane (GOBSEK_SSO_SECRET)'],
  'integ.ai': ['ШІ-помічник', 'ИИ-помощник', 'AI assistant', 'KI-Assistent', 'Asystent AI'],
  'integ.ai_off': ['Не підключено (ANTHROPIC_API_KEY)', 'Не подключён (ANTHROPIC_API_KEY)', 'Not connected (ANTHROPIC_API_KEY)', 'Nicht verbunden (ANTHROPIC_API_KEY)', 'Niepodłączone (ANTHROPIC_API_KEY)'],
  'integ.push': ['Push-сповіщення', 'Push-уведомления', 'Push notifications', 'Push-Benachrichtigungen', 'Powiadomienia push'],
  'integ.push_stat': ['пристроїв підписано: {n}', 'устройств подписано: {n}', 'subscribed devices: {n}', 'angemeldete Geräte: {n}', 'zapisanych urządzeń: {n}'],
  'integ.hint': ['Налаштування — у змінних оточення сервера, див. README і docs/GOBSEK_INTEGRATION.md.', 'Настройки — в переменных окружения сервера, см. README и docs/GOBSEK_INTEGRATION.md.', 'Configured through server environment variables, see README and docs/GOBSEK_INTEGRATION.md.', 'Konfiguration über Umgebungsvariablen, siehe README und docs/GOBSEK_INTEGRATION.md.', 'Konfiguracja przez zmienne środowiskowe serwera, zob. README i docs/GOBSEK_INTEGRATION.md.'],
  'err.nothing_to_sum': ['Немає записів для протоколу — додайте порядок денний або обговоріть у гілці зустрічі', 'Нет записей для протокола — добавьте повестку или обсудите в ветке встречи', 'Nothing to summarise — add an agenda or discuss in the meeting thread', 'Nichts zusammenzufassen — Agenda hinzufügen oder im Thread diskutieren', 'Brak materiałów — dodaj agendę lub dyskutuj w wątku spotkania'],
};

const LANGS = ['uk', 'ru', 'en', 'de', 'pl'];
for (const [i, lang] of LANGS.entries()) {
  const file = path.resolve('public/js/locales', `${lang}.js`);
  let src = fs.readFileSync(file, 'utf8');
  const lines = Object.entries(T).filter(([k]) => !src.includes(`'${k}':`)).map(([k, v]) => `  '${k}': ${JSON.stringify(v[i])},`);
  if (!lines.length) continue;
  src = src.replace(/\n};\s*$/, `\n  // --- push, протокол, интеграции ---\n${lines.join('\n')}\n};\n`);
  fs.writeFileSync(file, src);
  console.log(lang, '+', lines.length);
}
