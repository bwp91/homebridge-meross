/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceHubMain {
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
    // this.enableLogging = accessory.context.enableLogging
    // this.enableDebugLogging = accessory.context.enableDebugLogging

    // Whilst in dev, override the logging to true
    this.enableLogging = true
    this.enableDebugLogging = true

    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000

    // Not sure how realtime mqtt updates work with this device, so force enable cloud polling
    if (this.pollInterval === 0) {
      this.pollInterval = 30000
    }

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
    setTimeout(() => {
      // Set a small timeout so the other sensor accessories will have initialised
      this.requestUpdate(true)
    }, 5000)
    if (this.pollInterval > 0) {
      this.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
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

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
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
            data.all.digest.hub &&
            data.all.digest.hub.subdevice &&
            Array.isArray(data.all.digest.hub.subdevice)
          ) {
            this.log.warn('NO ERROR - received subdevice array. working.')
            data.all.digest.hub.subdevice.forEach(subdevice => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(
                  this.accessory.context.serialNumber + subdevice.id
                )
              )
              this.log.warn('NO ERROR - %s.', JSON.stringify(subdevice))
              // No need to continue if the accessory doesn't exist or neither the receiver func
              // if (!subAcc || !subAcc.control.applyUpdate || !subdevice.ms100) {
              //  return
              // }

              if (!subAcc) {
                this.log.warn('NO ERROR - returning as accessory not found')
                return
              }

              if (!subAcc.control.applyUpdate) {
                this.log.warn('NO ERROR - returning as accessory receiver fn not found')
                return
              }

              if (!subdevice.ms100) {
                this.log.warn('NO ERROR - returning as ms100 property not found in subdevice')
                return
              }

              this.log.warn('NO ERROR - applying update for %s.', subdevice.id)

              // Apply the update to the accessory
              subAcc.control.applyUpdate({
                temperature: subdevice.ms100.latestTemperature,
                humidity: subdevice.ms100.latestHumidity,
                voltage: subdevice.ms100.voltage
              })
            })
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
            this.devicesInHB.forEach(subAcc => {
              if (subAcc.context.serialNumber === this.accessory.context.serialNumber) {
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
            })
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
      /*
      if (params.payload) {
        if (params.payload.togglex && params.payload.togglex[0]) {
          this.applyUpdate(params.payload.togglex[0])
        } else if (params.payload.toggle) {
          this.applyUpdate(params.payload.toggle)
        }
      }
      */
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
    // Check the data is in a format which contains the value we need
    /*
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
    */
  }
}
