/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceLocalGarage {
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
    this.operationTime =
      this.accessory.context.options.operationTime ||
      platform.consts.defaultValues.garageDoorOpeningTime
    this.name = accessory.displayName
    this.states = {
      0: 'open',
      1: 'closed',
      2: 'opening',
      3: 'closing',
      4: 'stopped'
    }

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

    // Add the garage door service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.GarageDoorOpener) ||
      this.accessory.addService(this.hapServ.GarageDoorOpener)

    // Add the set handler to the garage door target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetDoorState)
      .onSet(value => this.internalTargetUpdate(value))
    this.cacheTarget = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    this.cacheCurrent = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value

    // Update the obstruction detected to false on plugin load
    this.service.setCharacteristic(this.hapChar.ObstructionDetected, false)

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

  async internalTargetUpdate (value) {
    // Add the request to the queue so updates are send according to configured push rate
    try {
      return await this.queue.add(async () => {
        let action
        if (value === 1) {
          // Request to close the garage door
          if (this.cacheCurrent === 0) {
            // The door is currently open
            // ACTION: close the door
            action = 'close'

            // Mark the current door state as closing
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
            this.cacheCurrent = 3
          } else if (this.cacheCurrent === 1) {
            // The door is currently closed
            // ACTION: none
            // Mark the current door state as closed
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.cacheCurrent = 1
          } else if (this.cacheCurrent === 2) {
            // The door is currently opening
            // ACTION: close the door (it will stop in an open state)
            action = 'close'

            // Mark the current door state as open
            this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
            this.cacheTarget = 0
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            this.cacheCurrent = 0
          } else if (this.cacheCurrent === 3) {
            // The door is currently closing
            // ACTION: none
            // Mark the current door state as closing
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
            this.cacheCurrent = 3
          } else if (this.cacheCurrent === 4) {
            // The door is currently stopped
            // ACTION: close the door
            action = 'close'

            // Mark the current door state as closing
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
            this.cacheCurrent = 3
          }
        } else if (value === 0) {
          // Request to open the door
          if (this.cacheCurrent === 0) {
            // The door is currently open
            // ACTION: none
            // Mark the current door state as open
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            this.cacheCurrent = 0
          } else if (this.cacheCurrent === 1) {
            // The door is currently closed
            // ACTION: open the door
            action = 'open'

            // Mark the current door state as opening
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
            this.cacheCurrent = 2
          } else if (this.cacheCurrent === 2) {
            // The door is currently opening
            // ACTION: none

            // Mark the current door state as opening
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
            this.cacheCurrent = 2
          } else if (this.cacheCurrent === 3) {
            // The door is currently closing
            // ACTION: open the door (it will stop in an closed state)
            action = 'open'

            // Mark the current door state as closed
            this.service.updateCharacteristic(this.hapChar.TargetDoorState, 1)
            this.cacheTarget = 1
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.cacheCurrent = 1
          } else if (this.cacheCurrent === 4) {
            // The door is currently stopped
            // ACTION: open the door
            action = 'open'

            // Mark the current door state as opening
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
            this.cacheCurrent = 2
          }
        }

        // If nothing to do then return now
        if (!action) {
          return
        }

        // Update the last time set (used for determining open/opening and closed/closing)
        this.lastSetTime = Math.floor(Date.now() / 1000)

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.GarageDoor.State'
        const payload = {
          state: {
            channel: this.accessory.context.channel,
            open: action === 'open' ? 1 : 0,
            uuid: this.accessory.context.serialNumber
          }
        }

        // Use the platform function to send the update to the device
        const res = await this.platform.sendLocalDeviceUpdate(this.accessory, namespace, payload)

        // Check the response
        if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
          throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
        }

        // Update the cache and log the update has been successful
        this.cacheTarget = value
        if (this.enableLogging) {
          this.log('[%s] current target [%s].', this.name, value === 1 ? 'closed' : 'open')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.cacheTarget)
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

      if (
        data &&
        data.payload &&
        data.payload.all &&
        data.payload.all.digest &&
        data.payload.all.digest.garageDoor
      ) {
        // Open means magnetic sensor not detected, doesn't really mean the door is open
        let isOpen = this.cacheCurrent === 0
        let newCurrent
        for (let i = 0; i < this.deviceStatus.payload.all.digest.garageDoor.length; i++) {
          if (data.payload.all.digest.garageDoor[i].channel === this.channel) {
            isOpen = this.deviceStatus.payload.all.digest.garageDoor[i].open
          }
        }
        if (isOpen) {
          const elapsedTime = Math.floor(Date.now() / 1000) - this.lastSetTime
          if (this.cacheCurrent === 2) {
            newCurrent = elapsedTime < this.operationTime ? 2 : 0
          } else if (this.cacheCurrent === 3) {
            newCurrent = elapsedTime < this.operationTime ? 3 : 0
          } else {
            newCurrent = 0
          }
        } else {
          newCurrent = 1
        }
        if (newCurrent !== this.cacheCurrent) {
          this.cacheCurrent = newCurrent
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.cacheCurrent)
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
