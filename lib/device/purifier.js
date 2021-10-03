/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')
const { TimeoutError } = require('p-timeout')

module.exports = class devicePurifier {
  constructor (platform, accessory) {
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
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection !== 'local'
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate
    this.hk2mr = speed => {
      return speed / 25
    }
    this.hk2Label = speed => {
      if (speed === 0) {
        return 'off'
      } else if (speed === 25) {
        return 'sleep'
      } else if (speed === 50) {
        return 'low'
      } else if (speed === 75) {
        return 'medium'
      } else {
        return 'high'
      }
    }
    this.mr2hk = speed => {
      return speed * 25
    }

    // Add the switch service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.AirPurifier) ||
      this.accessory.addService(this.hapServ.AirPurifier)

    // Add the set handler to the purifier on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => await this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value

    // Add options to the purifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetAirPurifierState)
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1]
      })
      .updateValue(1)

    // Add the set handler to the purifier speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 25,
        validValues: [0, 25, 50, 75, 100]
      })
      .onSet(async value => await this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the purifier child lock characteristic
    this.service
      .getCharacteristic(this.hapChar.LockPhysicalControls)
      .onSet(async value => await this.internalLockUpdate(value))
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value

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
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then start the interval for polling
    this.requestUpdate(true)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000
    )

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
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

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value,
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
        this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, value === 1 ? 2 : 0)
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value === 1 ? 'purifying' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Some homekit apps might not support the valid values of 0, 50 and 100
        if (value === 0) {
          return
        } else if (value <= 33) {
          value = 25
        } else if (value <= 66) {
          value = 50
        } else if (value <= 99) {
          value = 75
        } else {
          value = 100
        }

        // Don't continue if the state is the same as before
        const mrVal = this.hk2mr(value)
        if (mrVal === this.cacheSpeed) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Fan'
        const payload = {
          fan: {
            speed: mrVal,
            channel: 0
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheSpeed = mrVal
        if (this.enableLogging) {
          this.log('[%s] current speed [%s].', this.name, this.hk2Label(value))
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.mr2hk(this.cacheSpeed))
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLockUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheLock) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.PhysicalLock'
        const payload = {
          lock: {
            onoff: value,
            channel: 0
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheLock = value
        if (this.enableLogging) {
          this.log('[%s] current child lock [%s].', this.name, value === 1 ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock)
      }, 2000)
      throw new this.hapErr(-70402)
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
          this.log('[%s] %s: %s.', this.name, this.lang.incPoll, JSON.stringify(res.data))
        }

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all) {
          if (data.all.digest) {
            if (data.all.digest.togglex && data.all.digest.togglex[0]) {
              this.applyUpdate(data.all.digest.togglex[0])
            }
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address and hardware don't change regularly so only get on first poll
            if (firstRun && data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
              this.accessory.context.hardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              // Check for an IP change each and every time the device is polled
              if (this.accessory.context.ipAddress !== data.all.system.firmware.innerIp) {
                this.accessory.context.ipAddress = data.all.system.firmware.innerIp
                needsUpdate = true
              }

              // Firmware doesn't change regularly so only get on first poll
              if (firstRun) {
                this.accessory.context.firmware = data.all.system.firmware.version
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.accessory.context.isOnline !== isOnline) {
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
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      if (this.enableDebugLogging) {
        this.log.warn('[%s] %s %s.', this.name, this.lang.reqFailed, eText)
      }

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (
        (this.accessory.context.isOnline || firstRun) &&
        ['EHOSTUNREACH', 'timed out'].some(el => eText.includes(el))
      ) {
        this.accessory.context.isOnline = false
        this.platform.updateAccessory(this.accessory)
      }
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] %s: %s.', this.name, this.lang.incMQTT, JSON.stringify(params))
      }

      // Check the response is in a useful format
      const data = params.payload
      if (data.togglex && data.togglex[0]) {
        this.applyUpdate(data.togglex[0])
      }
      if (data.fan && data.fan[0]) {
        this.applyUpdate(data.fan[0])
      }
      if (data.lock && data.lock[0]) {
        this.applyUpdate({ lock: data.lock[0].onoff })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.refFailed, eText)
    }
  }

  applyUpdate (data) {
    // Check the data is in a format which contains the value we need
    if (this.funcs.hasProperty(data, 'onoff')) {
      // newState is given as 0 or 1 -> active characteristic also needs 0 or 1
      const newState = data.onoff

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheState !== newState) {
        this.service.updateCharacteristic(this.hapChar.Active, newState)
        this.service.updateCharacteristic(
          this.hapChar.CurrentAirPurifierState,
          newState === 1 ? 2 : 0
        )
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, newState ? 'purifying' : 'off')
        }
      }
    }
    if (this.funcs.hasProperty(data, 'speed')) {
      const newSpeed = data.speed
      if (this.cacheSpeed !== newSpeed) {
        this.cacheSpeed = newSpeed
        const hkValue = this.mr2hk(this.cacheSpeed)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkValue)
        if (this.enableLogging) {
          this.log('[%s] current speed [%s].', this.name, this.hk2Label(hkValue))
        }
      }
    }
    if (this.funcs.hasProperty(data, 'lock')) {
      // newState is given as 0 or 1 -> active characteristic also needs 0 or 1
      const newLock = data.lock

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheLock !== newLock) {
        this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, newLock)
        this.cacheLock = newLock
        if (this.enableLogging) {
          this.log('[%s] current child lock [%s].', this.name, newLock ? 'on' : 'off')
        }
      }
    }
  }
}
