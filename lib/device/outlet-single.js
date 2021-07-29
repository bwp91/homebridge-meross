/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceOutletSingle {
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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Outlet) ||
      this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => await this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

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

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection === 'cloud') {
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then enable polling if user enabled
    this.requestUpdate()
    if (this.pollInterval > 0) {
      this.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
    }

    // Stop the intervals and close mqtt connection on Homebridge shutdown
    platform.api.on('shutdown', () => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }
      if (this.accessory.mqtt) {
        this.accessory.mqtt.disconnect()
      }
    })
  }

  async internalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // The plugin should have determined if it's 'toggle' or 'togglex' on the first poll run
        let namespace
        let payload
        if (this.isToggleX) {
          namespace = 'Appliance.Control.ToggleX'
          payload = {
            togglex: {
              onoff: value ? 1 : 0,
              channel: 0
            }
          }
        } else {
          namespace = 'Appliance.Control.Toggle'
          payload = {
            toggle: {
              onoff: value ? 1 : 0
            }
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
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate () {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {}
        })

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
        }

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all && data.all.digest) {
          if (data.all.digest.togglex && data.all.digest.togglex[0]) {
            this.isToggleX = true
            this.applyUpdate(data.all.digest.togglex[0])
          } else if (data.all.digest.toggle) {
            this.isToggleX = false
            this.applyUpdate(data.all.digest.toggle)
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt: %s.', this.name, JSON.stringify(params))
      }
      if (params.payload) {
        if (params.payload.togglex && params.payload.togglex[0]) {
          this.applyUpdate(params.payload.togglex[0])
        } else if (params.payload.toggle) {
          this.applyUpdate(params.payload.toggle)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
    // Check the data is in a format which contains the value we need
    if (this.funcs.hasProperty(data, 'onoff')) {
      // newState is given as 0 or 1 -> convert to bool for HomeKit
      const newState = data.onoff === 1

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheState !== newState) {
        this.service.updateCharacteristic(this.hapChar.On, newState)
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, newState ? 'on' : 'off')
        }
      }
    }
  }
}
