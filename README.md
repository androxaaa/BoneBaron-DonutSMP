# 🦴 BoneBaron

> Automated DonutSMP farming bot powered by Mineflayer & Discord.

---

## ✨ Features

✅ Auto collect Bones & Arrows
✅ Auto fulfill `/order bones` and `/order arrows`
✅ Auto pay earnings to your main account
✅ Discord controls
✅ Profit tracking
✅ Auto reconnect after disconnects
✅ Stealth protection system
✅ Player whitelist support

---

## 📦 Installation

Clone repository:

```bash
git clone https://github.com/androxaaa/BoneBaron-DonutSMP
cd BoneBaron-DonutSMP
```

Install dependencies:

```bash
npm install
```

---

## 🤖 Discord Bot Setup

### 1. Create a Discord Application

Go to:

```txt
https://discord.com/developers/applications
```

Create a new application.

---

### 2. Create a Bot

Open the **Bot** tab and click:

```txt
Add Bot
```

Enable:

```txt
MESSAGE CONTENT INTENT
```

Copy the bot token.

---

### 3. Invite Bot to Your Server

Open:

```txt
OAuth2 → URL Generator
```

Select:

```txt
bot
```

Permissions:

```txt
View Channels
Send Messages
Read Message History
```

Invite the bot to your Discord server.

---

### 4. Get IDs

Enable Discord Developer Mode.

Copy:

* Channel ID
* Your User ID

Put them in `.env`.

---

## ⚙️ Configuration

Create a `.env` file:

```env
# Minecraft
MC_HOST=
MC_PORT=25565
MC_USERNAME=
MC_AUTH=microsoft
MC_VERSION=1.21.1

# Discord
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=
DISCORD_OWNER_ID=

# Orders
BONE_ORDER_COMMAND=/order bones
ARROW_ORDER_COMMAND=/order arrows

# Automation
CYCLE_MS=300000
MIN_FREE_SLOTS=2

# Economy
PAYOUT_TO=[Main IGN]
MAX_BALANCE=15000
```

---

## 🎮 Commands

### Automation

| Command          | Description                         |
| ---------------- | ----------------------------------- |
| `!status`        | Show bot status                     |
| `!profits`       | Show profit statistics              |
| `!bonecycle`     | Run one collection + delivery cycle |
| `!autobones on`  | Start automatic farming             |
| `!autobones off` | Stop automatic farming              |

### Stealth

| Command                      | Description                  |
| ---------------------------- | ---------------------------- |
| `!stealth on`                | Enable stealth protection    |
| `!stealth off`               | Disable stealth protection   |
| `!whitelist add <player>`    | Add player to whitelist      |
| `!whitelist remove <player>` | Remove player from whitelist |
| `!whitelist list`            | Show whitelisted players     |
| `!stealthstatus`             | Show stealth status          |

---

## 🛡️ Stealth Protection

BoneBaron includes a stealth system designed for AFK farming.

When enabled:

✅ Detects nearby players
✅ Ignores whitelisted players
✅ Monitors suspicious activity
✅ Stops automation automatically
✅ Disconnects immediately when a threat is detected

### Example

Whitelist yourself:

```txt
!whitelist add [IGN]
```

Enable stealth:

```txt
!stealth on
```

---

### ⚠️ Important

If a **non-whitelisted player** enters the detection radius:

1. Automation stops immediately
2. Emergency protection triggers
3. Bot disconnects from the Minecraft server

This helps prevent farm discovery and reduces the risk of staff or players finding the bot.

---

## 👥 Whitelist

Whitelisted players never trigger stealth protection.

Example:

```txt
!whitelist add YourName
!whitelist add FriendName
```

View whitelist:

```txt
!whitelist list
```

Remove a player:

```txt
!whitelist remove FriendName
```

---

## 📊 Statistics Tracked

* 💰 Current Balance
* 📈 Session Profit
* 🕒 Hourly Profit
* 📅 Daily Profit
* 🦴 Bone Sales
* 🏹 Arrow Sales

---

## 💰 Estimated Daily Profit (24/7)

* 1 Spawner      → $90,000/day
* 10 Spawners    → $900,000/day
* 100 Spawners   → $9,000,000/day
* 1,000 Spawners → $90,000,000/day

---

## 🚀 Running

Start the bot:

```bash
node index.js
```

---

## ⚠️ Disclaimer

This project is provided for educational purposes only.

Use responsibly.
