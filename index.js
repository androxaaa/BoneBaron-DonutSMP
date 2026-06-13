require('dotenv').config()

const mineflayer = require('mineflayer')
const { Client, GatewayIntentBits } = require('discord.js')

function getMcVersion () {
  const v = process.env.MC_VERSION
  if (!v || v === 'false' || v === 'auto') return false
  return v
}

const config = {
  mc: {
    host: process.env.MC_HOST,
    port: Number(process.env.MC_PORT || 25565),
    username: process.env.MC_USERNAME,
    auth: process.env.MC_AUTH || 'microsoft',
    version: getMcVersion()
  },
  discord: {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID,
    ownerId: process.env.DISCORD_OWNER_ID
  },
  cycle: {
    everyMs: Number(process.env.CYCLE_MS || 300000),
    minFreeSlotsAfterTakingItems: Number(process.env.MIN_FREE_SLOTS || 2)
  },
  orders: {
    bone: {
      command: process.env.BONE_ORDER_COMMAND || '/order bones',
      item: 'bone'
    },
    arrow: {
      command: process.env.ARROW_ORDER_COMMAND || '/order arrows',
      item: 'arrow'
    }
  },
  economy: {
    payoutTo: process.env.PAYOUT_TO || null,
    maxBalance: Number(process.env.MAX_BALANCE || 15000)
  },
  stealth: {
    enabled: process.env.STEALTH_ENABLED === 'true',
    radius: Number(process.env.STEALTH_RADIUS || 20),
    whitelist: (process.env.STEALTH_WHITELIST || '')
      .split(',')
      .map(x => x.trim().toLowerCase())
      .filter(Boolean)
  }
}

