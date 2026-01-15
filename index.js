import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

/* ================= ES MODULES FIX ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= INIT ================= */

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ================= BOT MENU (LEFT MENU) ================= */

await bot.setMyCommands([
  { command: 'start', description: 'О боте CHECKGRAM' },
  { command: 'help', description: 'Помощь' },
  { command: 'premium', description: 'Премиум доступ' },
]);

/* ================= KEYBOARD ================= */

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['⭐ Premium', 'ℹ️ Help'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

/* ================= UTILS ================= */

function extractUsername(text) {
  const match = text.match(/instagram\.com\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function isAd(caption = '') {
  const keys = ['#ad', '#ads', '#реклама', 'реклама', 'collab', 'партнер'];
  return keys.some(k => caption.toLowerCase().includes(k));
}

/* ================= FAKE CHECK ================= */

function detectFakeFlag(stats) {
  const followers = stats.followers || 1;

  const lowReelsER = stats.reels.er !== null && stats.reels.er < 0.5;
  const lowFeedER = stats.feed.er !== null && stats.feed.er < 0.3;

  const lowLikes =
    stats.feed.avgLikes < followers * 0.003 &&
    stats.activity.postsLast30 > 20;

  const adsShare =
    (stats.reels.ads + stats.feed.ads) /
      Math.max(stats.reels.count + stats.feed.count, 1) >
    0.4;

  if (lowReelsER && lowFeedER)
    return '⚠️ Подозрение на накрутку: низкая вовлечённость';

  if (lowLikes)
    return '⚠️ Подозрение на накрутку: слабый отклик при высокой активности';

  if (adsShare)
    return '⚠️ Подозрение на накрутку: высокая доля рекламы';

  return '✅ Признаков накрутки не выявлено';
}

/* ================= START ================= */

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const imagePath = path.join(__dirname, 'img', 'logo_bot.png');

  try {
    await bot.sendPhoto(
      chatId,
      fs.createReadStream(imagePath),
      {
        caption:
`👁 CHECKGRAM

Бот для быстрой оценки Instagram-аккаунтов
с точки зрения рекламодателя.

📎 Просто пришли ссылку на профиль.`,
        ...mainKeyboard,
      }
    );
  } catch {
    await bot.sendMessage(
      chatId,
`👁 CHECKGRAM

Бот для быстрой оценки Instagram-аккаунтов
с точки зрения рекламодателя.

📎 Просто пришли ссылку на профиль.`,
      mainKeyboard
    );
  }
});

/* ================= HELP ================= */

bot.onText(/\/help|ℹ️ Help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
`ℹ️ CHECKGRAM — помощь

Отправь ссылку на Instagram-профиль.
Бот покажет активность, ER и риски
для рекламных интеграций.

Подходит для первичного отбора аккаунтов.`,
    mainKeyboard
  );
});

/* ================= PREMIUM ================= */

bot.onText(/\/premium|⭐ Premium/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
`⭐ CHECKGRAM PREMIUM (в разработке)

Планируется:
• расширенная аналитика
• скоринг аккаунта
• фильтр накрутки
• история проверок
• приоритетный анализ

🚀 Скоро`,
    mainKeyboard
  );
});

/* ================= OTHER SOCIAL LINKS ================= */

function extractOtherSocialLinks(profile) {
  const text = `${profile.biography || ''} ${profile.externalUrl || ''}`;
  const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
  const socials = [];

  for (const url of urls) {
    const u = url.toLowerCase();
    if (u.includes('tiktok.com')) socials.push({ name: 'TikTok', url });
    else if (u.includes('youtube.com') || u.includes('youtu.be')) socials.push({ name: 'YouTube', url });
    else if (u.includes('t.me') || u.includes('telegram.me')) socials.push({ name: 'Telegram', url });
    else if (u.includes('twitter.com') || u.includes('x.com')) socials.push({ name: 'Twitter / X', url });
    else if (u.includes('facebook.com')) socials.push({ name: 'Facebook', url });
  }

  return socials;
}

/* ================= APIFY PROFILE ================= */

