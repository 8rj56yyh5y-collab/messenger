# Связь Gobsek Chat с Gobsek

Два независимых механизма, каждый включается отдельно:

1. **Вход через Gobsek (SSO)** — сотрудник, уже вошедший в Gobsek, попадает в мессенджер одной кнопкой.
   Имя, должность и подразделение берутся из Gobsek и обновляются при каждом входе.
2. **Уведомления Gobsek в чаты** — входящие вебхуки: задачи, согласования, протоколы, платежи приходят в нужную группу или канал.

## 1. Вход через Gobsek

### Как это работает

```
Сотрудник в Gobsek ──► POST /api/v1/chat/sso-token (обычная авторизация Gobsek)
                       Gobsek подписывает JWT секретом GOBSEK_SSO_SECRET (не основным JWT!)
                  ◄──  { "url": "https://chat.example/sso/gobsek?token=…" }
браузер ──► https://chat.example/sso/gobsek?token=…  → cookie сессии мессенджера → чат открыт
```

Требования к токену (мессенджер проверяет каждое):

| Поле | Значение |
|---|---|
| заголовок `alg` | `HS256` |
| `aud` | `"gobsek-chat"` |
| `exp` | не дальше 10 минут от текущего времени (рекомендуем 2 минуты) |
| `jti` | уникальная строка — ссылка одноразовая |
| `user_id` | id пользователя Gobsek (ключ связки) |
| `username` | логин (если сотрудник уже заведён в чате с этим логином — учётные записи свяжутся) |
| `scope` | если передан — только `"full"` (не пускать незавершённый вход по устройству) |
| `name`, `position`, `department`, `email` | необязательно, но желательно — отображаются в профиле |
| `role` | `"admin"` + `GOBSEK_ADMINS_ARE_ADMINS=1` в мессенджере → администратор чата |

Секрет — **отдельный** (`GOBSEK_SSO_SECRET`), одинаковый в Gobsek и в мессенджере. Основной `jwt_secret` Gobsek
мессенджеру не передаётся: утечка секрета мессенджера не даёт входа в систему управления.

### Код для Gobsek (FastAPI, модуль `app/modules/messenger` или отдельный `chat_sso`)

```python
"""Вход в Gobsek Chat: короткий одноразовый JWT, подписанный отдельным секретом."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from jose import jwt
from sqlalchemy import select

from app.modules.identity.models import Person, User
from app.shared.auth import CurrentUser
from app.shared.config import get_settings
from app.shared.database import SessionDep

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/sso-token")
async def chat_sso_token(user: CurrentUser, session: SessionDep) -> dict:
    cfg = get_settings()
    # В Settings добавить: chat_url: str = "", chat_sso_secret: str = ""
    if not cfg.chat_sso_secret or not cfg.chat_url:
        raise HTTPException(404, "Gobsek Chat не налаштовано")
    if user.scope != "full" or user.delegated:
        raise HTTPException(403, "Вхід не завершено")
    row = (await session.execute(
        select(User, Person).outerjoin(Person, Person.id == User.person_id).where(User.id == user.user_id)
    )).one()
    db_user, person = row
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "aud": "gobsek-chat",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(minutes=2),
        "scope": "full",
        "user_id": db_user.id,
        "username": db_user.username,
        "name": person.full_name if person else db_user.username,
        "email": db_user.email or "",
        "role": db_user.role,
        # Посада й підрозділ — з поточного призначення, якщо є:
        # "position": ..., "department": ...,
    }, cfg.chat_sso_secret, algorithm="HS256")
    return {"url": f"{cfg.chat_url.rstrip('/')}/sso/gobsek?token={token}"}
```

Роутер подключается в `main.py` как остальные модули (`/api/v1/chat/sso-token`); в `tests/test_route_auth_coverage.py`
он проходит без allowlist — у него есть `CurrentUser`.

### Кнопка в интерфейсе Gobsek (Vue)

```ts
// Пункт меню «Месенджер»
async function openChat() {
  const { data } = await api.post<{ url: string }>('/chat/sso-token')
  window.open(data.url, '_blank', 'noopener')
}
```

### Кнопка «Войти через Gobsek» на экране входа мессенджера

Задайте в мессенджере `GOBSEK_SSO_URL` — адрес страницы Gobsek, которая вызывает `openChat()` при открытии
(например, маршрут SPA `/app/chat-sso`, в `onMounted` — `api.post('/chat/sso-token')` и `location.href = data.url`).
Если сотрудник не вошёл в Gobsek, Gobsek сначала покажет свой экран входа.

### Переменные мессенджера

```
GOBSEK_SSO_SECRET=<длинная случайная строка, та же, что chat_sso_secret в Gobsek>
GOBSEK_SSO_URL=https://gobsek.example/app/chat-sso
GOBSEK_URL=https://gobsek.example/app/
```

## 2. Уведомления Gobsek в чаты (вебхуки)

