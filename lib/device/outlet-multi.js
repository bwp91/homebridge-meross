/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceOutletMulti {
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
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000
    this.priAccHBUUID = this.platform.api.hap.uuid.generate(accessory.context.serialNumber + '0')

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Outlet) ||
      this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the outlet on/off characteristic
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

    // We only need to setup mqtt client and polling for 'main' accessory (channel 0)
    if (accessory.context.channel === 0) {
      // Set up the mqtt client for cloud devices to send and receive device updates
      if (accessory.context.connection === 'cloud') {
        this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
        this.accessory.mqtt.connect()
      }

      // Always request a device update on startup, then enable polling if user enabled
      this.requestUpdate()
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
    }
  }

  async internalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send according to configured push rate
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.service.getCharacteristic(this.hapChar.On).value) {
          return
        }

        // This flag stops the plugin from requesting updates while sending one
        this.updateInProgress = true

        switch (this.accessory.context.connection) {
          case 'cloud': {
            // Get the primary accessory instance to send the command
            const accessory =
              this.accessory.context.channel === 0
                ? this.accessory
                : this.devicesInHB.get(this.priAccHBUUID)

            // Send the command
            await accessory.mqtt.controlToggleX(this.accessory.context.channel, value)
            break
          }
          case 'local': {
            // Generate the payload and namespace for the correct device model
            const namespace = 'Appliance.Control.ToggleX'
            const payload = {
              togglex: {
                onoff: value ? 1 : 0,
                channel: this.accessory.context.channel
              }
            }

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
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
              const hapServ = subAcc.getService(this.hapServ.Outlet)
              const hapChar = hapServ.getCharacteristic(this.hapChar.On)
              if (hapChar.value !== value) {
                hapChar.updateValue(value)
                if (subAcc.context.enableLogging) {
                  this.log('[%s] current state [%s].', subAcc.displayName, value ? 'on' : 'off')
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
                const hapServ = subAcc.getService(this.hapServ.Outlet)
                const hapChar = hapServ.getCharacteristic(this.hapChar.On)
                if (hapChar.value) {
                  primaryState = true
                }
              }
            }
            if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
              const priAcc = this.devicesInHB.get(this.priAccHBUUID)
              const hapServ = priAcc.getService(this.hapServ.Outlet)
              const hapChar = hapServ.getCharacteristic(this.hapChar.On)
              if (hapChar.value !== primaryState) {
                hapChar.updateValue(primaryState)
                if (priAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    priAcc.displayName,
                    primaryState ? 'on' : 'off'
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
        this.service.updateCharacteristic(
          this.hapChar.On,
          this.service.getCharacteristic(this.hapChar.On).value
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate () {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Send a request for a status update for the device
      const res =
        this.accessory.context.connection === 'cloud'
          ? await this.accessory.mqtt.getSystemAllData()
          : await this.platform.requestLocalUpdate(this.accessory, 'Appliance.System.All')

      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
      }

      // Validate the response, checking for payload property
      if (!res.data || !res.data.payload) {
        throw new Error('invalid response received')
      }
      const data = res.data.payload

      // Check the response is in a useful format
      if (
        data.all &&
        data.all.digest &&
        data.all.digest.togglex &&
        Array.isArray(data.all.digest.togglex)
      ) {
        data.all.digest.togglex.forEach(channel => {
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
            channel.channel === 0 ? this.service : accessory.getService(this.hapServ.Outlet)
          const hapChar = hapServ.getCharacteristic(this.hapChar.On)

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
          if (subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value) {
            primaryState = true
          }
        }
        const priAcc = this.devicesInHB.get(this.priAccHBUUID)
        const hapChar = priAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On)
        if (hapChar.value !== primaryState) {
          hapChar.updateValue(primaryState)
          if (priAcc.context.enableLogging) {
            this.log('[%s] current state [%s].', priAcc.displayName, primaryState ? 'on' : 'off')
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  externalUpdate (namespace, params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt [%s]: %s.', this.name, namespace, JSON.stringify(params))
      }

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload

      // Check the data is in a format which contains the value we need
      if (namespace !== 'Appliance.Control.ToggleX' || !data.togglex) {
        return
      }

      // payload.togglex can either be an array of objects (multiple channels) or a single object
      // Either way, push all items into one array
      const toUpdate = []
      if (Array.isArray(data.togglex)) {
        data.togglex.forEach(item => toUpdate.push(item))
      } else {
        toUpdate.push(data.togglex)
      }

      // Loop the array for each channel that was provided
      toUpdate.forEach(channel => {
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
          channel.channel === 0 ? this.service : accessory.getService(this.hapServ.Outlet)
        const hapChar = hapServ.getCharacteristic(this.hapChar.On)

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
        if (subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value) {
          primaryState = true
        }
      }
      const priAcc = this.devicesInHB.get(this.priAccHBUUID)
      const hapChar = priAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On)
      if (hapChar.value !== primaryState) {
        hapChar.updateValue(primaryState)
        if (priAcc.context.enableLogging) {
          this.log('[%s] current state [%s].', priAcc.displayName, primaryState ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
