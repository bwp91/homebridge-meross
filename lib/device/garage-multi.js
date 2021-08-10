/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceGarageMulti {
  constructor (platform, accessory, devicesInHB) {
    // Set up variables from the platform
    this.devicesInHB = devicesInHB
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
    this.operationTime =
      this.accessory.context.options.operationTime ||
      platform.consts.defaultValues.garageDoorOpeningTime
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000
    this.states = {
      0: 'open',
      1: 'closed',
      2: 'opening',
      3: 'closing',
      4: 'stopped'
    }
    this.priAccHBUUID = this.platform.api.hap.uuid.generate(accessory.context.serialNumber + '0')

    // Add the switch service if it doesn't already exist
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

    // We only need to setup mqtt client and polling for 'main' accessory (channel 0)
    if (accessory.context.channel === 0) {
      // Set up the mqtt client for cloud devices to send and receive device updates
      if (accessory.context.connection === 'cloud') {
        this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
        this.accessory.mqtt.connect()
      }

      // Always request a device update on startup, then enable polling if user enabled
      this.requestUpdate(true)
      if (this.pollInterval > 0) {
        this.accessory.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
      }
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      garageDoorOpeningTime: this.operationTime,
      hideChannels: this.accessory.context.hideChannels,
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
              channel: this.accessory.context.channel,
              open: action === 'open' ? 1 : 0,
              uuid: this.accessory.context.serialNumber
            }
          }

          // Get the primary accessory instance to send the command
          const accessory =
            this.accessory.context.channel === 0
              ? this.accessory
              : this.devicesInHB.get(this.priAccHBUUID)

          // Use the platform function to send the update to the device
          await this.platform.sendUpdate(accessory, {
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
        */
        if (action === 'close') {
          const updateKey = Math.random()
            .toString(36)
            .substr(2, 8)
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
          }, (this.operationTime + 15) * 1000)
        }

        // Update the other accessories of this device with the correct status
        switch (this.accessory.context.channel) {
          case 0: {
            // Update all the sub accessories with the same status
            for (let i = 1; i < this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              const hapServ = subAcc.getService(this.hapServ.GarageDoorOpener)
              const hapCharTarg = hapServ.getCharacteristic(this.hapChar.TargetDoorState)
              const hapCharCurr = hapServ.getCharacteristic(this.hapChar.CurrentDoorState)
              if (hapCharTarg.value !== value) {
                hapCharTarg.updateValue(value)
                if (subAcc.context.enableLogging) {
                  this.log(
                    '[%s] current target [%s].',
                    subAcc.displayName,
                    this.states[this.cacheTarget]
                  )
                }
              }
              if (hapCharCurr.value !== value) {
                hapCharCurr.updateValue(value)
                if (subAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    subAcc.displayName,
                    this.states[this.cacheCurrent]
                  )
                }
              }
            }
            break
          }
          case 1:
          case 2:
          case 3:
          case 4:
          case 5:
          case 6: {
            let primaryState = false
            for (let i = 1; i <= this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              if (i === this.accessory.context.channel) {
                if (value) {
                  primaryState = true
                }
              } else {
                const hapServ = subAcc.getService(this.hapServ.GarageDoorOpener)
                const hapCharTarg = hapServ.getCharacteristic(this.hapChar.TargetDoorState)
                if (hapCharTarg.value === 0) {
                  primaryState = true
                }
              }
            }
            if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
              const priAcc = this.devicesInHB.get(this.priAccHBUUID)
              const hapServ = priAcc.getService(this.hapServ.GarageDoorOpener)
              const hapCharTarg = hapServ.getCharacteristic(this.hapChar.TargetDoorState)
              const hapCharCurr = hapServ.getCharacteristic(this.hapChar.CurrentDoorState)
              if ((hapCharTarg.value === 0) !== primaryState) {
                hapCharTarg.updateValue(primaryState ? 0 : 1)
                if (priAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    priAcc.displayName,
                    this.states[this.cacheTarget]
                  )
                }
              }
              if ((hapCharCurr.value === 0) !== primaryState) {
                hapCharCurr.updateValue(primaryState ? 0 : 1)
                if (priAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    priAcc.displayName,
                    this.states[this.cacheCurrent]
                  )
                }
              }
            }
            break
          }
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
          if (
            data.all.digest &&
            data.all.digest.togglex &&
            Array.isArray(data.all.digest.togglex)
          ) {
            this.applyUpdate(data.all.digest.togglex)
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address, IP and firmware don't change regularly so only get on first poll
            if (firstRun) {
              if (data.all.system.hardware) {
                this.cacheMac = (data.all.system.hardware.macAddress || '').toUpperCase()
                if (this.cacheMac !== this.accessory.context.macAddress) {
                  this.accessory.context.macAddress = this.cacheMac
                  needsUpdate = true
                }
                this.cacheHardware = data.all.system.hardware.version
                if (this.cacheHardware !== this.accessory.context.hardware) {
                  this.accessory.context.hardware = this.cacheHardware
                  needsUpdate = true
                }
              }

              // Get the ip address and firmware of the device
              if (data.all.system.firmware) {
                this.cacheIp = data.all.system.firmware.innerIp
                if (this.cacheIp !== this.accessory.context.ipAddress) {
                  this.accessory.context.ipAddress = this.cacheIp
                  needsUpdate = true
                }

                if (!this.accessory.context.firmware) {
                  this.cacheFirmware = data.all.system.firmware.version
                  if (this.cacheFirmware !== this.accessory.context.firmware) {
                    this.accessory.context.firmware = this.cacheFirmware
                    needsUpdate = true
                  }
                }
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            this.cacheOnline = data.all.system.online.status === 1
            if (this.cacheOnline !== this.accessory.context.isOnline) {
              this.accessory.context.isOnline = this.cacheOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate) {
            this.platform.updateAccessory(this.accessory)
            for (let i = 1; i <= this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              subAcc.context = {
                ...subAcc.context,
                ...{
                  macAddress: this.cacheMac,
                  hardware: this.cacheHardware,
                  ipAddress: this.cacheIp,
                  firmware: this.cacheFirmware,
                  isOnline: this.cacheOnline
                }
              }
              this.platform.updateAccessory(subAcc)
            }
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to request status as %s.', this.name, eText)

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (this.accessory.context.connection === 'local') {
        if (['EHOSTUNREACH', '4000ms exceeded'].some(el => eText.includes(el))) {
          this.cacheOnline = false
          if (this.enableLogging) {
            this.log.warn('[%s] has been reported [offline].', this.name)
          }
          for (let i = 0; i <= this.accessory.context.channelCount; i++) {
            const subAcc = this.devicesInHB.get(
              this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
            )
            if (!subAcc) {
              continue
            }
            subAcc.context.isOnline = false
            this.platform.updateAccessory(subAcc)
          }
        }
      }
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt: %s.', this.name, JSON.stringify(params))
      }

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload

      // Check the data is in a format which contains the value we need
      if (data.togglex) {
        // payload.togglex can either be an array of objects (multiple channels) or a single object
        // Either way, push all items into one array
        const toUpdate = []
        if (Array.isArray(data.togglex)) {
          data.togglex.forEach(item => toUpdate.push(item))
        } else {
          toUpdate.push(data.togglex)
        }
        this.applyUpdate(toUpdate)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
    data.forEach(channel => {
      // Attempt to find the accessory this channel relates to
      const accessory =
        channel.channel === 0
          ? this.accessory
          : this.devicesInHB.get(
              this.platform.api.hap.uuid.generate(
                this.accessory.context.serialNumber + channel.channel
              )
            )

      // Check the accessory exists
      if (!accessory) {
        return
      }

      // Obtain the service and current value
      const hapServ =
        channel.channel === 0 ? this.service : accessory.getService(this.hapServ.GarageDoorOpener)
      const hapCharTarg = hapServ.getCharacteristic(this.hapChar.TargetDoorState)
      const hapCharCurr = hapServ.getCharacteristic(this.hapChar.CurrentDoorState)

      // Read the current state
      const newState = channel.onoff === 1

      // Don't continue if the state is the same as before
      if (hapChar.value === newState) {
        return
      }

      // Update the HomeKit characteristics and log
      hapChar.updateValue(newState)
      if (accessory.context.enableLogging) {
        this.log('[%s] current state [%s].', accessory.displayName, newState ? 'on' : 'off')
      }
    })

    // Check for the primary accessory state
    if (this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
      return
    }
    let primaryState = false
    for (let i = 1; i <= this.accessory.context.channelCount; i++) {
      const subAcc = this.devicesInHB.get(
        this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
      )
      if (!subAcc) {
        continue
      }
      if (subAcc.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On).value) {
        primaryState = true
      }
    }
    const priAcc = this.devicesInHB.get(this.priAccHBUUID)
    const hapChar = priAcc.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On)
    if (hapChar.value !== primaryState) {
      hapChar.updateValue(primaryState)
      if (priAcc.context.enableLogging) {
        this.log('[%s] current state [%s].', priAcc.displayName, primaryState ? 'on' : 'off')
      }
    }
  }
}
