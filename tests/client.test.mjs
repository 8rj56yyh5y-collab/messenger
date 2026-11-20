// Тесты клиентских помощников, которые работают без браузера: разметка сообщений и переводы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, isEmojiOnly, plain } from '../public/js/util.js';
import { t, setLang } from '../public/js/i18n.js';

globalThis.document ??= { documentElement: {} };

test('разметка не пропускает HTML', () => {
  const out = md('<img src=x onerror=alert(1)> **жирний** <script>alert(1)</script>');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('<b>жирний</b>'));
});

test('ссылки: только http(s), с noopener', () => {
  const out = md('див. https://gobsek.example/tasks/42?x=1&y=2 і javascript:alert(1)');
  assert.match(out, /<a href="https:\/\/gobsek\.example\/tasks\/42\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">/);
  assert.ok(!/href="javascript/.test(out));
  const q = md('https://x.example/"onmouseover="alert(1)');
  assert.ok(!q.includes('" onmouseover'), q);
});

test('код, упоминания, спойлер, цитата', () => {
  assert.match(md('`<b>`'), /<code>&lt;b&gt;<\/code>/);
  assert.match(md('```\nconst a = 1 < 2;\n```'), /<pre class="code"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(md('привіт @olena', { me: 'olena' }), /class="mention me"/);
  assert.match(md('||секрет||'), /class="spoiler"/);
  assert.match(md('> цитата'), /class="quote"/);
});

test('эмодзи-сообщения и простой текст', () => {
  assert.equal(isEmojiOnly('👍'), true);
  assert.equal(isEmojiOnly('👍🔥🎉'), true);
  assert.equal(isEmojiOnly('ок 👍'), false);
  assert.equal(plain('**Звіт** _готовий_'), 'Звіт готовий');
});

test('множественное число в переводах', () => {
  setLang('uk');
  assert.equal(t('chat.members', { n: 1 }), '1 учасник');
  assert.equal(t('chat.members', { n: 3 }), '3 учасники');
  assert.equal(t('chat.members', { n: 5 }), '5 учасників');
  setLang('en');
  assert.equal(t('chat.members', { n: 2 }), '2 members');
  setLang('ru');
  assert.equal(t('poll.votes', { n: 21 }), '21 голос');
});