const state = {
  bot: null,
  discord: null,

  balance: 0,
  busy: false,
  reconnecting: false,

  autoBonesEnabled: false,
  autoBonesTimer: null,

  lastDeliveryIncome: 0,
  sessionProfit: 0,
  hourlyProfit: 0,
  dailyProfit: 0,
  totalBoneSales: 0,
  totalArrowSales: 0,

  hourlyTimer: null,
  dailyTimer: null,

  stealthAlerted: false
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function strip (text) {
  return String(text)
    .replace(/§./g, '')
    .replace(/[^\x20-\x7E]/g, '')
}

function parseNumberWithSuffix (num, suffix) {
  let value = Number(String(num).replace(/,/g, ''))

  suffix = suffix?.toLowerCase()

  if (suffix === 'k') value *= 1000
  if (suffix === 'm') value *= 1000000
  if (suffix === 'b') value *= 1000000000

  return Math.floor(value)
}

function money (value) {
  if (value === null || value === undefined) return 'N/A'
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}b`
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return `${Math.floor(value)}`
}

function notify (text) {
  const channel = state.discord?.channels?.cache?.get(config.discord.channelId)
  if (channel) channel.send(text).catch(console.error)
}

function windowTitleText (window) {
  return JSON.stringify(window?.title || '').toLowerCase()
}

function countInventoryItem (itemName) {
  const bot = state.bot
  if (!bot || !bot.inventory) return 0

  return bot.inventory.items()
    .filter(item => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0)
}

function getEmptyInventorySlots () {
  const bot = state.bot
  if (!bot || !bot.inventory) return 0

  if (typeof bot.inventory.emptySlotCount === 'function') {
    return bot.inventory.emptySlotCount()
  }

  let empty = 0

  for (let slot = bot.inventory.inventoryStart; slot < bot.inventory.inventoryEnd; slot++) {
    if (!bot.inventory.slots[slot]) empty++
  }

  return empty
}

async function closeAllWindows () {
  const bot = state.bot
  if (!bot) return

  for (let i = 0; i < 5; i++) {
    if (!bot.currentWindow) break

    try {
      bot.closeWindow(bot.currentWindow)
    } catch {}

    await sleep(300)
  }
}

async function closeWindowTwice () {
  const bot = state.bot
  if (!bot) return

  for (let i = 0; i < 2; i++) {
    if (bot.currentWindow) {
      try {
        bot.closeWindow(bot.currentWindow)
      } catch {}
    }

    await sleep(500)
  }
}

function waitForNextWindow (timeoutMs = 5000) {
  const bot = state.bot

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.removeListener('windowOpen', onWindow)
      reject(new Error('Timed out waiting for next window'))
    }, timeoutMs)

    function onWindow (window) {
      clearTimeout(timeout)
      bot.removeListener('windowOpen', onWindow)
      resolve(window)
    }

    bot.on('windowOpen', onWindow)
  })
}

function dumpWindow (window) {
  console.log('\n[WINDOW]', strip(JSON.stringify(window.title)))
  console.log(`inventoryStart: ${window.inventoryStart}`)

  for (let slot = 0; slot < window.slots.length; slot++) {
    const item = window.slots[slot]
    if (!item) continue

    console.log({
      slot,
      name: item.displayName,
      mcName: item.name,
      count: item.count
    })
  }
}

async function updateBalance () {
  if (!state.bot) return state.balance

  state.bot.chat('/balance')
  await sleep(1200)

  return state.balance
}

function parseBalance (msg) {
  let match = msg.match(/You have \$?([\d,.]+)\s*([kmb])?/i)

  if (!match) {
    match = msg.match(/(?:balance|money):\s*\$?([\d,.]+)\s*([kmb])?/i)
  }

  if (!match) return

  state.balance = parseNumberWithSuffix(match[1], match[2])
  console.log('[BALANCE]', state.balance)
}

function addProfit (amount) {
  state.sessionProfit += amount
  state.hourlyProfit += amount
  state.dailyProfit += amount
}

async function sendIncomeToOwner (amount) {
  const bot = state.bot
  if (!bot) return false

  const recipient = config.economy.payoutTo
  const rounded = Math.floor(amount)

  if (!recipient) {
    console.log('[INCOME PAYOUT] No PAYOUT_TO set in .env.')
    return false
  }

  if (!rounded || rounded <= 0) {
    console.log('[INCOME PAYOUT] No amount to send.')
    return false
  }

  await closeAllWindows()
  await sleep(700)

  const cmd = `/pay ${recipient} ${rounded}`

  console.log('[INCOME PAYOUT] Sending:', cmd)

  bot.chat(cmd)

  notify(`💸 Sent income payout: ${money(rounded)} to ${recipient}`)

  await sleep(3500)

  return true
}

async function parseDeliveryIncome (msg) {
  const match = msg.match(
    /You delivered ([\d,.]+) .* and received \$?([\d,.]+)\s*([kmb])?/i
  )

  if (!match) return

  state.lastDeliveryIncome = parseNumberWithSuffix(match[2], match[3])
  addProfit(state.lastDeliveryIncome)

  notify(`💰 Income: +${money(state.lastDeliveryIncome)}`)

  await sleep(1200)
  await sendIncomeToOwner(state.lastDeliveryIncome)
  await sleep(3500)
  await closeAllWindows()
}

async function openNearestSpawner () {
  const bot = state.bot

  await closeAllWindows()

  const block = bot.findBlock({
    matching: b => b && b.name === 'spawner',
    maxDistance: 6
  })

  if (!block) throw new Error('No nearby spawner found.')

  await bot.activateBlock(block)

  return waitForNextWindow(5000)
}

async function takeItemFromSpawner (itemName) {
  const bot = state.bot
  const window = bot.currentWindow || await waitForNextWindow(5000)

  let taken = 0

  for (let slot = 0; slot < window.inventoryStart; slot++) {
    const item = window.slots[slot]
    if (!item) continue
    if (item.name !== itemName) continue

    if (getEmptyInventorySlots() <= config.cycle.minFreeSlotsAfterTakingItems) {
      console.log('[AUTO] Stopped taking items to keep free space.')
      break
    }

    await bot.clickWindow(slot, 0, 1)
    taken++
    await sleep(400)
  }

  return taken
}

async function moveItemsIntoDelivery (itemName) {
  const bot = state.bot
  let moved = 0

  while (true) {
    const currentWindow = bot.currentWindow
    if (!currentWindow) break

    const title = windowTitleText(currentWindow)

    if (!title.includes('deliver items')) {
      console.log(`[ORDER] Stopped moving because current window is not Deliver Items: ${title}`)
      break
    }

    const start = currentWindow.inventoryStart ?? 36

    const slot = currentWindow.slots.findIndex((item, index) =>
      index >= start &&
      item &&
      item.name === itemName
    )

    if (slot === -1) break

    try {
      console.log(`[ORDER] Moving ${itemName} from slot ${slot}`)
      await bot.clickWindow(slot, 0, 1)
      moved++
      await sleep(700)
    } catch (err) {
      console.log(`[ORDER] Failed to click ${itemName} slot ${slot}: ${err.message}`)
      break
    }
  }

  return moved
}

async function fillOneOrder (itemName, options = {}) {
  const bot = state.bot
  const setBusy = !options.internal
  const cfg = config.orders[itemName]

  state.lastDeliveryIncome = 0

  if (!cfg) throw new Error(`No order config for ${itemName}`)

  if (setBusy) {
    if (state.busy) return notify('⚠️ Bot is already busy.')
    state.busy = true
  }

  try {
    await closeAllWindows()

    if (countInventoryItem(itemName) <= 0) {
      console.log(`[ORDER] No ${itemName} in inventory.`)
      return false
    }

    const beforeCount = countInventoryItem(itemName)

    console.log(`[ORDER] Opening ${cfg.command}`)

    const orderWindowPromise = waitForNextWindow(12000)
    bot.chat(cfg.command)

    try {
      await orderWindowPromise
    } catch {
      notify(`⚠️ No ${itemName} order window opened. Skipping ${itemName}.`)
      return false
    }

    await sleep(700)

    console.log('[ORDER] Clicking first order slot 0')

    try {
      await bot.clickWindow(0, 0, 0)
    } catch (err) {
      console.log(`[ORDER] Failed to click order slot 0: ${err.message}`)
      await closeAllWindows()
      return false
    }

    let deliverWindow

    try {
      deliverWindow = await waitForNextWindow(12000)
    } catch {
      notify(`⚠️ No ${itemName} delivery window opened.`)
      await closeAllWindows()
      return false
    }

    await sleep(800)

    const deliverTitle = windowTitleText(deliverWindow)

    if (!deliverTitle.includes('deliver items')) {
      console.log(`[ORDER] Expected Deliver Items window, got: ${deliverTitle}`)
      await closeAllWindows()
      return false
    }

    const moved = await moveItemsIntoDelivery(itemName)

    if (moved <= 0) {
      console.log(`[ORDER] No ${itemName} moved.`)
      await closeAllWindows()
      return false
    }

    await sleep(700)

    console.log('[ORDER] Closing Deliver Items window with ESC.')

    try {
      bot.closeWindow(bot.currentWindow || deliverWindow)
    } catch {}

    let confirmWindow

    try {
      confirmWindow = await waitForNextWindow(12000)
    } catch {
      notify(`⚠️ No ${itemName} confirm window opened.`)
      await closeAllWindows()
      return false
    }

    await sleep(800)

    const confirmTitle = windowTitleText(confirmWindow)

    if (!confirmTitle.includes('confirm delivery')) {
      console.log(`[ORDER] Expected Confirm Delivery window, got: ${confirmTitle}`)
    }

    const confirmSlot = 15

    console.log(`[ORDER] Clicking green confirm pane slot ${confirmSlot}`)

    try {
      await bot.clickWindow(confirmSlot, 0, 0)
    } catch (err) {
      console.log(`[ORDER] Confirm click failed: ${err.message}`)
      await closeAllWindows()
      return false
    }

    await sleep(2500)

    console.log('[ORDER] Closing all GUIs after confirm.')

    await closeWindowTwice()
    await sleep(1200)

    const afterCount = countInventoryItem(itemName)

    if (!state.lastDeliveryIncome && afterCount >= beforeCount) {
      console.log(`[ORDER] ${itemName} order may not have completed. No inventory decrease detected.`)
      return false
    }

    return true
  } finally {
    if (setBusy) state.busy = false
    await closeAllWindows()
  }
}

async function fillOrdersUntilEmpty (itemName) {
  let filled = 0

  while (countInventoryItem(itemName) > 0) {
    const before = countInventoryItem(itemName)

    const success = await fillOneOrder(itemName, { internal: true })

    const after = countInventoryItem(itemName)

    if (!success || after >= before) break

    filled++

    if (itemName === 'bone') state.totalBoneSales++
    if (itemName === 'arrow') state.totalArrowSales++

    await sleep(4000)

    if (filled > 30) break
  }

  notify(`📋 Filled ${filled} ${itemName} order(s).`)
}

function startAutoBonesLoop () {
  if (state.autoBonesTimer) clearInterval(state.autoBonesTimer)

  state.autoBonesTimer = setInterval(async () => {
    if (!state.autoBonesEnabled) return
    if (state.busy) return

    await runBoneCycle()
  }, config.cycle.everyMs)
}

async function runBoneCycle () {
  if (state.busy) return

  state.busy = true

  try {
    notify('🦴 Auto cycle started.')

    await closeAllWindows()

    await openNearestSpawner()
    await sleep(800)

    const bonesTaken = await takeItemFromSpawner('bone')
    const arrowsTaken = await takeItemFromSpawner('arrow')

    console.log(`[AUTO] Bones taken: ${bonesTaken}`)
    console.log(`[AUTO] Arrows taken: ${arrowsTaken}`)

    await closeAllWindows()

    if (countInventoryItem('bone') > 0) {
      await fillOrdersUntilEmpty('bone')
    }

    if (countInventoryItem('arrow') > 0) {
      await fillOrdersUntilEmpty('arrow')
    }

    notify([
      '✅ Auto cycle finished.',
      `Bones taken: ${bonesTaken}`,
      `Arrows taken: ${arrowsTaken}`
    ].join('\n'))
  } catch (err) {
    console.error(err)
    notify(`❌ Auto cycle error: ${err.message}`)
  } finally {
    state.busy = false
    await closeAllWindows()
  }
}

function startProfitReports () {
  if (state.hourlyTimer) clearInterval(state.hourlyTimer)
  if (state.dailyTimer) clearInterval(state.dailyTimer)

  state.hourlyTimer = setInterval(async () => {
    await updateBalance()

    notify([
      '📈 Hourly Report',
      `Profit: ${money(state.hourlyProfit)}`,
      `Balance: ${money(state.balance)}`,
      `Session Profit: ${money(state.sessionProfit)}`
    ].join('\n'))

    state.hourlyProfit = 0
  }, 60 * 60 * 1000)

  state.dailyTimer = setInterval(async () => {
    await updateBalance()

    notify([
      '📊 Daily Report',
      `24h Profit: ${money(state.dailyProfit)}`,
      `Current Balance: ${money(state.balance)}`,
      `Session Profit: ${money(state.sessionProfit)}`,
      `Bone Sales: ${state.totalBoneSales}`,
      `Arrow Sales: ${state.totalArrowSales}`
    ].join('\n'))

    state.dailyProfit = 0
    state.totalBoneSales = 0
    state.totalArrowSales = 0
  }, 24 * 60 * 60 * 1000)
}

function checkForNearbyPlayers () {
  const bot = state.bot
  if (!bot || !config.stealth.enabled || state.stealthAlerted) return

  const threats = Object.values(bot.entities).filter(e =>
    e.type === 'player' &&
    e.username !== bot.username &&
    !config.stealth.whitelist.includes(String(e.username || '').toLowerCase()) &&
    e.position.distanceTo(bot.entity.position) < config.stealth.radius
  )

  if (threats.length > 0) {
    const names = threats.map(p => p.username).join(', ')
    state.stealthAlerted = true

    console.log(`[STEALTH] Non-whitelisted player detected: ${names}`)
    notify(`⚠️ Non-whitelisted player nearby: ${names}. Disconnecting.`)

    state.autoBonesEnabled = false

    if (state.autoBonesTimer) {
      clearInterval(state.autoBonesTimer)
      state.autoBonesTimer = null
    }

    setTimeout(() => {
      process.kill(process.pid, 'SIGINT')
    }, 750)
  }
}

function startStealthWatcher () {
  if (!config.stealth.enabled) return

  console.log('[STEALTH] Enabled from .env')
  console.log('[STEALTH] Whitelist:', config.stealth.whitelist.join(', ') || 'empty')

  setInterval(() => {
    try {
      checkForNearbyPlayers()
    } catch (err) {
      console.log('[STEALTH ERROR]', err.message)
    }
  }, 1500)
}

function startDiscordBot () {
  state.discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  state.discord.once('ready', () => {
    console.log(`[DISCORD] Logged in as ${state.discord.user.tag}`)
  })

  state.discord.on('messageCreate', async msg => {
    if (msg.author.bot) return
    if (config.discord.ownerId && msg.author.id !== config.discord.ownerId) return

    const cmd = msg.content.trim()

    try {
      if (cmd === '!status') {
        return msg.reply([
          `MC Version: ${config.mc.version || 'auto'}`,
          `Balance: ${money(state.balance)}`,
          `Bones: ${countInventoryItem('bone')}`,
          `Arrows: ${countInventoryItem('arrow')}`,
          `Last income: ${money(state.lastDeliveryIncome)}`,
          `Session profit: ${money(state.sessionProfit)}`,
          `AutoBones: ${state.autoBonesEnabled ? 'ON' : 'OFF'}`,
          `Busy: ${state.busy}`
        ].join('\n'))
      }

      if (cmd === '!profits') {
        return msg.reply([
          `Session Profit: ${money(state.sessionProfit)}`,
          `Hourly Profit: ${money(state.hourlyProfit)}`,
          `Daily Profit: ${money(state.dailyProfit)}`,
          `Balance: ${money(state.balance)}`,
          `Bone Sales: ${state.totalBoneSales}`,
          `Arrow Sales: ${state.totalArrowSales}`
        ].join('\n'))
      }

      if (cmd === '!bonecycle') {
        msg.reply('Running one AutoBones cycle.')
        await runBoneCycle()
        return
      }

      if (cmd === '!autobones on') {
        state.autoBonesEnabled = true
        startAutoBonesLoop()
        msg.reply('AutoBones enabled. Running now, then every cycle interval.')
        await runBoneCycle()
        return
      }

      if (cmd === '!autobones off') {
        state.autoBonesEnabled = false

        if (state.autoBonesTimer) clearInterval(state.autoBonesTimer)
        state.autoBonesTimer = null

        return msg.reply('AutoBones disabled.')
      }
    } catch (err) {
      console.error(err)
      notify(`❌ Error: ${err.message}`)
      msg.reply(`Error: ${err.message}`)
      state.busy = false
    }
  })

  return state.discord.login(config.discord.token)
}

function startMinecraftBot () {
  state.reconnecting = false

  console.log(`[MC] Connecting with version: ${config.mc.version || 'auto'}`)

  state.bot = mineflayer.createBot({
    host: config.mc.host,
    port: config.mc.port,
    username: config.mc.username,
    auth: config.mc.auth,
    version: config.mc.version,
    hideErrors: false
  })

  state.bot.once('spawn', () => {
    console.log('[MC] Bot spawned')
    notify('✅ Minecraft bot connected.')
    state.bot.chat('/balance')
    startStealthWatcher()
  })

  state.bot.on('message', async jsonMsg => {
    const msg = strip(jsonMsg.toString())

    console.log('[CHAT]', msg)

    parseBalance(msg)
    await parseDeliveryIncome(msg)
  })

  state.bot.on('windowOpen', window => {
    dumpWindow(window)
  })

  state.bot.on('kicked', reason => {
    console.log('[MC KICKED]', reason)
    notify(`⚠️ Bot kicked: ${JSON.stringify(reason)}`)
  })

  state.bot.on('error', err => {
    console.error('[MC ERROR]', err.message)
    notify(`❌ Minecraft error: ${err.message}`)
  })

  state.bot.on('end', () => {
    if (state.reconnecting) return

    state.reconnecting = true

    notify('⚠️ Minecraft bot disconnected. Reconnecting in 15s.')

    setTimeout(startMinecraftBot, 15000)
  })
}

process.on('SIGINT', async () => {
  console.log('[SYSTEM] Shutdown requested.')

  try {
    state.autoBonesEnabled = false

    if (state.autoBonesTimer) clearInterval(state.autoBonesTimer)
    if (state.hourlyTimer) clearInterval(state.hourlyTimer)
    if (state.dailyTimer) clearInterval(state.dailyTimer)

    if (state.bot) {
      try {
        await closeAllWindows()
      } catch {}

      try {
        state.bot.quit('Shutdown')
      } catch {}
    }

    notify('🛑 Bot shutting down.')
  } catch (err) {
    console.error(err)
  }

  setTimeout(() => process.exit(0), 1000)
})

startDiscordBot()
startMinecraftBot()
startProfitReports()
