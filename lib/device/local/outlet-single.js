/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceLocalOutletSingle {
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

    // Create the queue used for sending device requests
    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: platform.config.pushRate * 1000,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true
    })
    this.queue.on('idle', () => {
      this.updateInProgress = false
    })

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

    // Always request a device update on startup, then enable polling if user enabled
    this.requestDeviceUpdate()
    if (this.platform.config.refreshRate > 0) {
      this.refreshinterval = setInterval(
        () => this.requestDeviceUpdate(),
        this.platform.config.refreshRate * 1000
      )
    }

    // Stop the intervals and close mqtt connection on Homebridge shutdown
    platform.api.on('shutdown', () => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }
    })
  }

  async internalStateUpdate (value) {
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
          this.log('[%s] sending request for state [%s].', this.name, value ? 'on' : 'off')
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
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestDeviceUpdate () {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Use the platform function to request the update
      const res = await this.platform.requestLocalDeviceUpdate(
        this.accessory,
        'Appliance.System.All'
      )

      // Parse the response
      const data = res.data

      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming poll message %s.', this.name, JSON.stringify(data))
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
}