async function fetchInstagramProfile(username) {
  const url =
    'https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items';

  const { data } = await axios.post(
    `${url}?token=${process.env.APIFY_TOKEN}`,
    { usernames: [username] },
    { timeout: 120000 }
  );

  if (!Array.isArray(data) || !data.length)
    throw new Error('Профиль не найден');

  const profile = data[0];
  const followers = profile.followersCount || 0;
  const otherSocials = extractOtherSocialLinks(profile);

  const now = Date.now();
  const cutoff30 = now - 30 * 24 * 60 * 60 * 1000;
  const cutoff180 = now - 180 * 24 * 60 * 60 * 1000;

  const content = profile.latestPosts || [];
  const last30 = content.filter(p => new Date(p.timestamp).getTime() >= cutoff30);
  const last180 = content.filter(p => new Date(p.timestamp).getTime() >= cutoff180);

  let reelsUsed = 0;
  let feedUsed = 0;

  const reels = { count: 0, ads: 0, engagement: 0, views: 0, likes: 0, comments: 0, shares: 0 };
  const feed  = { count: 0, ads: 0, engagement: 0, views: 0, likes: 0, comments: 0, shares: 0 };

  last30
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .forEach(post => {
      const likes = post.likesCount || 0;
      const comments = post.commentsCount || 0;
      const shares = post.sharesCount || 0;
      const saves = post.savesCount || 0;
      const views = post.videoViewCount || 0;
      const engagement = likes + comments + shares + saves;

      if (post.type === 'Video') {
        if (reelsUsed >= 15) return;
        reelsUsed++;
        reels.count++;
        reels.engagement += engagement;
        reels.views += views;
        reels.likes += likes;
        reels.comments += comments;
        reels.shares += shares;
        if (isAd(post.caption)) reels.ads++;
      } else {
        if (feedUsed >= 10) return;
        feedUsed++;
        feed.count++;
        feed.engagement += engagement;
        feed.views += views;
        feed.likes += likes;
        feed.comments += comments;
        feed.shares += shares;
        if (isAd(post.caption)) feed.ads++;
      }
    });

  const calc = (b) => ({
    count: b.count,
    ads: b.ads,
    er: b.count && followers ? ((b.engagement / b.count) / followers) * 100 : null,
    avgViews: b.count ? Math.round(b.views / b.count) : 0,
    avgLikes: b.count ? Math.round(b.likes / b.count) : 0,
    avgComments: b.count ? Math.round(b.comments / b.count) : 0,
    avgShares: b.count ? Math.round(b.shares / b.count) : 0,
  });

  const stats = {
    followers,
    otherSocials,
    activity: {
      postsLast30: last30.length,
      postsLast180: last180.length,
    },
    reels: calc(reels),
    feed: calc(feed),
    audience: {
      geo: 'н/д',
      gender: 'н/д',
      age: 'н/д',
      realFollowers: 'н/д',
    },
  };

  stats.fakeFlag = detectFakeFlag(stats);
  return stats;
}

/* ================= GPT ================= */

async function analyzeWithGPT(stats) {
  const prompt = `
Ты анализируешь Instagram-аккаунт ТОЛЬКО
с точки зрения рекламодателя.

Подписчики: ${stats.followers}
Публикаций за 30 дней: ${stats.activity.postsLast30}
Публикаций за 6 месяцев: ${stats.activity.postsLast180}
Reels ER: ${stats.reels.er?.toFixed(2) || 'н/д'}%
Feed ER: ${stats.feed.er?.toFixed(2) || 'н/д'}%
Статус: ${stats.fakeFlag}

Сделай краткий вывод (до 4 строк).
`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
  });

  return res.choices[0].message.content.trim();
}

/* ================= BOT ================= */

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.text.startsWith('⭐') || msg.text.startsWith('ℹ️')) return;

  const chatId = msg.chat.id;
  const username = extractUsername(msg.text);

  if (!username) {
    await bot.sendMessage(chatId, '❌ Пришли ссылку на Instagram', mainKeyboard);
    return;
  }

  await bot.sendMessage(chatId, '🔍 Анализирую аккаунт...');

  try {
    const stats = await fetchInstagramProfile(username);
    const analysis = await analyzeWithGPT(stats);

    const socialsBlock = stats.otherSocials.length
      ? `━━━━━━━━━━━━━━
🌐 ДРУГИЕ СОЦСЕТИ
━━━━━━━━━━━━━━
${stats.otherSocials.map(s => `• ${s.name}: ${s.url}`).join('\n')}`
      : '';

    await bot.sendMessage(
      chatId,
`📊 Instagram: @${username}

━━━━━━━━━━━━━━
📈 СТАТИСТИКА ПРОФИЛЯ
━━━━━━━━━━━━━━
👥 Подписчики: ${stats.followers}
🗓 Публикации:
• за 30 дней: ${stats.activity.postsLast30}
• за 6 месяцев: ${stats.activity.postsLast180}

${socialsBlock}

━━━━━━━━━━━━━━
👥 АУДИТОРИЯ
━━━━━━━━━━━━━━
🌍 Гео: ${stats.audience.geo}
🚻 Пол: ${stats.audience.gender}
🎂 Возраст: ${stats.audience.age}
🤖 Живые подписчики: ${stats.audience.realFollowers}

━━━━━━━━━━━━━━
🚨 ПРОВЕРКА НА НАКРУТКУ
━━━━━━━━━━━━━━
${stats.fakeFlag}

━━━━━━━━━━━━━━
🎬 REELS (30 дней)
━━━━━━━━━━━━━━
• ER: ${stats.reels.er?.toFixed(2) || 'н/д'}%
• Рекламные: ${stats.reels.ads}
• Средние:
👁 ${stats.reels.avgViews}
❤️ ${stats.reels.avgLikes}
💬 ${stats.reels.avgComments}
🔁 ${stats.reels.avgShares}

━━━━━━━━━━━━━━
🖼 ЛЕНТА (30 дней)
━━━━━━━━━━━━━━
• ER: ${stats.feed.er?.toFixed(2) || 'н/д'}%
• Рекламные: ${stats.feed.ads}
• Средние:
❤️ ${stats.feed.avgLikes}
💬 ${stats.feed.avgComments}
🔁 ${stats.feed.avgShares}

━━━━━━━━━━━━━━
🧠 ОЦЕНКА ДЛЯ РЕКЛАМОДАТЕЛЯ
━━━━━━━━━━━━━━
${analysis}`,
      mainKeyboard
    );

    await bot.sendMessage(chatId, '✅ Готово!', mainKeyboard);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, '⚠️ Ошибка анализа', mainKeyboard);
  }
});
