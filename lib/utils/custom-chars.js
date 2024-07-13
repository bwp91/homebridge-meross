import { inherits } from 'util';

export default class {
  constructor(api) {
    this.hapServ = api.hap.Service;
    this.hapChar = api.hap.Characteristic;
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
      lightNightWhite: 'E962F010-079E-48FF-8F27-9C2605A29F52',
      babySceneOne: 'E962F011-079E-48FF-8F27-9C2605A29F52',
      babySceneTwo: 'E962F012-079E-48FF-8F27-9C2605A29F52',
      babySceneThree: 'E962F013-079E-48FF-8F27-9C2605A29F52',
      babySceneFour: 'E962F014-079E-48FF-8F27-9C2605A29F52',
    };
    const self = this;
    this.DiffColourMode = function DiffColourMode() {
      self.hapChar.call(this, 'Colour Mode', self.uuids.diffColourMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.DiffRainbowMode = function DiffRainbowMode() {
      self.hapChar.call(this, 'Rainbow Mode', self.uuids.diffRainbowMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.DiffTemperatureMode = function DiffTemperatureMode() {
      self.hapChar.call(this, 'Temperature Mode', self.uuids.diffTemperatureMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.ValveHeatMode = function ValveHeatMode() {
      self.hapChar.call(this, 'Heat Mode', self.uuids.valveHeatMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.ValveCoolMode = function ValveCoolMode() {
      self.hapChar.call(this, 'Cool Mode', self.uuids.valveCoolMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.ValveAutoMode = function ValveAutoMode() {
      self.hapChar.call(this, 'Auto Mode', self.uuids.valveAutoMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.ValveEconomyMode = function ValveEconomyMode() {
      self.hapChar.call(this, 'Economy Mode', self.uuids.valveEconomyMode);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.ValveWindowOpen = function ValveWindowOpen() {
      self.hapChar.call(this, 'Window Open', self.uuids.valveWindowOpen);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.LightNightWarm = function LightNightWarm() {
      self.hapChar.call(this, 'Night Light Warm', self.uuids.lightNightWarm);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.LightNightWhite = function LightNightWhite() {
      self.hapChar.call(this, 'Night Light White', self.uuids.lightNightWhite);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.BabySceneOne = function BabySceneOne() {
      self.hapChar.call(this, 'Baby Scene 1', self.uuids.babySceneOne);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.BabySceneTwo = function BabySceneTwo() {
      self.hapChar.call(this, 'Baby Scene 2', self.uuids.babySceneTwo);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.BabySceneThree = function BabySceneThree() {
      self.hapChar.call(this, 'Baby Scene 3', self.uuids.babySceneThree);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    this.BabySceneFour = function BabySceneFour() {
      self.hapChar.call(this, 'Baby Scene 4', self.uuids.babySceneFour);
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.READ, api.hap.Perms.WRITE, api.hap.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherits(this.DiffColourMode, this.hapChar);
    inherits(this.DiffRainbowMode, this.hapChar);
    inherits(this.DiffTemperatureMode, this.hapChar);
    inherits(this.ValveHeatMode, this.hapChar);
    inherits(this.ValveCoolMode, this.hapChar);
    inherits(this.ValveAutoMode, this.hapChar);
    inherits(this.ValveEconomyMode, this.hapChar);
    inherits(this.ValveWindowOpen, this.hapChar);
    inherits(this.LightNightWarm, this.hapChar);
    inherits(this.LightNightWhite, this.hapChar);
    inherits(this.BabySceneOne, this.hapChar);
    inherits(this.BabySceneTwo, this.hapChar);
    inherits(this.BabySceneThree, this.hapChar);
    inherits(this.BabySceneFour, this.hapChar);
    this.DiffColourMode.UUID = this.uuids.diffColourMode;
    this.DiffRainbowMode.UUID = this.uuids.diffRainbowMode;
    this.DiffTemperatureMode.UUID = this.uuids.diffTemperatureMode;
    this.ValveHeatMode.UUID = this.uuids.valveHeatMode;
    this.ValveCoolMode.UUID = this.uuids.valveCoolMode;
    this.ValveAutoMode.UUID = this.uuids.valveAutoMode;
    this.ValveEconomyMode.UUID = this.uuids.valveEconomyMode;
    this.ValveWindowOpen.UUID = this.uuids.valveWindowOpen;
    this.LightNightWarm.UUID = this.uuids.lightNightWarm;
    this.LightNightWhite.UUID = this.uuids.lightNightWhite;
    this.BabySceneOne.UUID = this.uuids.babySceneOne;
    this.BabySceneTwo.UUID = this.uuids.babySceneTwo;
    this.BabySceneThree.UUID = this.uuids.babySceneThree;
    this.BabySceneFour.UUID = this.uuids.babySceneFour;
  }
}
