/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceGarageSub {
  constructor (platform, accessory, devicesInHB) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
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
    this.operationTime =
      this.accessory.context.options.operationTime ||
      platform.consts.defaultValues.garageDoorOpeningTime
    this.name = accessory.displayName
    this.priAcc = devicesInHB.get(
      this.platform.api.hap.uuid.generate(accessory.context.serialNumber)
    )
    this.states = {
      0: 'open',
      1: 'closed',
      2: 'opening',
      3: 'closing',
      4: 'stopped'
    }

    // Add the garage door service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.GarageDoorOpener) ||
      this.accessory.addService(this.hapServ.GarageDoorOpener)

    // Add some extra Eve characteristics
    if (!this.service.testCharacteristic(this.eveChar.LastActivation)) {
      this.service.addCharacteristic(this.eveChar.LastActivation)
    }
    if (!this.service.testCharacteristic(this.eveChar.ResetTotal)) {
      this.service.addCharacteristic(this.eveChar.ResetTotal)
    }
    if (!this.service.testCharacteristic(this.eveChar.TimesOpened)) {
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Add the set handler to the garage door target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetDoorState)
      .onSet(value => this.internalTargetUpdate(value))
    this.cacheTarget = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    this.cacheCurrent = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value

    // Add the set handler to the garage door reset total characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(value => {
      this.service.updateCharacteristic(this.eveChar.TimesOpened, 0)
    })

    // Update the obstruction detected to false on plugin load
    this.service.updateCharacteristic(this.hapChar.ObstructionDetected, false)

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      garageDoorOpeningTime: this.operationTime,
      hideChannels: accessory.context.options.hideChannels,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalTargetUpdate (value) {
    // Add the request to the queue so updates are send apart
    try {
      let action
      let newTarget = value
      let newCurrent
      if (value === 1) {
        // Request to close the garage door
        if (this.cacheCurrent === 0) {
          // The door is currently open
          // ACTION: close the door
          action = 'close'

          // Mark the current door state as closing
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
          newCurrent = 3
        } else if (this.cacheCurrent === 1) {
          // The door is currently closed
          // ACTION: none
          // Mark the current door state as closed
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
          newCurrent = 1
        } else if (this.cacheCurrent === 2) {
          // The door is currently opening
          // ACTION: close the door
          action = 'close'

          // Mark the target state as close and current door state as closing
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, 1)
          newTarget = 1
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
          newCurrent = 3
        } else if (this.cacheCurrent === 3) {
          // The door is currently closing
          // ACTION: none
          // Mark the current door state as closing
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
          newCurrent = 3
        }
      } else if (value === 0) {
        // Request to open the door
        if (this.cacheCurrent === 0) {
          // The door is currently open
          // ACTION: none
          // Mark the current door state as open
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
          newCurrent = 0
        } else if (this.cacheCurrent === 1) {
          // The door is currently closed
          // ACTION: open the door
          action = 'open'

          // Mark the current door state as opening
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
          newCurrent = 2
        } else if (this.cacheCurrent === 2) {
          // The door is currently opening
          // ACTION: none

          // Mark the current door state as opening
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
          newCurrent = 2
        } else if (this.cacheCurrent === 3) {
          // The door is currently closing
          // ACTION: open the door
          action = 'open'

          // Mark the target state as open and current state as opening
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
          newTarget = 0
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
          newCurrent = 2
        }
      }

      // Only send an update if we need to
      if (action) {
        this.ignoreIncoming = true
        setTimeout(() => {
          this.ignoreIncoming = false
        }, 3000)

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
        await this.platform.sendUpdate(this.priAcc, {
          namespace,
          payload
        })
      }

      // Update the cache target state if different
      if (this.cacheTarget !== newTarget) {
        this.cacheTarget = newTarget
        if (this.enableLogging) {
          this.log('[%s] current target [%s].', this.name, this.states[this.cacheTarget])
        }
      }

      // Update the cache current state if different
      if (this.cacheCurrent !== newCurrent) {
        this.cacheCurrent = newCurrent
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
        }
      }

      /*
          CASE: garage has been opened
          target has been set to [open] and current has been set to [opening]
          wait for the operation time to elapse and set the current to [open]
        */
      if (action === 'open') {
        const updateKey = Math.random()
          .toString(36)
          .substr(2, 8)
        this.updateKey = updateKey

        // Update the Eve times opened characteristic
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
        )
        const initialTime = this.accessory.eveService.getInitialTime()
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - initialTime
        )
        setTimeout(() => {
          if (updateKey !== this.updateKey) {
            return
          }
          if (this.service.getCharacteristic(this.hapChar.CurrentDoorState).value !== 2) {
            return
          }
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
          this.cacheCurrent = 0
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          }
        }, this.operationTime * 1000)
      }

      /*
        CASE: garage has been closed
        target has been set to [close] and current has been set to [closing]
        wait for the plugin to get a definite closed response from Meross
        For security reasons, I don't want to rely on operation time for the garage to
        definitely show as closed
        Set a timer for operation time plus 15 seconds, and if the garage is still closing then
        mark target and current state as open
        Also setup quicker polling every 3 seconds when in local mode to get the closed status
      */
      if (action === 'close') {
        const updateKey = Math.random()
          .toString(36)
          .substr(2, 8)
        if (this.accessory.context.connection === 'local') {
          this.extremePolling = setInterval(() => this.priAcc.requestUpdate(), 3000)
        }
        this.updateKey = updateKey
        setTimeout(() => {
          if (updateKey !== this.updateKey) {
            return
          }
          if (this.service.getCharacteristic(this.hapChar.CurrentDoorState).value !== 3) {
            return
          }
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
          this.cacheTarget = 0
          this.cacheCurrent = 0
          if (this.enableLogging) {
            this.log('[%s] current target [%s].', this.name, this.states[this.cacheTarget])
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          }

          // Cancel any 'extreme' polling intervals from setting the garage to close
          if (this.extremePolling) {
            clearInterval(this.extremePolling)
            this.extremePolling = false
          }
        }, (this.operationTime + 15) * 1000)
      }
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.cacheTarget)
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, new this.hapErr(-70402))
    }
  }

  applyUpdate (data) {
    // data will be in the format {"channel":1,"doorEnable":1,"open":0,"lmTime":1628623166}
    // Don't bother whilst the ignore incoming is set to true
    if (this.ignoreIncoming) {
      return
    }

    // When operated externally, the plugin does not bother with 'opening' and 'closing' status
    // Open means magnetic sensor not detected, doesn't really mean the door is open
    if (this.funcs.hasProperty(data, 'open')) {
      const isOpen = data.open === 1
      switch (this.cacheCurrent) {
        case 0:
        case 2: {
          // Homebridge has garage as open or opening
          if (isOpen) {
            // Meross has reported open
            // Nothing to do
          } else {
            // Meross has reported closed
            this.service.updateCharacteristic(this.hapChar.TargetDoorState, 1)
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.cacheCurrent = 1
            this.cacheTarget = 1
            this.log('[%s] target state [%s].', this.name, this.states[this.cacheTarget])
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          }
          break
        }
        case 1: {
          // Homebridge has garage as closed
          if (isOpen) {
            // Meross has reported open
            this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            this.service.updateCharacteristic(
              this.eveChar.TimesOpened,
              this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
            )
            const initialTime = this.accessory.eveService.getInitialTime()
            this.service.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - initialTime
            )
            this.cacheCurrent = 0
            this.cacheTarget = 0
            this.log('[%s] target state [%s].', this.name, this.states[this.cacheTarget])
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          } else {
            // Meross has reported closed
            // Nothing to do
          }
          break
        }
        case 3: {
          // Homebridge has garage as closing
          if (isOpen) {
            // Meross has reported open
            this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            this.service.updateCharacteristic(
              this.eveChar.TimesOpened,
              this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
            )
            const initialTime = this.accessory.eveService.getInitialTime()
            this.service.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - initialTime
            )
            this.cacheCurrent = 0
            this.cacheTarget = 0
            this.log('[%s] target state [%s].', this.name, this.states[this.cacheTarget])
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          } else {
            // Meross has reported closed
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.cacheCurrent = 1
            this.log('[%s] current state [%s].', this.name, this.states[this.cacheCurrent])
          }

          // Cancel any 'extreme' polling intervals from setting the garage to close
          if (this.extremePolling) {
            clearInterval(this.extremePolling)
            this.extremePolling = false
          }
          break
        }
      }
    }
  }
}
