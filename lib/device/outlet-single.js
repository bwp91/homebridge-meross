/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')
const { TimeoutError } = require('p-timeout')

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
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has an air purifier service then remove it
    if (this.accessory.getService(this.hapServ.AirPurifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.AirPurifier))
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

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('energy', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

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

    // Always request a device update on startup, then start the interval for polling
    this.requestUpdate(true)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000
    )

    // Test to see if the device supports power usage
    this.setupPowerReadings()

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      inUsePowerThreshold: this.inUsePowerThreshold,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      showAs: 'outlet'
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
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
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
      const eText = this.funcs.parseError(err)
      if (this.enableDebugLogging) {
        this.log.warn('[%s] failed to request status as %s.', this.name, eText)
      }

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (
        this.accessory.context.connection === 'local' &&
        this.accessory.context.isOnline &&
        ['EHOSTUNREACH', '000ms exceeded'].some(el => eText.includes(el))
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
      const newPower = data.power
      const scaledPower = Math.round(newPower / 10) / 100
      const newkWh = scaledPower / 60000

      // Check against the cache and update HomeKit and the cache if needed
      let newInUse = this.cacheInUse
      let doLog = false
      if (this.cachePower !== newPower) {
        newInUse = this.cacheState && scaledPower > this.inUsePowerThreshold
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, scaledPower)
        this.accessory.eveService.addEntry({ power: scaledPower })
        this.cachePower = newPower
        if (this.cacheScaledPower !== scaledPower) {
          this.cacheScaledPower = scaledPower
          doLog = true
        }
      }

      // Update the total consumption, approximating by using this power value as during a minute
      const newTotalkWh = newkWh + this.accessory.context.totalkWh
      this.accessory.context.totalkWh = newTotalkWh
      if (newTotalkWh !== this.cacheTotal) {
        this.service.updateCharacteristic(this.eveChar.TotalConsumption, newTotalkWh)
        this.cacheTotal = newTotalkWh
        const newScaledTotal = Math.round(newTotalkWh * 100) / 100
        if (this.cacheScaledTotal !== newScaledTotal) {
          this.cacheScaledTotal = newScaledTotal
          doLog = true
        }
      }

      // Log both the W and kWh if either have changed
      if (this.enableDebugLogging && doLog) {
        this.log(
          '[%s] current power [%sW] [%skWh].',
          this.name,
          this.cacheScaledPower,
          this.cacheScaledTotal
        )
      }

      // Update the OutletInUse property
      if (this.cacheInUse !== newInUse) {
        this.cacheInUse = newInUse
        this.service.updateCharacteristic(this.hapChar.OutletInUse, !!newInUse)
        if (this.enableLogging) {
          this.log('[%s] current in-use [%s].', this.name, newInUse ? 'yes' : 'no')
        }
      }
    }
    if (this.funcs.hasProperty(data, 'voltage')) {
      // newState is given as 0 or 1 -> convert to bool for HomeKit
      const newVoltage = data.voltage

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheVoltage !== newVoltage) {
        const scaledVoltage = Math.round(newVoltage * 10) / 100
        this.service.updateCharacteristic(this.eveChar.Voltage, scaledVoltage)
        this.cacheVoltage = newVoltage
        if (this.enableDebugLogging) {
          this.log('[%s] current voltage [%sV].', this.name, scaledVoltage)
        }
      }
    }
  }

  async setupPowerReadings () {
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
        // Check the response is in a useful format
        if (!res.data.payload || !res.data.payload.electricity) {
          throw new Error('no data on initial run')
        }

        // Setup the outlet in use and Eve characteristics
        if (!this.service.testCharacteristic(this.hapChar.OutletInUse)) {
          this.service.addCharacteristic(this.hapChar.OutletInUse)
        }
        if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
          this.service.addCharacteristic(this.eveChar.CurrentConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.TotalConsumption)) {
          this.service.addCharacteristic(this.eveChar.TotalConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.addCharacteristic(this.eveChar.Voltage)
        }
        if (!this.service.testCharacteristic(this.eveChar.ResetTotal)) {
          this.service.addCharacteristic(this.eveChar.ResetTotal)
        }
        if (!this.funcs.hasProperty(this.accessory.context, 'totalkWh')) {
          this.accessory.context.totalkWh = 0
        }

        // Add the set handler to the outlet eve reset total energy characteristic
        this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(value => {
          this.accessory.context.totalkWh = 0
          this.service.updateCharacteristic(this.eveChar.TotalConsumption, 0)
        })

        // Create the poll
        this.requestPowerReadings()
        this.accessory.powerInterval = setInterval(() => this.requestPowerReadings(), 60000)
      })
    } catch (err) {
      const eText = this.funcs.parseError(err, ['no data on initial run'])
      if (this.enableDebugLogging) {
        this.log('[%s] disabling power readings interval as %s.', this.name, eText)
      }
    }
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

      // Also don't increase the measured total consumption in case of any error
      this.accessory.eveService.addEntry({ power: 0 })
    }
  }
}
