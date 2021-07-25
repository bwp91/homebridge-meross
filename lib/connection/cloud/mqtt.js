/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const crypto = require('crypto')
const mqtt = require('mqtt')
const pTimeout = require('promise-timeout')

module.exports = class connectionMQTT {
  constructor (platform, accessory, device) {
    this.accessory = accessory
    this.clientResponseTopic = null
    this.device = device
    this.funcs = platform.funcs
    this.key = platform.accountDetails.key
    this.log = platform.log
    this.name = accessory.displayName
    this.platform = platform
    this.queuedCommands = []
    this.status = 'init'
    this.timeout = 9000
    this.token = platform.accountDetails.token
    this.userid = platform.accountDetails.userid
    this.waitingMessageIds = {}
  }

  connect () {
    const appId = crypto
      .createHash('md5')
      .update('API' + this.accessory.UUID)
      .digest('hex')
    this.client = mqtt.connect({
      protocol: 'mqtts',
      host: this.device.domain || 'eu-iot.meross.com',
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
      const decodedMessage = JSON.parse(msg.toString())
      if (decodedMessage.header.from && !decodedMessage.header.from.includes(this.device.uuid)) {
        return
      }

      // If message is the RESP for a previous action,
      // process return the control to the 'stopped' method.
      const resolveForThisMessage = this.waitingMessageIds[decodedMessage.header.messageId]
      if (typeof resolveForThisMessage === 'function') {
        resolveForThisMessage(decodedMessage)
        delete this.waitingMessageIds[decodedMessage.header.messageId]
      } else if (decodedMessage.header.method === 'PUSH') {
        // Otherwise process it accordingly
        if (
          decodedMessage.payload &&
          this.accessory.control &&
          this.accessory.control.externalUpdate
        ) {
          const namespace = decodedMessage.header ? decodedMessage.header.namespace : ''
          this.accessory.control.externalUpdate(namespace, decodedMessage.payload)
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

  async publishMessage (method, namespace, payload) {
    // Helper to queue commands before the device is connected
    if (this.status !== 'online') {
      let connectResolve

      // we create a idle promise - connectPromise
      const connectPromise = new Promise(resolve => {
        connectResolve = resolve
      })

      // connectPromise will get resolved when the device connects
      this.queuedCommands.push(connectResolve)
      // when the device is connected, the futureCommand will be executed
      // that is exactly the same command issued now, but in the future
      const futureCommand = () => this.publishMessage(method, namespace, payload)
      // we return immediately an 'idle' promise, that when it gets resolved
      // it will then execute the futureCommand
      // IF the above takes too much time, the command will fail with a TimeoutError
      return pTimeout.timeout(connectPromise.then(futureCommand), this.timeout)
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
        method,
        namespace,
        payloadVersion: 1,
        sign: crypto
          .createHash('md5')
          .update(messageId + this.key + timestamp)
          .digest('hex'),
        timestamp
      },
      payload: payload
    }
    this.client.publish('/appliance/' + this.device.uuid + '/subscribe', JSON.stringify(data))
    this.waitingMessageIds[messageId] = commandResolve
    // the command returns with a timeout
    return pTimeout.timeout(commandPromise, this.timeout)
  }

  async getSystemAllData () {
    return this.publishMessage('GET', 'Appliance.System.All', {})
  }

  async getSystemDebug () {
    return this.publishMessage('GET', 'Appliance.System.Debug', {})
  }

  async getSystemAbilities () {
    return this.publishMessage('GET', 'Appliance.System.Ability', {})
  }

  async getSystemReport () {
    return this.publishMessage('GET', 'Appliance.System.Report', {})
  }

  async getSystemRuntime () {
    return this.publishMessage('GET', 'Appliance.System.Runtime', {})
  }

  async getSystemDNDMode () {
    return this.publishMessage('GET', 'Appliance.System.DNDMode', {})
  }

  async setSystemDNDMode (onoff) {
    const payload = { DNDMode: { mode: onoff ? 1 : 0 } }
    return this.publishMessage('SET', 'Appliance.System.DNDMode', payload)
  }

  async getOnlineStatus () {
    return this.publishMessage('GET', 'Appliance.System.Online', {})
  }

  async getConfigWifiList () {
    return this.publishMessage('GET', 'Appliance.Config.WifiList', {})
  }

  async getConfigTrace () {
    return this.publishMessage('GET', 'Appliance.Config.Trace', {})
  }

  async getControlPowerConsumption () {
    return this.publishMessage('GET', 'Appliance.Control.Consumption', {})
  }

  async getControlPowerConsumptionX () {
    return this.publishMessage('GET', 'Appliance.Control.ConsumptionX', {})
  }

  async getControlElectricity () {
    return this.publishMessage('GET', 'Appliance.Control.Electricity', {})
  }

  async controlToggle (onoff) {
    const payload = { toggle: { onoff: onoff ? 1 : 0 } }
    return this.publishMessage('SET', 'Appliance.Control.Toggle', payload)
  }

  async controlToggleX (channel, onoff) {
    const payload = { togglex: { channel: channel, onoff: onoff ? 1 : 0 } }
    return this.publishMessage('SET', 'Appliance.Control.ToggleX', payload)
  }

  async controlSpray (channel, mode) {
    const payload = { spray: { channel: channel, mode: mode || 0 } }
    return this.publishMessage('SET', 'Appliance.Control.Spray', payload)
  }

  async controlGarageDoor (channel, open) {
    const payload = { state: { channel: channel, open: open ? 1 : 0, uuid: this.device.uuid } }
    return this.publishMessage('SET', 'Appliance.GarageDoor.State', payload)
  }

  async controlLight (light) {
    const payload = { light: light }
    return this.publishMessage('SET', 'Appliance.Control.Light', payload)
  }

  async controlDiffusorSpray (type, channel, mode) {
    const payload = { spray: [{ channel: channel, mode: mode || 0, uuid: this.device.uuid }] }
    return this.publishMessage('SET', 'Appliance.Control.Diffuser.Spray', payload)
  }

  async controlDiffusorLight (type, light) {
    light.uuid = this.device.uuid
    const payload = { light: [light] }
    return this.publishMessage('SET', 'Appliance.Control.Diffuser.Light', payload)
  }

  async getHubBattery () {
    const payload = { battery: [] }
    return this.publishMessage('GET', 'Appliance.Hub.Battery', payload)
  }

  async getMts100All (ids) {
    const payload = { all: [] }
    ids.forEach(id => payload.all.push({ id: id }))
    return this.publishMessage('GET', 'Appliance.Hub.Mts100.All', payload)
  }

  async controlHubToggleX (subId, onoff) {
    const payload = { togglex: [{ id: subId, onoff: onoff ? 1 : 0 }] }
    return this.publishMessage('SET', 'Appliance.Hub.ToggleX', payload)
  }

  async controlHubMts100Mode (subId, mode) {
    const payload = { mode: [{ id: subId, state: mode }] }
    return this.publishMessage('SET', 'Appliance.Hub.Mts100.Mode', payload)
  }

  async controlHubMts100Temperature (subId, temp) {
    temp.id = subId
    const payload = { temperature: [temp] }
    return this.publishMessage('SET', 'Appliance.Hub.Mts100.Temperature', payload)
  }
}