1. В мессенджере администратор группы или канала: панель чата → **Интеграции** → **+ Вебхук** → имя бота (например, «Gobsek · Платежі»).
2. Адрес вида `https://chat.example/api/hooks/<токен>` показывается **один раз** — сохраните его в настройках Gobsek.
3. Gobsek отправляет:

```http
POST /api/hooks/<токен>
Content-Type: application/json

{ "title": "Задача №42 прострочена", "text": "Відповідальний: @ivan\nСтрок: 20.11", "url": "https://gobsek.example/app/tasks/42", "silent": false }
```

`title` выводится жирным, `text` поддерживает разметку чата (`**жирный**`, списки, `@логин` — упоминание с уведомлением даже в отключённом чате),
`url` становится ссылкой, `silent: true` — без звука. Ответ — созданное сообщение (JSON).

Пример отправки из Gobsek (в обработчике события или фоновой задаче):

```python
import httpx

async def notify_chat(hook_url: str, title: str, text: str, url: str = "") -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.post(hook_url, json={"title": title, "text": text, "url": url})
        r.raise_for_status()
```

Хорошая практика, как с SimpleX в Gobsek: не слать из транзакции запроса, а писать строку в outbox и отправлять фоновой задачей
(при недоступности мессенджера событие не потеряется). Идеи маршрутов: «Gobsek · Платежі» ← платіжний календар і погодження,
«Gobsek · Задачі» ← прострочення й делегування, канал «Новини» ← анонс релізу «Що нового».

Удалить вебхук — та же панель; все системы, использующие его адрес, перестанут писать.

## 3. События из мессенджера в Gobsek

Мессенджер сам сообщает Gobsek о рабочих событиях — задачи, погодження, встречи и протоколы попадают в систему управления
без ручного переноса. Включается двумя переменными мессенджера:

```
GOBSEK_EVENTS_URL=https://gobsek.example/api/v1/chat/events
GOBSEK_EVENTS_SECRET=<длинная случайная строка, та же, что chat_events_secret в Gobsek>
```

Доставка надёжная: события лежат в очереди (`outbox`) и повторяются с растущей паузой (30 с → … → 6 ч, до 12 попыток),
если Gobsek недоступен. Состояние очереди — «Администрирование → Интеграции».

| Событие (`X-Gobsek-Chat-Event`) | Когда | Что в `data` |
|---|---|---|
| `task.created`, `task.updated`, `task.status` | задача поставлена, изменена, сменила статус | `task` (название, статус, приоритет, срок, `assignee`, `creator`), `actor` |
| `approval.created`, `approval.decided` | заявка на погодження, решение согласующего | название, сумма, валюта, `approvers`/`by`, `decision`, итоговый `status` |
| `meeting.created` | запланирована встреча | тема, время, длительность, `organizer`, `attendees` |
| `meeting.minutes` | сохранён протокол наради | `summary`, `decisions[]`, `tasks[]` с исполнителями — готово для модуля «Протоколи» |
| `kudos.given` | подяка | `from`, `to[]`, значок, текст |

Сотрудники передаются как `{ id, login, name, gobsek_id }` — `gobsek_id` заполнен у тех, кто входил через Gobsek.

Тело: `{"event": "...", "data": {...}, "ts": "ISO-время"}`. Заголовок `X-Gobsek-Chat-Signature: sha256=<HMAC-SHA256(тело)>`,
`X-Gobsek-Chat-Delivery` — номер доставки (для защиты от повторов). Ответ 2xx — принято, иначе мессенджер повторит.

Приёмник в Gobsek (FastAPI):

```python
import hashlib
import hmac

from fastapi import APIRouter, Header, HTTPException, Request

from app.shared.config import get_settings

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/events")
async def chat_events(request: Request, x_gobsek_chat_signature: str = Header(""), x_gobsek_chat_delivery: str = Header("")) -> dict:
    body = await request.body()
    expected = "sha256=" + hmac.new(get_settings().chat_events_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_gobsek_chat_signature):
        raise HTTPException(401, "bad signature")
    event = await request.json()
    # Идемпотентность: x_gobsek_chat_delivery уже обработан? — пропустить.
    # meeting.minutes → протокол + задачі в модулі protocols; task.* → Universal Task Engine; approval.decided → журнал погоджень.
    return {"ok": True}
```

Этот маршрут не требует `CurrentUser` (его вызывает сервер, а не человек) — его нужно добавить в явный allowlist
`tests/test_route_auth_coverage.py`; защита — подпись HMAC.

## 4. Push-уведомления

Мессенджер отправляет Web Push сам (VAPID-ключи создаются при первом запуске и хранятся в базе). Сотрудник включает push
в «Настройки → Уведомления». Работает в Chrome, Edge, Firefox, Safari на Mac и на iPhone/iPad (iOS 16.4+, приложение
должно быть добавлено «На экран Домой»). Нужен HTTPS. Переменная `VAPID_SUBJECT` — контакт администратора
(`mailto:it@компания` или адрес сайта), его видят push-сервисы браузеров.
