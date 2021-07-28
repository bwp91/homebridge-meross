/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceRoller {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000
    this.reversePolarity = this.accessory.context.options.reversePolarity

    // Add the switch services
    this.serviceOpen =
      this.accessory.getService('Open') ||
      this.accessory.addService(this.hapServ.Switch, 'Open', 'open')
    this.serviceClose =
      this.accessory.getService('Close') ||
      this.accessory.addService(this.hapServ.Switch, 'Close', 'close')
    this.serviceStop =
      this.accessory.getService('Stop') ||
      this.accessory.addService(this.hapServ.Switch, 'Stop', 'stop')

    // Add the set handler to the open switch service
    this.serviceOpen
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => {
        await this.internalStateUpdate(value, this.reversePolarity ? 0 : 100, this.serviceOpen)
      })
      .updateValue(false)

    // Add the set handler to the close switch service
    this.serviceClose
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => {
        await this.internalStateUpdate(value, this.reversePolarity ? 100 : 0, this.serviceClose)
      })
      .updateValue(false)

    // Add the set handler to the stop switch service
    this.serviceStop
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => await this.internalStateUpdate(value, -1, this.serviceStop))
      .updateValue(false)

    // Create the queue used for sending device requests
    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true
    })
    this.queue.on('idle', () => {
      this.updateInProgress = false
    })
    this.states = {
      1: 'stopped',
      0: 'closing',
      100: 'opening'
    }

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection === 'cloud') {
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Stop the intervals and close mqtt connection on Homebridge shutdown
    platform.api.on('shutdown', () => {
      if (this.accessory.mqtt) {
        this.accessory.mqtt.disconnect()
      }
    })
  }

  async internalStateUpdate (value, newPosition, hapServ) {
    try {
      // Only control when turning on a switch
      if (!value) {
        return
      }

      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.RollerShutter.Position'
        const payload = {
          position: {
            position: newPosition,
            channel: 0
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, this.states[Math.abs(newPosition)])
        }

        // Turn the switch off again after two seconds
        setTimeout(() => {
          hapServ.updateCharacteristic(this.hapChar.On, false)
        }, 2000)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        hapServ.updateCharacteristic(this.hapChar.On, false)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }
}
