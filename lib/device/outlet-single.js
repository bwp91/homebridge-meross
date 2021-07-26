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
    this.channel = accessory.context.channel
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.name = accessory.displayName

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Outlet) ||
      this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the outlet on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      if (accessory.context.connection === 'cloud') {
        await this.internalCloudStateUpdate(value)
      } else {
        await this.internalLocalStateUpdate(value)
      }
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

    if (accessory.context.connection === 'cloud') {
      // Set up the mqtt client for cloud devices to send and receive device updates
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()

      // Always request a device update on startup, then enable polling if user enabled
      this.requestCloudUpdate()
      if (this.platform.config.cloudRefreshRate > 0) {
        this.refreshinterval = setInterval(
          () => this.requestCloudUpdate(),
          this.platform.config.cloudRefreshRate * 1000
        )
      }
    } else {
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

      // Always request a device update on startup, then enable polling if user enabled
      this.requestLocalUpdate()
      if (this.platform.config.refreshRate > 0) {
        this.refreshinterval = setInterval(
          () => this.requestLocalUpdate(),
          this.platform.config.refreshRate * 1000
        )
      }
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

  async internalCloudStateUpdate (value) {
    try {
      // Don't continue if the state is the same as before
      if (value === this.cacheState) {
        return
      }

      // Send the command
      await this.accessory.mqtt.controlToggleX(0, value)

      // Update the cache and log if appropriate
      this.cacheState = value
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off')
      }
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending cloud update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLocalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send according to configured push rate
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while sending one
        this.updateInProgress = true

        // Log the update
        if (this.enableDebugLogging) {
          this.log('[%s] sending local request for state [%s].', this.name, value ? 'on' : 'off')
        }

        // Generate the payload and namespace for the correct device model
        let namespace
        let payload
        if (this.accessory.context.model === 'MSS1101') {
          namespace = 'Appliance.Control.Toggle'
          payload = {
            toggle: {
              onoff: value ? 1 : 0
            }
          }
        } else {
          namespace = 'Appliance.Control.ToggleX'
          payload = {
            togglex: {
              onoff: value ? 1 : 0,
              channel: this.channel
            }
          }
        }

        // Use the platform function to send the update to the device
        const res = await this.platform.sendLocalDeviceUpdate(this.accessory, namespace, payload)

        // Check the response
        if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
          throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
        }

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending local update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestCloudUpdate () {
    try {
      // Send a request for a status update for the device
      const result = await this.accessory.mqtt.getSystemAllData()

      // If debug enabled then log the response
      if (this.enableDebugLogging) {
        this.log('[%s] incoming cloud poll message:\n%s', this.name, JSON.stringify(result.payload))
      }

      // Check the data is in a format which contains the value we need
      if (
        !result.payload ||
        !result.payload.all ||
        !result.payload.all.digest ||
        !result.payload.all.digest.togglex ||
        !Array.isArray(result.payload.all.digest.togglex) ||
        !result.payload.all.digest.togglex[0]
      ) {
        throw new Error('data in invalid format')
      }

      // Read the current state
      const newState = result.payload.all.digest.togglex[0].onoff === 1

      // Don't continue if the state is the same as before
      if (newState === this.cacheState) {
        return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.On, newState)

      // Update the cache and log the change if the user has logging turned on
      this.cacheState = newState
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, newState ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  async requestLocalUpdate () {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Use the platform function to request the update
      const res = await this.platform.requestLocalUpdate(this.accessory, 'Appliance.System.All')

      // Parse the response
      const data = res.data

      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming local poll message %s.', this.name, JSON.stringify(data))
      }

      // Check the response format is correct
      if (
        data &&
        data.payload &&
        data.payload.all &&
        data.payload.all.digest &&
        data.payload.all.digest.togglex &&
        data.payload.all.digest.togglex[this.channel] &&
        this.funcs.hasProperty(data.payload.all.digest.togglex[this.channel], 'onoff')
      ) {
        // newState is given as 0 or 1 -> convert to bool for HomeKit
        const newState = data.payload.all.digest.togglex[this.channel].onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.On, newState)
          this.cacheState = newState
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off')
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  externalCloudUpdate (namespace, payload) {
    try {
      // If debug enabled then log the response
      if (this.enableDebugLogging) {
        this.log(
          '[%s] incoming cloud mqtt message [%s]:\n%s',
          this.name,
          namespace,
          JSON.stringify(payload)
        )
      }

      // Check the data is in a format which contains the value we need
      if (
        namespace !== 'Appliance.Control.ToggleX' ||
        !payload.togglex ||
        !Array.isArray(payload.togglex) ||
        !payload.togglex[0]
      ) {
        throw new Error('data in invalid format')
      }

      // Read the current state
      const newState = payload.togglex[0].onoff

      // Don't continue if the state is the same as before
      if (newState === this.cacheState) {
        return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.On, newState)

      // Update the cache and log the change if the user has logging turned on
      this.cacheState = newState
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, newState ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
