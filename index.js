const fs = require("fs");
require("dotenv").config();
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TOKEN;
const ALERTS_FILE = "alerts.json";
const MIN_COOLDOWN = 10;
const CHECK_INTERVAL = 10000;

const bot = new TelegramBot(TOKEN, { polling: true });

// ─── Helpers ────────────────────────────────────────────────

function saveAlerts() {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

function getUserAlerts(chatId) {
  return alerts.filter(a => a.chatId === chatId);
}

function getRealIndex(chatId, userAlert) {
  return alerts.findIndex(
    a =>
      a.chatId === chatId &&
      a.symbol === userAlert.symbol &&
      a.target === userAlert.target &&
      a.condition === userAlert.condition
  );
}

async function getPrice(symbol) {
  try {
    const response = await axios.get(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
    );
    const price = parseFloat(response.data.price);
    console.log(`${symbol}: ${price}`);
    return price;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    return null;
  }
}

// ─── Load Alerts ────────────────────────────────────────────

let alerts = [];
try {
  alerts = JSON.parse(fs.readFileSync(ALERTS_FILE));
  console.log(`✅ Loaded ${alerts.length} alerts.`);
} catch {
  console.log("No alerts file found, starting fresh.");
}

// ─── Commands ───────────────────────────────────────────────
bot.on("message", (msg) => {
  const text = msg.text;

  if (text.startsWith("/")) return;

  bot.sendMessage(
    msg.chat.id,
    "❌ Unknown command. Type /help"
  );
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to CryptoAlert Bot!\n\n" +
    "I notify you when crypto prices hit your targets.\n\n" +
    "Type /help to see all commands."
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "📌 *Commands:*\n\n" +
    "*Set an alert:*\n" +
    "`/set BTCUSDT above 80000`\n" +
    "`/set ETHUSDT below 2000`\n\n" +
    "*Manage alerts:*\n" +
    "`/list` — view your alerts\n" +
    "`/delete 1` — delete alert #1\n" +
    "`/clearall` — delete all your alerts\n\n" +
    "*Customize alerts:*\n" +
    "`/repeat 1 on` — keep alerting after trigger\n" +
    "`/repeat 1 off` — alert once only\n" +
    "`/cooldown 1 60` — set cooldown in seconds\n\n" +
    "*Other:*\n" +
    "`/price BTCUSDT` — check current price",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/price (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase();

  const price = await getPrice(symbol);
  if (!price) {
    return bot.sendMessage(chatId, `❌ Symbol ${symbol} not found on Binance.`);
  }

  bot.sendMessage(chatId, `📊 ${symbol}: $${price}`);
});

bot.onText(/\/set (.+) (above|below) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase();
  const condition = match[2].toLowerCase();
  const target = parseFloat(match[3]);

  if (isNaN(target) || target <= 0) {
    return bot.sendMessage(chatId, "❌ Invalid price. Must be a positive number.");
  }

  const price = await getPrice(symbol);
  if (!price) {
    return bot.sendMessage(chatId, `❌ Symbol ${symbol} not found on Binance.`);
  }

  // warn user if condition is already met right now
  const alreadyMet =
    (condition === "above" && price >= target) ||
    (condition === "below" && price <= target);

  alerts.push({
    chatId,
    symbol,
    condition,
    target,
    alerted: false,
    repeat: false,
    cooldown: 5 * 60 * 1000, // default 5 minutes
    lastTriggered: 0
  });

  saveAlerts();

  bot.sendMessage(
    chatId,
    `✅ Alert set: *${symbol} ${condition} ${target}*\n` +
    `📊 Current price: $${price}` +
    (alreadyMet ? "\n\n⚠️ Note: condition is already met right now." : ""),
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const userAlerts = getUserAlerts(chatId);

  if (userAlerts.length === 0) {
    return bot.sendMessage(chatId, "📭 No alerts set. Use /set to create one.");
  }

  let message = "📌 *Your alerts:*\n\n";
  userAlerts.forEach((alert, index) => {
    const status = alert.alerted ? "✅ Done" : "🟡 Active";
    const repeat = alert.repeat ? "🔁 Repeat" : "1️⃣ Once";
    const cooldown = `⏱️ ${alert.cooldown / 1000}s`;
    message += `*${index + 1}.* ${alert.symbol} ${alert.condition} ${alert.target}\n`;
    message += `    ${status} | ${repeat} | ${cooldown}\n\n`;
  });

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;
  const userAlerts = getUserAlerts(chatId);

  if (!userAlerts[index]) {
    return bot.sendMessage(chatId, "❌ Invalid number. Use /list to see your alerts.");
  }

  const realIndex = getRealIndex(chatId, userAlerts[index]);
  if (realIndex === -1) {
    return bot.sendMessage(chatId, "❌ Alert not found.");
  }

  const deleted = userAlerts[index];
  alerts.splice(realIndex, 1);
  saveAlerts();

  bot.sendMessage(chatId, `🗑️ Deleted: *${deleted.symbol} ${deleted.condition} ${deleted.target}*`, { parse_mode: "Markdown" });
});

bot.onText(/\/clearall/, (msg) => {
  const chatId = msg.chat.id;
  const count = getUserAlerts(chatId).length;

  if (count === 0) {
    return bot.sendMessage(chatId, "📭 You have no alerts to clear.");
  }

  alerts = alerts.filter(a => a.chatId !== chatId);
  saveAlerts();

  bot.sendMessage(chatId, `🗑️ Cleared ${count} alert(s).`);
});

bot.onText(/\/repeat (\d+) (on|off)/, (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;
  const mode = match[2];
  const userAlerts = getUserAlerts(chatId);

  if (!userAlerts[index]) {
    return bot.sendMessage(chatId, "❌ Invalid number. Use /list to see your alerts.");
  }

  const realIndex = getRealIndex(chatId, userAlerts[index]);
  if (realIndex === -1) {
    return bot.sendMessage(chatId, "❌ Alert not found.");
  }

  alerts[realIndex].repeat = mode === "on";
  // if turning repeat back on, reset alerted so it can fire again
  if (mode === "on") alerts[realIndex].alerted = false;
  saveAlerts();

  bot.sendMessage(chatId, `🔁 Repeat *${mode === "on" ? "enabled" : "disabled"}* for alert ${match[1]}`, { parse_mode: "Markdown" });
});

bot.onText(/\/cooldown (\d+) (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;
  const seconds = parseInt(match[2]);
  const userAlerts = getUserAlerts(chatId);

  if (seconds < MIN_COOLDOWN) {
    return bot.sendMessage(chatId, `❌ Minimum cooldown is ${MIN_COOLDOWN} seconds.`);
  }

  if (!userAlerts[index]) {
    return bot.sendMessage(chatId, "❌ Invalid number. Use /list to see your alerts.");
  }

  const realIndex = getRealIndex(chatId, userAlerts[index]);
  if (realIndex === -1) {
    return bot.sendMessage(chatId, "❌ Alert not found.");
  }

  alerts[realIndex].cooldown = seconds * 1000;
  saveAlerts();

  bot.sendMessage(chatId, `⏱️ Cooldown set to *${seconds}s* for alert ${match[1]}`, { parse_mode: "Markdown" });
});

// ─── Price Check Loop ────────────────────────────────────────

setInterval(async () => {
  const now = Date.now();

  // ✅ Get all unique symbols from active alerts only
  const uniqueSymbols = [...new Set(
    alerts.filter(a => !a.alerted).map(a => a.symbol)
  )];

  // ✅ Fetch each symbol once
  const prices = {};

await Promise.all(
  uniqueSymbols.map(async (symbol) => {
    const price = await getPrice(symbol);
    if (price) prices[symbol] = price;
  })
);

  // ✅ Now check all alerts using cached prices
  for (let alert of alerts) {
    if (alert.alerted) continue;

    const price = prices[alert.symbol];
    if (!price) continue;

    const conditionMet =
      (alert.condition === "above" && price >= alert.target) ||
      (alert.condition === "below" && price <= alert.target);

    if (!conditionMet) continue;
    if (now - alert.lastTriggered < alert.cooldown) continue;

    bot.sendMessage(
      alert.chatId,
      `🚨 *${alert.symbol} ${alert.condition} ${alert.target}*\n📊 Now: $${price}`,
      { parse_mode: "Markdown" }
    );

    alert.lastTriggered = now;
    if (!alert.repeat) alert.alerted = true;

    saveAlerts();
  }
}, CHECK_INTERVAL);