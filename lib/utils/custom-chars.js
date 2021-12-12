/* jshint node: true, esversion: 10, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class customCharacteristics {
  constructor (api) {
    this.hapServ = api.hap.Service
    this.hapChar = api.hap.Characteristic
    this.uuids = {
      diffColourMode: 'E962F001-079E-48FF-8F27-9C2605A29F52',
      diffRainbowMode: 'E962F002-079E-48FF-8F27-9C2605A29F52',
      diffTemperatureMode: 'E962F003-079E-48FF-8F27-9C2605A29F52',
      valveHeatMode: 'E962F004-079E-48FF-8F27-9C2605A29F52',
      valveCoolMode: 'E962F005-079E-48FF-8F27-9C2605A29F52',
      valveAutoMode: 'E962F006-079E-48FF-8F27-9C2605A29F52',
      valveEconomyMode: 'E962F007-079E-48FF-8F27-9C2605A29F52',
      valveWindowOpen: 'E962F008-079E-48FF-8F27-9C2605A29F52',
      lightNightWarm: 'E962F009-079E-48FF-8F27-9C2605A29F52',
      lightNightWhite: 'E962F010-079E-48FF-8F27-9C2605A29F52'
    }
    const self = this
    this.DiffColourMode = function () {
      self.hapChar.call(this, 'Colour Mode', self.uuids.diffColourMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.DiffRainbowMode = function () {
      self.hapChar.call(this, 'Rainbow Mode', self.uuids.diffRainbowMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.DiffTemperatureMode = function () {
      self.hapChar.call(this, 'Temperature Mode', self.uuids.diffTemperatureMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.ValveHeatMode = function () {
      self.hapChar.call(this, 'Heat Mode', self.uuids.valveHeatMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.ValveCoolMode = function () {
      self.hapChar.call(this, 'Cool Mode', self.uuids.valveCoolMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.ValveAutoMode = function () {
      self.hapChar.call(this, 'Auto Mode', self.uuids.valveAutoMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.ValveEconomyMode = function () {
      self.hapChar.call(this, 'Economy Mode', self.uuids.valveEconomyMode)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.ValveWindowOpen = function () {
      self.hapChar.call(this, 'Window Open', self.uuids.valveWindowOpen)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.LightNightWarm = function () {
      self.hapChar.call(this, 'Night Light Warm', self.uuids.lightNightWarm)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.LightNightWhite = function () {
      self.hapChar.call(this, 'Night Light White', self.uuids.lightNightWhite)
      this.setProps({
        format: self.hapChar.Formats.BOOL,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.WRITE, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }

    const inherits = require('util').inherits
    inherits(this.DiffColourMode, this.hapChar)
    inherits(this.DiffRainbowMode, this.hapChar)
    inherits(this.DiffTemperatureMode, this.hapChar)
    inherits(this.ValveHeatMode, this.hapChar)
    inherits(this.ValveCoolMode, this.hapChar)
    inherits(this.ValveAutoMode, this.hapChar)
    inherits(this.ValveEconomyMode, this.hapChar)
    inherits(this.ValveWindowOpen, this.hapChar)
    inherits(this.LightNightWarm, this.hapChar)
    inherits(this.LightNightWhite, this.hapChar)
    this.DiffColourMode.UUID = this.uuids.diffColourMode
    this.DiffRainbowMode.UUID = this.uuids.diffRainbowMode
    this.DiffTemperatureMode.UUID = this.uuids.diffTemperatureMode
    this.ValveHeatMode.UUID = this.uuids.valveHeatMode
    this.ValveCoolMode.UUID = this.uuids.valveCoolMode
    this.ValveAutoMode.UUID = this.uuids.valveAutoMode
    this.ValveEconomyMode.UUID = this.uuids.valveEconomyMode
    this.ValveWindowOpen.UUID = this.uuids.valveWindowOpen
    this.LightNightWarm.UUID = this.uuids.lightNightWarm
    this.LightNightWhite.UUID = this.uuids.lightNightWhite
  }
}
