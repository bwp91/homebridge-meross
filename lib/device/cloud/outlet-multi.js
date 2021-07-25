/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceCloudOutletMulti {
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
    this.channel = accessory.context.channel
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.name = accessory.displayName

    // Set up some objects that link channel numbers to service names
    this.channel2Index = {}
    this.index2Channel = {}
    this.cacheStates = {}

    // Loop through the channels creating outlet services if they don't exist already
    let i = -1
    Object.values(accessory.context.channels).forEach(channel => {
      i++
      if (!channel.devName) {
        return
      }

      // Add values to the linking objects
      this.channel2Index[channel.devName] = i
      this.index2Channel[i] = channel.devName

      // Find or add the outlet service
      let service =
        this.accessory.getService(channel.devName) ||
        this.accessory.addService(this.hapServ.Outlet, channel.devName, channel.devName)

      // Check the service is a switch service
      if (service.constructor.name !== 'Outlet') {
        this.accessory.removeService(service)
        service = this.accessory.addService(this.hapServ.Outlet, channel.devName, channel.devName)
      }

      // Add the set handler to the outlet on characteristic
      service
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => await this.internalStateUpdate(channel.devName, value))
    })

    // Remove any outlet services that are unused, example if a user renames a channel in meross app
    this.accessory.services.forEach(service => {
      // Remove any switch services the accessory has
      if (service.constructor.name === 'Switch') {
        this.accessory.removeService(service)
        return
      }

      // We now only concentrate on the outlet services
      if (service.constructor.name !== 'Outlet') {
        return
      }

      // Remove the service if an entry doesn't exist for this service name
      if (!Object.values(this.index2Channel).includes(service.displayName)) {
        this.accessory.removeService(service)
      }
    })

    // Always request a device update on startup, then enable polling if user enabled
    this.requestDeviceUpdate()
    if (this.platform.config.cloudRefreshRate > 0) {
      this.refreshinterval = setInterval(
        () => this.requestDeviceUpdate(),
        this.platform.config.cloudRefreshRate * 1000
      )
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

  async internalStateUpdate (channelName, value) {
    try {
      // Don't continue if the state is the same as before
      if (value === this.cacheStates[channelName]) {
        return
      }

      // Send the command
      await this.accessory.mqtt.controlToggleX(this.channel2Index[channelName], value)

      // Update the cache and log if appropriate
      this.cacheStates[channelName] = value
      if (this.enableLogging) {
        this.log(
          '[%s] [%s] current state [%s].',
          this.name,
          channelName,
          this.cacheStates[channelName] ? 'on' : 'off'
        )
      }
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

  async requestDeviceUpdate () {
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
        // Attempt to find the service that this channel relates to
        const serviceName = this.index2Channel[channel.channel]
        const service = this.accessory.getService(serviceName)

        // Don't continue if the service doesn't exist
        if (!service) {
          return
        }

        // Read the current state
        const newState = channel.onoff

        // Don't continue if the state is the same as before
        if (newState === this.cacheStates[serviceName]) {
          return
        }

        // Update the HomeKit characteristics
        service.updateCharacteristic(this.hapChar.On, newState)

        // Update the cache and log the change if the user has logging turned on
        this.cacheStates[serviceName] = newState
        if (this.enableLogging) {
          this.log('[%s] [%s] current state [%s].', this.name, serviceName, newState ? 'on' : 'off')
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  externalUpdate (namespace, payload) {
    try {
      // If debug enabled then log the response
      if (this.enableDebugLogging) {
        this.log(
          '[%s] incoming mqtt message [%s]:\n%s',
          this.name,
          namespace,
          JSON.stringify(payload)
        )
      }

      // Check the data is in a format which contains the value we need
      if (
        namespace !== 'Appliance.Control.ToggleX' ||
        !payload.togglex ||
        !this.funcs.hasProperty(payload.togglex, 'channel')
      ) {
        throw new Error('data in invalid format')
      }

      // Find the channel which has been updated, and the service that it relates to
      const channel = payload.togglex.channel
      const serviceName = this.index2Channel[channel]
      const service = this.accessory.getService(serviceName)
      const newState = payload.togglex.onoff === 1

      // Don't continue if the state is the same as before
      if (newState === this.cacheStates[serviceName]) {
        return
      }

      // Update the HomeKit characteristics
      service.updateCharacteristic(this.hapChar.On, newState)

      // Update the cache and log the change if the user has logging turned on
      this.cacheStates[serviceName] = newState
      if (this.enableLogging) {
        this.log('[%s] [%s] current state [%s].', this.name, serviceName, newState ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
