const logger = require('./functions/logger.js')
const { Client } = require('discord.js-selfbot-v13')
const { compareWithFolderImages } = require('./functions/compare.js')
const farm = require('./functions/farmServers.js')
const axios = require('axios')
const fs = require('node:fs')
const path = require('node:path')

// Config handling
let config
try {
    config = require('./config.js')
} catch {
    logger.error('No config file found.')
    process.exit()
}

if (!Array.isArray(config.token) || config.token.length === 0) {
    logger.error('Invalid or empty tokens array in config.')
    process.exit()
}

// Utility functions
function getRandomOffset() {
    return Math.floor(Math.random() * 2 * 60 * 60 * 1000) // 0-2 hours in ms
}

function getRandomFarmDuration(minHours, maxHours) {
    const minMs = minHours * 60 * 60 * 1000
    const maxMs = maxHours * 60 * 60 * 1000
    return Math.floor(Math.random() * (maxMs - minMs)) + minMs
}

function createBotInstance(token) {
    const client = new Client()
    client.config = { ...config, token } // Clone config with individual token
    
    let balls = 0 // Balls counter per instance

    client.once("ready", async (c) => {
        client.user.setStatus('invisible')
        logger.success(`Logged in as ${c.user.username} (${c.user.id})`)

        if (client.config.farmServers.length > 0) {
            const minFarmTime = client.config.sessionFarm[0]
            const maxFarmTime = client.config.sessionFarm[1]
            const scriptStartTime = new Date()
            const initialRandomOffset = getRandomOffset()
            const firstSessionStart = new Date(scriptStartTime.getTime() + initialRandomOffset)

            logger.info(`${c.user.username}: First farming session at ${firstSessionStart.toLocaleTimeString()}`)

            const startFarming = () => {
                const sessionStartTime = new Date()
                const randomDuration = getRandomFarmDuration(minFarmTime, maxFarmTime)
                logger.info(`${c.user.username}: Farming for ${randomDuration / (60 * 60 * 1000)} hours`)

                farm(client)
                const intervalId = setInterval(() => farm(client), client.config.farmSleepTime || 60 * 1000)

                setTimeout(() => {
                    clearInterval(intervalId)
                    logger.info(`${c.user.username}: Ended farming session`)
                    scheduleNextSession(sessionStartTime)
                }, randomDuration)
            }

            const scheduleNextSession = (previousSessionStart) => {
                const nextDayBase = new Date(previousSessionStart.getTime() + 24 * 60 * 60 * 1000)
                const nextDayOffset = getRandomOffset()
                const nextSessionStart = new Date(nextDayBase.getTime() + nextDayOffset)
                const timeUntilNext = nextSessionStart.getTime() - Date.now()
                
                if (timeUntilNext > 0) {
                    logger.info(`${c.user.username}: Next session at ${nextSessionStart.toLocaleTimeString()}`)
                    setTimeout(startFarming, timeUntilNext)
                } else {
                    startFarming()
                }
            }

            const initialWait = firstSessionStart.getTime() - Date.now()
            initialWait > 0 ? setTimeout(startFarming, initialWait) : startFarming()
        }
    })

    client.on("messageCreate", async (message) => {
        if (
            message.author.id === "999736048596816014" && 
            (client.config.whitelistedServers.length === 0 || [message.guild.id, message.guild.name].some(id => client.config.whitelistedServers.includes(id))) &&
            [message.guild.id, message.guild.name].some(item => !client.config.blacklistedServers.includes(item)) &&
            message.attachments.size === 1 &&
            message.components?.[0]?.components.length === 1
        ) {
            const time = Date.now()
            const img = message.attachments.first().url
            const name = await compareWithFolderImages(img)
            if (!name) return logger.info(`${client.user.username}: Ignored ball`)
            const edited = name.replace('.png.bin', '')

            if ((client.config.whitelistedBalls.length === 0 || client.config.whitelistedBalls.includes(edited)) &&
                !client.config.blacklistedBalls.includes(edited)) {
                
                const randomTimeout = Math.floor(Math.random() * (client.config.timeout[1] - client.config.timeout[0])) + client.config.timeout[0]

                setTimeout(async () => {
                    try {
                        const btn = await message.clickButton()
                        await btn.components[0].components[0].setValue(edited)
                        await btn.reply()
                        logger.success(`${client.user.username}: Caught ${edited} in ${((Date.now() - time)/1000).toFixed(1)}s`)
                    } catch {
                        setTimeout(async () => {
                            try {
                                const btn = await message.clickButton()
                                await btn.components[0].components[0].setValue(edited)
                                await btn.reply()
                                logger.success(`${client.user.username}: Retry caught ${edited}`)
                            } catch {}
                        }, 3000)
                    }
                }, randomTimeout)
            }
        }
    })

    client.on("messageUpdate", async (old, message) => {
        if (message.author.id !== "999736048596816014") return
        if (message.content.includes(`<@${client.user.id}>`)) {
            const match = message.content.match(/\*\*(.+?)!\*\* `\((#[A-F0-9]+), ([^`]+)\)`/)
            const emoji = message.content.match(/:(.*?):/)?.[1]
            logger.success(`${client.user.username}: Caught ${match[1]} in ${message.guild.name}`)
            balls++

            if (client.config.messageCooldown?.length && client.config.messages?.length && 
                ![message.guild.id, message.guild.name].some(id => client.config.farmServers.includes(id))) {
                
                const randomMessage = client.config.messages[Math.floor(Math.random() * client.config.messages.length)]
                const messageCooldown = Math.floor(Math.random() * (client.config.messageCooldown[1] - client.config.messageCooldown[0])) + client.config.messageCooldown[0]

                setTimeout(async () => {
                    await message.channel.sendTyping()
                    setTimeout(async () => {
                        await message.channel.send(randomMessage)
                        logger.success(`${client.user.username}: Sent message in ${message.guild.name}`)
                    }, messageCooldown)
                }, messageCooldown * 0.1)
            }

            try {
                if (client.config.dashboardToken) {
                    await axios.post('https://autocatcher.xyz/api/v1/submit', {
                        name: match[1],
                        stats: match[3],
                        id: match[2],
                        guild: message.guild.name,
                        guildid: message.guild.id,
                        channel: message.channel.name,
                        channelid: message.channel.id,
                        userid: client.user.id,
                        messageid: message.id,
                        emoji
                    }, { headers: { 'authorization': client.config.dashboardToken } })
                }
            } catch {}
        }
    })

    // Load extensions
    const extensionsDir = path.join(__dirname, 'extensions')
    const extensions = fs.readdirSync(extensionsDir).filter(f => f.endsWith('.js'))
    for (const file of extensions) {
        try {
            const ext = require(path.join(extensionsDir, file))
            if (ext.func && ext.name) {
                ext.func(client)
                logger.info(`${token.slice(-5)}: Loaded extension ${ext.name}`)
            }
        } catch (err) {
            logger.error(`Extension error (${file}): ${err.message}`)
        }
    }

    client.login(token).catch(err => {
        logger.error(`Login failed for token ${token.slice(-5)}: ${err.message}`)
    })
}

// Start all bot instances
config.token.forEach(createBotInstance)

// Error handling
const errorHandler = (err, origin) => logger.error(`Unhandled error: ${err.stack || err}\nOrigin: ${origin}`)
process.on('unhandledRejection', errorHandler)
process.on('uncaughtException', errorHandler)
process.on('uncaughtExceptionMonitor', errorHandler)
