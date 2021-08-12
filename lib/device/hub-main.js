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
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate

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

    // Always request a device update on startup, then start the interval for polling
    setTimeout(() => this.requestUpdate(true), 5000)
    this.accessory.refreshinterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000
    )
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
            data.all.digest.hub.subdevice.forEach(subdevice => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(
                  this.accessory.context.serialNumber + subdevice.id
                )
              )

              // No need to continue if the accessory doesn't exist nor the receiver function
              if (!subAcc || !subAcc.control.applyUpdate) {
                return
              }

              // Properties we need are in ms100 object
              if (subdevice.ms100) {
                // Apply the update to the accessory
                subAcc.control.applyUpdate({
                  temperature: subdevice.ms100.latestTemperature,
                  humidity: subdevice.ms100.latestHumidity,
                  voltage: subdevice.ms100.voltage
                })
              } else if (subdevice.status === 2) {
                // If the status is 2 then has been reported offline - report a battery of 0
                subAcc.control.applyUpdate({ voltage: 0 })
              }
            })
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address and hardware don't change regularly so only get on first poll
            if (firstRun && data.all.system.hardware) {
              this.cacheMac = data.all.system.hardware.macAddress.toUpperCase()
              this.cacheHardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              // Check for an IP change each and every time the device is polled
              if (this.cacheIP !== data.all.system.firmware.innerIp) {
                this.cacheIP = data.all.system.firmware.innerIp
                needsUpdate = true
              }

              // Firmware doesn't change regularly so only get on first poll
              if (firstRun) {
                this.cacheFirmware = data.all.system.firmware.version
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.cacheOnline !== isOnline) {
              this.cacheOnline = isOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate || firstRun) {
            this.devicesInHB.forEach(subAcc => {
              if (subAcc.context.serialNumber === this.accessory.context.serialNumber) {
                subAcc.context = {
                  ...subAcc.context,
                  ...{
                    macAddress: this.cacheMac,
                    hardware: this.cacheHardware,
                    ipAddress: this.cacheIP,
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

  async requestSubdevices () {
    try {
      /*
        This function is unused but would be nice to find the correct payload to
        be able to request a subdevice list from the device itself rather than
        from the cloud.
      */
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.Hub.SubdeviceList',
          payload: {
            all: []
          }
        })

        // Log the received data
        // if (this.enableDebugLogging) {
        this.log.error('[%s] incoming subdevices: %s.', this.name, JSON.stringify(res.data))
        // }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to request subdevices as %s.', this.name, eText)
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      // if (this.enableDebugLogging) {
      this.log('[%s] incoming mqtt: %s.', this.name, JSON.stringify(params))
      this.log.warn(
        '[%s] if the above message contains temperature/humidity data, do let me know on github!',
        this.name
      )
      // }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
