// Проверка переводов: все ключи из кода есть в каждом словаре, нет лишних пустых.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('public/js');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const src = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const used = new Set();
for (const m of src.matchAll(/['`]((?:me|dept|min|push|integ|nav|pulse|tasks|task|tstatus|prio|appr|kudos|badge|meet|rsvp|ack|thread|vnote|tpl|auto|people|cal|common|auth|setup|register|side|folder|conn|search|empty|chat|mute|presence|typing|status|user|date|compose|msg|sys|poll|call|calls|panel|role|profile|newchat|contacts|catalog|ai|settings|theme|wall|notify|privacy|security|devices|sc|about|admin|time|emoji|voice|help|err)\.[a-z0-9_.]+)['`]/g)) used.add(m[1]);
// Динамические ключи
const dyn = {
  'ai.notice.': ['ai_off', 'ai_error', 'ai_busy', 'ai_refusal'], 'chat.type_': ['group', 'channel', 'direct', 'saved', 'ai'],
  'emoji.': ['recent', 'smileys', 'gestures', 'work', 'nature', 'food', 'activity', 'symbols'], 'folder.': ['all', 'unread', 'personal', 'groups', 'channels', 'archive'],
  'panel.tab_': ['media', 'files', 'links', 'voice'], 'role.': ['owner', 'admin', 'member'], 'status.': ['available', 'busy', 'dnd', 'away', 'remote', 'vacation'],
  'theme.': ['light', 'dark', 'system'], 'time.': ['in20m', 'in1h', 'in3h', 'tomorrow9', 'monday9'], 'typing.': ['typing', 'recording', 'uploading'],
  'wall.': ['animated', 'pattern', 'gradient', 'aurora', 'plain', 'dots'], 'admin.': ['stats', 'users', 'invites', 'audit', 'integr', 'depts'],
  'push.st_': ['on', 'off', 'denied', 'unsupported'], 'tstatus.': ['todo', 'doing', 'review', 'done', 'cancelled'], 'prio.': ['low', 'normal', 'high', 'urgent'], 'badge.': ['teamwork', 'idea', 'help', 'speed', 'quality', 'leader', 'client', 'mentor'],
  'rsvp.': ['yes', 'no', 'maybe', 'pending'], 'task.to_': ['doing', 'review', 'done'], 'appr.st_': ['pending', 'approved', 'rejected'],
  'pulse.hello_': ['night', 'morning', 'day', 'evening'], 'tasks.scope_': ['mine', 'created', 'all'],
  'settings.': ['profile', 'appearance', 'language', 'notifications', 'chats', 'privacy', 'devices', 'about'],
  'err.': ['ai_busy', 'ai_error', 'ai_off', 'ai_refusal', 'auth', 'bad_current', 'bad_login', 'disabled', 'edit_expired', 'empty', 'invite_invalid', 'login_invalid', 'login_taken',
    'name_required', 'pin_limit', 'poll_closed', 'poll_invalid', 'react_limit', 'readonly', 'sso_bad', 'sso_expired', 'sso_off', 'sso_used', 'time_past', 'title_required', 'too_many',
    'call_ended', 'call_forbidden', 'call_full', 'call_unavailable', 'call_unsupported', 'call_failed', 'not_found', 'server', 'pw_short', 'pw_weak', 'too_big', 'offline',
    'not_member', 'approvers_required', 'comment_required', 'approval_closed', 'kudos_to', 'forbidden', 'nothing_to_sum', 'dept_exists'],
};
for (const [p, list] of Object.entries(dyn)) for (const k of list) used.add(p + k);
for (const k of [...used]) if (/\.$|_$/.test(k) || k === 'ai.assistant') used.delete(k);
let bad = 0;
for (const lang of ['en', 'ru', 'uk', 'de', 'pl']) {
  const file = path.join(dir, 'locales', `${lang}.js`);
  if (!fs.existsSync(file)) { console.log(`${lang}: нет файла`); bad++; continue; }
  const dict = (await import(`file://${file}`)).default;
  const missing = [...used].filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !used.has(k));
  if (missing.length) { bad++; console.log(`${lang}: нет ${missing.length}: ${missing.join(', ')}`); }
  if (extra.length && lang === 'en') console.log(`${lang}: не используются: ${extra.join(', ')}`);
  if (!missing.length) console.log(`${lang}: OK (${Object.keys(dict).length})`);
}
process.exit(bad ? 1 : 0);
