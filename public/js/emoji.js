// Набор эмодзи для панели (по категориям) и недавние.
import { t } from './i18n.js';
import { esc } from './util.js';

const CATS = {
  smileys: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾',
  gestures: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🦾 ✍️ 💅 🤳 👀 👁 🧠 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟',
  work: '💼 📁 📂 🗂 📅 📆 🗓 📇 📈 📉 📊 📋 📌 📍 📎 🖇 📏 📐 ✂️ 🗃 🗄 🗑 🔒 🔓 🔏 🔐 🔑 🗝 🔨 🪓 ⛏ ⚒ 🛠 🗡 ⚙️ 🧰 🧲 💡 🔦 🕯 💻 🖥 🖨 ⌨️ 🖱 💾 💿 📱 ☎️ 📞 📟 📠 📺 📻 🎙 ⏰ ⏱ ⏲ 🕰 ⌛ ⏳ 📡 🔋 🔌 💰 💵 💶 💳 🧾 ✉️ 📧 📨 📩 📤 📥 📦 📫 🏭 🏢 🏗 🚚 🚛 🚜 🏎 🚗 ✈️ 🚀',
  nature: '☀️ 🌤 ⛅ 🌥 ☁️ 🌦 🌧 ⛈ 🌩 ❄️ ☃️ ⛄ 🌬 🌈 ☔ ⚡ 🌊 🌍 🌎 🌏 🌱 🌿 ☘️ 🍀 🌵 🌴 🌳 🌲 🍁 🍂 🍃 🌺 🌸 🌼 🌻 🌹 🌷 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦅 🦉 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳',
  food: '☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🍸 🍹 🍾 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶 🥔 🥐 🍞 🧀 🥚 🍳 🥞 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍣 🍱 🥟 🍰 🎂 🧁 🍩 🍪 🍫 🍬 🍭 🍯',
  activity: '🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🏅 🎖 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥅 🏒 ⛳ 🏹 🎣 🥊 🎽 🛹 ⛷ 🏂 🏋️ 🚴 🏊 🧘 🎯 🎮 🎲 🧩 ♟ 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻',
  symbols: '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾ ‼️ ⁉️ ❓ ❔ ❕ ❗ ⚠️ 🚫 ⛔ 📛 🔞 ♻️ 🔰 ⭕ 🆗 🆕 🆙 🆒 🆓 🆘 ℹ️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ ▶️ ⏸ ⏹ ⏺ ⏭ ⏮ 🔀 🔁 🔂 ⬆️ ⬇️ ⬅️ ➡️ ↩️ ↪️ 🔝 🔜 🔚 💲 💱 ©️ ®️ ™️ #️⃣ 🔢 🇺🇦',
};
const ICONS = { recent: '🕘', smileys: '😀', gestures: '👍', work: '💼', nature: '🌿', food: '☕', activity: '🎉', symbols: '✅' };

function recent() {
  try { return JSON.parse(localStorage.getItem('gc-emoji') || '[]'); } catch { return []; }
}
export function pushRecent(e) {
  const list = [e, ...recent().filter((x) => x !== e)].slice(0, 32);
  try { localStorage.setItem('gc-emoji', JSON.stringify(list)); } catch { /* ignore */ }
}

export function emojiPanelHtml() {
  const rec = recent();
  const cats = Object.keys(CATS);
  const tabs = (rec.length ? ['recent', ...cats] : cats).map((c) => `<button class="ep-tab" data-cat="${c}" title="${esc(t(`emoji.${c}`))}">${ICONS[c]}</button>`).join('');
  const section = (c, list) => `<div class="ep-sec" data-sec="${c}"><div class="ep-title">${esc(t(`emoji.${c}`))}</div><div class="ep-grid">${list.map((e) => `<button class="ep-e" data-emoji="${e}">${e}</button>`).join('')}</div></div>`;
  const body = (rec.length ? section('recent', rec) : '') + cats.map((c) => section(c, CATS[c].split(' '))).join('');
  return `<div class="ep-tabs">${tabs}</div><div class="ep-body">${body}</div>`;
}

export function bindEmojiPanel(root, onPick) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (b) { pushRecent(b.dataset.emoji); onPick(b.dataset.emoji); return; }
    const tab = e.target.closest('[data-cat]');
    if (tab) {
      const sec = root.querySelector(`[data-sec="${tab.dataset.cat}"]`);
      const body = root.querySelector('.ep-body');
      if (sec && body) body.scrollTop = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    }
  });
}
