import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/* ================= INIT ================= */

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ================= UTILS ================= */

function extractUsername(text) {
  const match = text.match(/instagram\.com\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function isAd(caption = '') {
  const keys = ['#ad', '#ads', '#реклама', 'реклама', 'collab', 'партнер'];
  const t = caption.toLowerCase();
  return keys.some(k => t.includes(k));
}

/* ================= APIFY ================= */

async function fetchInstagramProfile(username) {
  const url =
    'https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items';

  const { data } = await axios.post(
    `${url}?token=${process.env.APIFY_TOKEN}`,
    { usernames: [username] },
    { timeout: 120000 }
  );

  if (!data || !data.length) throw new Error('Профиль не найден');

  const profile = data[0];
  const followers = profile.followersCount || 0;
  const postsTotal = profile.postsCount || 0;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let postsLast30 = 0;

  /* ===== REELS ===== */
  let reels = {
    count: 0,
    ads: 0,
    engagement: 0,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  };

  /* ===== FEED ===== */
  let feed = {
    count: 0,
    ads: 0,
    engagement: 0,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  };

  for (const post of profile.latestPosts || []) {
    const time = new Date(post.timestamp).getTime();
    if (time < cutoff) continue;

    postsLast30++;

    const likes = post.likesCount || 0;
    const comments = post.commentsCount || 0;
    const shares = post.sharesCount || 0;
    const saves = post.savesCount || 0;
    const views = post.videoViewCount || 0;

    const engagement = likes + comments + shares + saves;

    if (post.type === 'Video') {
      reels.count++;
      reels.engagement += engagement;
      reels.views += views;
      reels.likes += likes;
      reels.comments += comments;
      reels.shares += shares;
      if (isAd(post.caption)) reels.ads++;
    } else {
      feed.count++;
      feed.engagement += engagement;
      feed.views += views;
      feed.likes += likes;
      feed.comments += comments;
      feed.shares += shares;
      if (isAd(post.caption)) feed.ads++;
    }
  }

  const calcBlock = (b) => ({
    count: b.count,
    ads: b.ads,
    er: b.count && followers ? ((b.engagement / b.count) / followers) * 100 : null,
    avgViews: b.count ? Math.round(b.views / b.count) : 0,
    avgLikes: b.count ? Math.round(b.likes / b.count) : 0,
    avgComments: b.count ? Math.round(b.comments / b.count) : 0,
    avgShares: b.count ? Math.round(b.shares / b.count) : 0,
  });

  /* ===== AUDIENCE (пока н/д) ===== */
  const audience = {
    geo: 'н/д',
    gender: 'н/д',
    age: 'н/д',
    realFollowers: 'н/д',
  };

  return {
    followers,
    postsTotal,
    postsLast30,
    reels: calcBlock(reels),
    feed: calcBlock(feed),
    audience,
  };
}

/* ================= GPT ================= */

async function analyzeWithGPT(stats) {
  const prompt = `
Instagram аналитика

Подписчики: ${stats.followers}

REELS (30 дней):
ER: ${stats.reels.er?.toFixed(2) || 'н/д'}%
Средние:
Просмотры ${stats.reels.avgViews}
Лайки ${stats.reels.avgLikes}
Комментарии ${stats.reels.avgComments}
Репосты ${stats.reels.avgShares}

ЛЕНТА (30 дней):
ER: ${stats.feed.er?.toFixed(2) || 'н/д'}%
Средние:
Лайки ${stats.feed.avgLikes}
Комментарии ${stats.feed.avgComments}
Репосты ${stats.feed.avgShares}

Сделай краткий вывод:
1. Качество контента
2. Где рост быстрее — Reels или лента
3. Рекомендации
`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
  });

  return res.choices[0].message.content;
}

/* ================= BOT ================= */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const username = extractUsername(text);
  if (!username) {
    await bot.sendMessage(chatId, '❌ Пришли ссылку на Instagram');
    return;
  }

  await bot.sendMessage(chatId, '🔍 Анализирую аккаунт...');

  try {
    const stats = await fetchInstagramProfile(username);
    const analysis = await analyzeWithGPT(stats);

    await bot.sendMessage(
      chatId,
`📊 Instagram: @${username}

━━━━━━━━━━━━━━
👥 АУДИТОРИЯ
━━━━━━━━━━━━━━
🌍 Топ гео: ${stats.audience.geo}
🚻 Пол: ${stats.audience.gender}
🎂 Средний возраст: ${stats.audience.age}
🤖 Живые подписчики: ${stats.audience.realFollowers}

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

🧠 Анализ:
${analysis}`
    );

    await bot.sendMessage(chatId, '✅ Готово!\n📎 Пришли следующую ссылку');
  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, '⚠️ Ошибка анализа');
  }
});


