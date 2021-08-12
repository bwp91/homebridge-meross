/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceGarageSingle {
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
    this.operationTime =
      this.accessory.context.options.operationTime ||
      platform.consts.defaultValues.garageDoorOpeningTime
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate
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

    // Add the set handler to the garage door target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetDoorState)
      .onSet(value => this.internalTargetUpdate(value))
    this.cacheTarget = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    this.cacheCurrent = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value

    // Update the obstruction detected to false on plugin load
    this.service.updateCharacteristic(this.hapChar.ObstructionDetected, false)

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
    this.requestUpdate(true)
    if (this.pollInterval > 0) {
      this.accessory.refreshinterval = setInterval(
        () => this.requestUpdate(),
        this.pollInterval * 1000
      )
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      garageDoorOpeningTime: this.operationTime,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalTargetUpdate (value) {
    // Add the request to the queue so updates are send apart
    try {
      return await this.queue.add(async () => {
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
              channel: 0,
              open: action === 'open' ? 1 : 0,
              uuid: this.accessory.context.serialNumber
            }
          }

          // Use the platform function to send the update to the device
          await this.platform.sendUpdate(this.accessory, {
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
            this.extremePolling = setInterval(() => this.requestUpdate(), 3000)
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
      })
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

  async requestUpdate (firstRun = false) {
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
        if (data.all) {
          if (data.all.digest && data.all.digest.garageDoor && data.all.digest.garageDoor[0]) {
            this.applyUpdate(data.all.digest.garageDoor[0])
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (firstRun && data.all.system) {
            // Mac address, IP and firmware don't change regularly so only get on first poll
            if (data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
              this.accessory.context.hardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              this.accessory.context.ipAddress = data.all.system.firmware.innerIp
              this.accessory.context.firmware = data.all.system.firmware.version
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.cacheOnline !== isOnline) {
              this.cacheOnline = isOnline
              this.accessory.context.isOnline = isOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate || firstRun) {
            this.platform.updateAccessory(this.accessory)
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to request status as %s.', this.name, eText)

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (this.accessory.context.connection === 'local') {
        if (['EHOSTUNREACH', '4000ms exceeded'].some(el => eText.includes(el))) {
          this.accessory.context.isOnline = false
          this.cacheOnline = false
          if (this.enableLogging) {
            this.log.warn('[%s] has been reported [offline].', this.name)
          }
          this.platform.updateAccessory(this.accessory)
        }
      }
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt [%s]: %s.', this.name, JSON.stringify(params))
      }

      // Check the response is in a useful format
      const data = params.payload
      if (data.state && data.state[0]) {
        this.applyUpdate(data.state[0])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
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
