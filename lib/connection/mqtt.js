/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const crypto = require('crypto')
const mqtt = require('mqtt')
const pTimeout = require('p-timeout')

module.exports = class connectionMQTT {
  constructor (platform, accessory) {
    this.accessory = accessory
    this.clientResponseTopic = null
    this.funcs = platform.funcs
    this.key = platform.accountDetails.key
    this.lang = platform.lang
    this.log = platform.log
    this.name = accessory.displayName
    this.platform = platform
    this.queuedCommands = []
    this.status = 'init'
    this.token = platform.accountDetails.token
    this.userid = platform.accountDetails.userid
    this.uuid = accessory.context.serialNumber
    this.waitingMessageIds = {}
  }

  connect () {
    const appId = crypto
      .createHash('md5')
      .update('API' + this.accessory.UUID)
      .digest('hex')
    this.client = mqtt.connect({
      protocol: 'mqtts',
      host: this.accessory.context.domain || 'eu-iot.meross.com',
      port: 2001,
      clientId: 'app:' + appId,
      username: this.userid,
      password: crypto
        .createHash('md5')
        .update(this.userid + this.key)
        .digest('hex'),
      rejectUnauthorized: true,
      keepalive: 30,
      reconnectPeriod: 5000
    })

    this.client.on('connect', () => {
      this.client.subscribe('/app/' + this.userid + '/subscribe', err => {
        if (err) {
          this.log.warn('[%s] mqtt subscribe error - %s.', this.name, err)
        }
      })

      this.clientResponseTopic = '/app/' + this.userid + '-' + appId + '/subscribe'
      this.client.subscribe(this.clientResponseTopic, err => {
        if (err) {
          this.log.warn('[%s] mqtt user-response subscribe error - %s.', this.name, err)
        }
        if (this.accessory.context.enableDebugLogging) {
          this.log('[%s] mqtt subscribe complete.', this.name)
        }
      })
      this.status = 'online'
      while (this.queuedCommands.length > 0) {
        const resolveFn = this.queuedCommands.pop()
        if (typeof resolveFn === 'function') {
          resolveFn()
        }
      }
    })

    this.client.on('message', (topic, msg) => {
      if (!msg) {
        return
      }
      const decMsg = JSON.parse(msg.toString())
      if (decMsg.header.from && !decMsg.header.from.includes(this.uuid)) {
        return
      }

      // If message is the RESP for a previous action,
      // process return the control to the 'stopped' method.
      const resolveForThisMessage = this.waitingMessageIds[decMsg.header.messageId]
      if (typeof resolveForThisMessage === 'function') {
        resolveForThisMessage({ data: decMsg })
        delete this.waitingMessageIds[decMsg.header.messageId]
      } else if (decMsg.header.method === 'PUSH') {
        // Otherwise process it accordingly
        if (this.accessory.control && this.accessory.control.receiveUpdate && decMsg.payload) {
          this.accessory.control.receiveUpdate(decMsg)
        }
      }
    })
    this.client.on('error', error => {
      this.log.warn(
        '[%s] mqtt connection error%s.',
        this.name,
        error ? ' [' + error.toString() + ']' : ''
      )
    })
    this.client.on('close', error => {
      this.log.warn(
        '[%s] mqtt connection closed%s.',
        this.name,
        error ? ' [' + error.toString() + ']' : ''
      )
      this.status = 'offline'
    })
    this.client.on('reconnect', () => {
      this.log.warn('[%s] mqtt connection reconnecting.', this.name)
      this.status = 'offline'
    })
  }

  disconnect () {
    this.client.end(true)
  }

  async sendUpdate (toSend) {
    // Timeout shorter for get updates than set updates
    const timeout = toSend.method === 'GET' ? 4000 : 9000
    // Helper to queue commands before the device is connected
    if (this.status !== 'online') {
      let connectResolve

      // We create a idle promise - connectPromise
      const connectPromise = new Promise(resolve => {
        connectResolve = resolve
      })

      // connectPromise will get resolved when the device connects
      this.queuedCommands.push(connectResolve)
      // when the device is connected, the futureCommand will be executed
      // that is exactly the same command issued now, but in the future
      const futureCommand = () => this.sendUpdate(toSend)
      // we return immediately an 'idle' promise, that when it gets resolved
      // it will then execute the futureCommand
      // IF the above takes too much time, the command will fail with a TimeoutError
      return pTimeout(connectPromise.then(futureCommand), timeout)
    }

    let commandResolve
    // create of an waiting Promise, it will get (maybe) resolved if the device
    // responds in time
    const commandPromise = new Promise(resolve => {
      commandResolve = resolve
    })

    // if not subscribed und so ...
    const messageId = crypto
      .createHash('md5')
      .update(this.funcs.generateRandomString(16))
      .digest('hex')
    const timestamp = Math.round(new Date().getTime() / 1000)

    const data = {
      header: {
        from: this.clientResponseTopic,
        messageId,
        method: toSend.method,
        namespace: toSend.namespace,
        payloadVersion: 1,
        sign: crypto
          .createHash('md5')
          .update(messageId + this.key + timestamp)
          .digest('hex'),
        timestamp
      },
      payload: toSend.payload || {}
    }

    // Log the send if in debug mode
    if (this.accessory.context.enableDebugLogging) {
      this.log('[%s] %s: %s.', this.name, this.lang.sendMQTT, JSON.stringify(data))
    }

    // Send the message
    this.client.publish('/appliance/' + this.uuid + '/subscribe', JSON.stringify(data))
    this.waitingMessageIds[messageId] = commandResolve
    // the command returns with a timeout
    return pTimeout(commandPromise, timeout)
  }
}
