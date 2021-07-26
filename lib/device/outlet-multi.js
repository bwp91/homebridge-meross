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
    this.accessory.context.channel = accessory.context.channel
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.name = accessory.displayName

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Outlet) ||
      this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the outlet on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      if (accessory.context.connection === 'cloud') {
        await this.internalCloudStateUpdate(value)
      } else {
        await this.internalLocalStateUpdate(value)
      }
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

    if (accessory.context.connection === 'local') {
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
    }

    if (accessory.context.channel === 0) {
      // Always request a device update on startup, then enable polling if user enabled
      if (accessory.context.connection === 'cloud') {
        // Set up the mqtt client for cloud devices to send and receive device updates
        this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
        this.accessory.mqtt.connect()

        this.requestCloudUpdate()
        if (this.platform.config.cloudRefreshRate > 0) {
          this.refreshinterval = setInterval(
            () => this.requestCloudUpdate(),
            this.platform.config.cloudRefreshRate * 1000
          )
        }
      } else {
        this.requestLocalUpdate()
        if (this.platform.config.refreshRate > 0) {
          this.refreshinterval = setInterval(
            () => this.requestLocalUpdate(),
            this.platform.config.refreshRate * 1000
          )
        }
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

  async internalCloudStateUpdate (value) {
    try {
      // Don't continue if the state is the same as before
      if (value === this.service.getCharacteristic(this.hapChar.On).value) {
        return
      }

      // Get the primary accessory instance to send the command
      let accessory
      if (this.accessory.context.channel === 0) {
        accessory = this.accessory
      } else {
        const uuidPri = this.platform.api.hap.uuid.generate(
          this.accessory.context.serialNumber + '0'
        )
        accessory = this.devicesInHB.get(uuidPri)
      }

      // Send the command
      await accessory.mqtt.controlToggleX(this.accessory.context.channel, value)

      // Update the cache and log if appropriate
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }

      // Update the other accessories of this device with the correct status
      switch (this.accessory.context.channel) {
        case 0: {
          // Update all the sub accessories with the same status
          for (let i = 1; i < this.accessory.context.channelCount; i++) {
            const uuidSub = this.platform.api.hap.uuid.generate(
              this.accessory.context.serialNumber + i
            )
            const subAcc = this.devicesInHB.get(uuidSub)
            if (subAcc) {
              const curState = subAcc
                .getService(this.hapServ.Outlet)
                .getCharacteristic(this.hapChar.On).value
              if (curState !== value) {
                subAcc.getService(this.hapServ.Outlet).updateCharacteristic(this.hapChar.On, value)
                if (subAcc.context.enableLogging) {
                  this.log('[%s] current state [%s].', subAcc.displayName, value ? 'on' : 'off')
                }
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
            const uuidSub = this.platform.api.hap.uuid.generate(
              this.accessory.context.serialNumber + i
            )
            const subAcc = this.devicesInHB.get(uuidSub)
            if (subAcc) {
              if (i === this.accessory.context.channel) {
                if (value) {
                  primaryState = true
                }
              } else {
                if (
                  subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value
                ) {
                  primaryState = true
                }
              }
            }
          }
          if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
            const uuidPri = this.platform.api.hap.uuid.generate(
              this.accessory.context.serialNumber + '0'
            )
            const priAcc = this.devicesInHB.get(uuidPri)
            if (priAcc) {
              const curState = priAcc
                .getService(this.hapServ.Outlet)
                .getCharacteristic(this.hapChar.On).value
              if (primaryState !== curState) {
                priAcc
                  .getService(this.hapServ.Outlet)
                  .updateCharacteristic(this.hapChar.On, primaryState)
                if (priAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    priAcc.displayName,
                    primaryState ? 'on' : 'off'
                  )
                }
              }
            }
          }
          break
        }
      }
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending cloud update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.On,
          this.service.getCharacteristic(this.hapChar.On).value
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLocalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send according to configured push rate
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.service.getCharacteristic(this.hapChar.On).value) {
          return
        }

        // This flag stops the plugin from requesting updates while sending one
        this.updateInProgress = true

        // Log the update
        if (this.enableDebugLogging) {
          this.log('[%s] sending local request for state [%s].', this.name, value ? 'on' : 'off')
        }

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: this.accessory.context.channel
          }
        }

        // Use the platform function to send the update to the device
        const res = await this.platform.sendLocalDeviceUpdate(this.accessory, namespace, payload)

        // Check the response
        if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
          throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
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
              const uuidSub = this.platform.api.hap.uuid.generate(
                this.accessory.context.serialNumber + i
              )
              const subAcc = this.devicesInHB.get(uuidSub)
              if (subAcc) {
                const curState = subAcc
                  .getService(this.hapServ.Outlet)
                  .getCharacteristic(this.hapChar.On).value
                if (curState !== value) {
                  subAcc
                    .getService(this.hapServ.Outlet)
                    .updateCharacteristic(this.hapChar.On, value)
                  if (subAcc.context.enableLogging) {
                    this.log('[%s] current state [%s].', subAcc.displayName, value ? 'on' : 'off')
                  }
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
              const uuidSub = this.platform.api.hap.uuid.generate(
                this.accessory.context.serialNumber + i
              )
              const subAcc = this.devicesInHB.get(uuidSub)
              if (subAcc) {
                if (i === this.accessory.context.channel) {
                  if (value) {
                    primaryState = true
                  }
                } else {
                  if (
                    subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value
                  ) {
                    primaryState = true
                  }
                }
              }
            }
            if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
              const uuidPri = this.platform.api.hap.uuid.generate(
                this.accessory.context.serialNumber + '0'
              )
              const priAcc = this.devicesInHB.get(uuidPri)
              if (priAcc) {
                const curState = priAcc
                  .getService(this.hapServ.Outlet)
                  .getCharacteristic(this.hapChar.On).value
                if (primaryState !== curState) {
                  priAcc
                    .getService(this.hapServ.Outlet)
                    .updateCharacteristic(this.hapChar.On, primaryState)
                  if (priAcc.context.enableLogging) {
                    this.log(
                      '[%s] current state [%s].',
                      priAcc.displayName,
                      primaryState ? 'on' : 'off'
                    )
                  }
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
      this.log.warn('[%s] sending local update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.On,
          this.service.getCharacteristic(this.hapChar.On).value
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestCloudUpdate () {
    try {
      // Send a request for a status update for the device
      const result = await this.accessory.mqtt.getSystemAllData()

      // If debug enabled then log the response
      if (this.enableDebugLogging) {
        this.log('[%s] incoming poll message:\n%s', this.name, JSON.stringify(result.payload))
      }

      // Check the data is in a format which contains the value we need
      if (
        !result.payload ||
        !result.payload.all ||
        !result.payload.all.digest ||
        !result.payload.all.digest.togglex ||
        !Array.isArray(result.payload.all.digest.togglex)
      ) {
        throw new Error('data in invalid format')
      }

      result.payload.all.digest.togglex.forEach(channel => {
        // Attempt to find the accessory this channel relates to
        let accessory
        let service

        // If this iteration's channel is 0 then this.accessory is the accessory we need
        if (channel.channel === 0) {
          accessory = this.accessory
          service = this.service
        } else {
          // Generate the homebridge uuid of the accessory we are looking for
          const uuid = this.platform.api.hap.uuid.generate(
            this.accessory.context.serialNumber + channel.channel
          )

          // Obtain the accessory and check it exists
          accessory = this.devicesInHB.get(uuid)
          if (!accessory) {
            return
          }

          // Obtain the service
          service = accessory.getService(this.hapServ.Outlet)
        }

        // Read the current state
        const newState = channel.onoff === 1

        // Don't continue if the state is the same as before
        if (newState === service.getCharacteristic(this.hapChar.On).value) {
          return
        }

        // Update the HomeKit characteristics
        service.updateCharacteristic(this.hapChar.On, newState)

        // Update the cache and log the change if the user has logging turned on
        if (accessory.context.enableLogging) {
          this.log('[%s] current state [%s].', accessory.displayName, newState ? 'on' : 'off')
        }
      })

      // Check for the primary accessory state
      if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
        let primaryState = false
        for (let i = 1; i <= this.accessory.context.channelCount; i++) {
          const uuidSub = this.platform.api.hap.uuid.generate(
            this.accessory.context.serialNumber + i
          )
          const subAcc = this.devicesInHB.get(uuidSub)
          if (subAcc) {
            if (subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value) {
              primaryState = true
            }
          }
        }
        const uuidPri = this.platform.api.hap.uuid.generate(
          this.accessory.context.serialNumber + '0'
        )
        const priAcc = this.devicesInHB.get(uuidPri)
        if (priAcc) {
          const curState = priAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On)
            .value
          if (primaryState !== curState) {
            priAcc
              .getService(this.hapServ.Outlet)
              .updateCharacteristic(this.hapChar.On, primaryState)
            if (priAcc.context.enableLogging) {
              this.log('[%s] current state [%s].', priAcc.displayName, primaryState ? 'on' : 'off')
            }
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  async requestLocalUpdate () {
    // TODO
  }

  externalCloudUpdate (namespace, payload) {
    try {
      // If debug enabled then log the response
      if (this.enableDebugLogging) {
        this.log(
          '[%s] incoming cloud mqtt message [%s]:\n%s',
          this.name,
          namespace,
          JSON.stringify(payload)
        )
      }

      // Check the data is in a format which contains the value we need
      if (namespace !== 'Appliance.Control.ToggleX' || !payload.togglex) {
        throw new Error('data in invalid format')
      }

      // payload.togglex can either be an array of objects (multiple channels) or a single object
      // Either way, push all items into one array
      const toUpdate = []
      if (Array.isArray(payload.togglex)) {
        payload.togglex.forEach(item => toUpdate.push(item))
      } else {
        toUpdate.push(payload.togglex)
      }

      // Loop the array for each channel that was provided
      toUpdate.forEach(channel => {
        // Attempt to find the accessory this channel relates to
        let accessory
        let service

        // If this iteration's channel is 0 then this.accessory is the accessory we need
        if (channel.channel === 0) {
          accessory = this.accessory
          service = this.service
        } else {
          // Generate the homebridge uuid of the accessory we are looking for
          const uuid = this.platform.api.hap.uuid.generate(
            this.accessory.context.serialNumber + channel.channel
          )

          // Obtain the accessory and check it exists
          accessory = this.devicesInHB.get(uuid)
          if (!accessory) {
            return
          }

          // Obtain the service
          service = accessory.getService(this.hapServ.Outlet)
        }

        // Read the current state
        const newState = channel.onoff === 1

        // Don't continue if the state is the same as before
        if (newState === service.getCharacteristic(this.hapChar.On).value) {
          return
        }

        // Update the HomeKit characteristics
        service.updateCharacteristic(this.hapChar.On, newState)

        // Update the cache and log the change if the user has logging turned on
        if (accessory.context.enableLogging) {
          this.log('[%s] current state [%s].', accessory.displayName, newState ? 'on' : 'off')
        }
      })

      // Check for the primary accessory state
      if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
        let primaryState = false
        for (let i = 1; i <= this.accessory.context.channelCount; i++) {
          const uuidSub = this.platform.api.hap.uuid.generate(
            this.accessory.context.serialNumber + i
          )
          const subAcc = this.devicesInHB.get(uuidSub)
          if (subAcc) {
            if (subAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On).value) {
              primaryState = true
            }
          }
        }
        const uuidPri = this.platform.api.hap.uuid.generate(
          this.accessory.context.serialNumber + '0'
        )
        const priAcc = this.devicesInHB.get(uuidPri)
        if (priAcc) {
          const curState = priAcc.getService(this.hapServ.Outlet).getCharacteristic(this.hapChar.On)
            .value
          if (primaryState !== curState) {
            priAcc
              .getService(this.hapServ.Outlet)
              .updateCharacteristic(this.hapChar.On, primaryState)
            if (priAcc.context.enableLogging) {
              this.log('[%s] current state [%s].', priAcc.displayName, primaryState ? 'on' : 'off')
            }
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
