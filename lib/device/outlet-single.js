/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceOutletSingle {
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
    this.inUsePowerThreshold =
      this.accessory.context.options.inUsePowerThreshold ||
      platform.consts.defaultValues.inUsePowerThreshold
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
    this.requestUpdate(true)
    if (this.pollInterval > 0) {
      this.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
    }

    // Test to see if the device supports power usage
    this.setupPowerReadings()

    // Stop the intervals and close mqtt connection on Homebridge shutdown
    platform.api.on('shutdown', () => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }
      if (this.powerInterval) {
        clearInterval(this.powerInterval)
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
          if (data.all.digest) {
            if (data.all.digest.togglex && data.all.digest.togglex[0]) {
              this.isToggleX = true
              this.applyUpdate(data.all.digest.togglex[0])
            } else if (data.all.digest.toggle) {
              this.isToggleX = false
              this.applyUpdate(data.all.digest.toggle)
            }
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
              if (this.enableLogging) {
                if (this.cacheOnline) {
                  this.log('[%s] has been reported [online].', this.name)
                } else {
                  this.log.warn('[%s] has been reported [offline].', this.name)
                }
              }
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate) {
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
    if (this.funcs.hasProperty(data, 'power')) {
      // newState is given as 0 or 1 -> convert to bool for HomeKit
      const newPower = data.power

      // Check against the cache and update HomeKit and the cache if needed
      let newInUse = this.cacheInUse
      if (this.cachePower !== newPower) {
        const scaledPower = Math.round(newPower / 10) / 100
        newInUse = this.cacheState && scaledPower > this.inUsePowerThreshold
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, scaledPower)
        this.cachePower = newPower
        if (this.enableLogging) {
          this.log('[%s] current power [%sW].', this.name, scaledPower)
        }
      }
      if (this.cacheInUse !== newInUse) {
        this.cacheInUse = newInUse
        this.service.updateCharacteristic(this.hapChar.OutletInUse, !!newInUse)
        if (this.enableLogging) {
          this.log('[%s] current in-use [%s].', this.name, newInUse ? 'yes' : 'no')
        }
      }
    }
  }

  async setupPowerReadings () {
    // Add the request to the queue so updates are send apart
    return await this.queue.add(async () => {
      // This flag stops the plugin from requesting updates while pending on others
      this.updateInProgress = true
      try {
        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.Control.Electricity',
          payload: {}
        })

        // Check the response is in a useful format
        if (res.data.payload && res.data.payload.electricity) {
          // Setup the outlet in use and Eve characteristics
          if (!this.service.testCharacteristic(this.hapChar.OutletInUse)) {
            this.service.addCharacteristic(this.hapChar.OutletInUse)
          }
          if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
            this.service.addCharacteristic(this.eveChar.CurrentConsumption)
          }

          // Create the poll
          this.requestPowerReadings()
          this.powerInterval = setInterval(() => this.requestPowerReadings(), 60000)
        }
      } catch (err) {
        // A socket hang up error means device does not support this
      }
    })
  }

  async requestPowerReadings () {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true
        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.Control.Electricity',
          payload: {}
        })

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
        }

        // Check the response is in a useful format
        const data = res.data.payload
        if (data && data.electricity) {
          this.applyUpdate(data.electricity)
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to request power as %s.', this.name, eText)
    }
  }
}
