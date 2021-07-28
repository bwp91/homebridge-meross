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

    /* Polling not in use as device is outward control only
    // Always request a device update on startup, then enable polling if user enabled
    this.requestUpdate()
    if (this.pollInterval > 0) {
      this.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
    }
    */

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

        switch (this.accessory.context.connection) {
          case 'cloud': {
            await this.accessory.mqtt.controlRollerPosition(0, newPosition)
            break
          }
          case 'local': {
            // Generate the payload and namespace for the correct device model
            const namespace = 'Appliance.RollerShutter.Position'
            const payload = {
              position: {
                position: newPosition,
                channel: 0
              }
            }

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }

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

  async requestUpdate () {
    try {
      /*
      POLLING IS DISABLED FOR ROLLER DEVICE AS SWITCHES ARE STATELESS IN HOMEKIT
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the request
        const res =
          this.accessory.context.connection === 'cloud'
            ? await this.accessory.mqtt.getSystemAllData()
            : await this.platform.requestLocalUpdate(this.accessory, 'Appliance.System.All')

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
        }

        // Validate the response, checking for payload property
        if (!res.data || !res.data.payload) {
          throw new Error('invalid response received')
        }

        const data = res.data.payload

        // Check the response is in a useful format
        if (
          data.all &&
          data.all.digest &&
          data.all.digest.togglex &&
          data.all.digest.togglex[0] &&
          this.funcs.hasProperty(data.all.digest.togglex[0], 'onoff')
        ) {
          // newState is given as 0 or 1 -> convert to bool for HomeKit
          const newState = data.all.digest.togglex[0].onoff === 1

          // Check against the cache and update HomeKit and the cache if needed
          if (this.cacheState !== newState) {
            this.service.updateCharacteristic(this.hapChar.On, newState)
            this.cacheState = newState
            if (this.enableLogging) {
              this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off')
            }
          }
        }
      })
      */
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  externalUpdate (namespace, params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt [%s]: %s.', this.name, namespace, JSON.stringify(params))
      }

      
      /*
      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload

      // Check the data is in a format which contains the value we need
      if (
        namespace === 'Appliance.Control.ToggleX' &&
        data.togglex &&
        data.togglex[0] &&
        this.funcs.hasProperty(data.togglex[0], 'onoff')
      ) {
        // newState is given as 0 or 1 -> convert to bool for HomeKit
        const newState = data.togglex[0].onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.On, newState)
          this.cacheState = newState
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, newState ? 'on' : 'off')
          }
        }
      }
      */
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
