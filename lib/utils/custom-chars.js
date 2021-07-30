/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class customCharacteristics {
  constructor (api) {
    this.hapServ = api.hap.Service
    this.hapChar = api.hap.Characteristic
    this.uuids = {
      diffColourMode: 'E962F001-079E-48FF-8F27-9C2605A29F52',
      diffRainbowMode: 'E962F002-079E-48FF-8F27-9C2605A29F52',
      diffTemperatureMode: 'E962F003-079E-48FF-8F27-9C2605A29F52'
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

    const inherits = require('util').inherits
    inherits(this.DiffColourMode, this.hapChar)
    inherits(this.DiffRainbowMode, this.hapChar)
    inherits(this.DiffTemperatureMode, this.hapChar)
    this.DiffColourMode.UUID = this.uuids.diffColourMode
    this.DiffRainbowMode.UUID = this.uuids.diffRainbowMode
    this.DiffTemperatureMode.UUID = this.uuids.diffTemperatureMode
  }
}
