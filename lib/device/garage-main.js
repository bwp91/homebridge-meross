/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceGarageMain {
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
    setTimeout(() => this.requestUpdate(true), 5000)
    if (this.pollInterval > 0) {
      this.accessory.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
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
            data.all.digest.garageDoor &&
            Array.isArray(data.all.digest.garageDoor)
          ) {
            data.all.digest.garageDoor.forEach(channel => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(
                  this.accessory.context.serialNumber + channel.channel
                )
              )

              // No need to continue if the accessory doesn't exist nor the receiver function
              if (!subAcc || !subAcc.control.applyUpdate) {
                return
              }

              // Apply the update to the accessory
              subAcc.control.applyUpdate(channel)
            })
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (firstRun && data.all.system) {
            // Mac address, IP and firmware don't change regularly so only get on first poll
            if (data.all.system.hardware) {
              this.cacheMac = data.all.system.hardware.macAddress.toUpperCase()
              this.cacheHardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              this.cacheIP = data.all.system.firmware.innerIp
              this.cacheFirmware = data.all.system.firmware.version
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
      if (data.garageDoor) {
        // payload.garageDoor maybe array of objects (multiple channels) or a single object
        // Either way, push all items into one array
        const toUpdate = []
        if (Array.isArray(data.garageDoor)) {
          data.garageDoor.forEach(item => toUpdate.push(item))
        } else {
          toUpdate.push(data.garageDoor)
        }

        toUpdate.forEach(channel => {
          // Check whether the homebridge accessory this relates to exists
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(
              this.accessory.context.serialNumber + channel.channel
            )
          )

          // No need to continue if the accessory doesn't exist nor the receiver function
          if (!subAcc || !subAcc.control.applyUpdate) {
            return
          }

          // Apply the update to the accessory
          subAcc.control.applyUpdate(channel)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
