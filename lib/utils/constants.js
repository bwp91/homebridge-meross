/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = {
  defaultConfig: {
    name: 'Meross',
    username: '',
    password: '',
    userkey: '',
    cloudRefreshRate: 300,
    refreshRate: 5,
    ignoreHKNative: false,
    hybridMode: false,
    disableDeviceLogging: false,
    debug: false,
    debugFakegato: false,
    disablePlugin: false,
    singleDevices: [],
    multiDevices: [],
    lightDevices: [],
    diffuserDevices: [],
    garageDevices: [],
    rollerDevices: [],
    sensorDevices: [],
    devices: [],
    platform: 'Meross'
  },

  defaultValues: {
    adaptiveLightingShift: 0,
    brightnessStep: 1,
    cloudRefreshRate: 0,
    connection: 'cloud',
    garageDoorOpeningTime: 20,
    inUsePowerThreshold: 0,
    lowBattThreshold: 20,
    overrideLogging: 'default',
    refreshRate: 5
  },

  minValues: {
    adaptiveLightingShift: -1,
    brightnessStep: 1,
    cloudRefreshRate: 30,
    garageDoorOpeningTime: 1,
    inUsePowerThreshold: 0,
    lowBattThreshold: 1,
    refreshRate: 5
  },

  allowed: {
    singleDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'showAs',
      'inUsePowerThreshold',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    multiDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'showAs',
      'hideChannels',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    lightDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'brightnessStep',
      'adaptiveLightingShift',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    diffuserDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'brightnessStep',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    garageDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'garageDoorOpeningTime',
      'hideChannels',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    rollerDevices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'reversePolarity',
      'firmwareRevision',
      'userkey',
      'overrideLogging'
    ],
    sensorDevices: [
      'name',
      'serialNumber',
      'ignoreDevice',
      'model',
      'lowBattThreshold',
      'overrideLogging'
    ],
    devices: [
      'name',
      'serialNumber',
      'deviceUrl',
      'ignoreDevice',
      'model',
      'showAs',
      'hideChannels',
      'inUsePowerThreshold',
      'firmwareRevision',
      'garageDoorOpeningTime',
      'reversePolarity',
      'overrideLogging'
    ],
    overrideLogging: ['default', 'standard', 'debug', 'disable'],
    showAs: ['default', 'outlet', 'purifier']
  },

  models: {
    switchSingle: [
      'HP110A',
      'MSS110',
      'MSS110R',
      'MSS110RTL',
      'MSS1101',
      'MSS1102',
      'MSS210',
      'MSS210N',
      'MSS210RTL',
      'MSS310',
      'MSS310H',
      'MSS310R',
      'MSS510',
      'MSS510H',
      'MSS510M',
      'MSS510X',
      'MSS550',
      'MSS550K',
      'MSS550L',
      'MSS550X',
      'MSS5X0',
      'MSS710',
      'MSS710R',
      'MSS810'
    ],
    switchMulti: {
      MSS120B: 2,
      MSS420: 4,
      MSS420F: 4,
      MSS425: 4,
      MSS425E: 4,
      MSS425F: 5,
      MSS530: 3,
      MSS530H: 3,
      MSS620: 2,
      MSS620B: 2,
      MSS620S: 2,
      MSS630: 3
    },
    lightDimmer: [
      'MPD100',
      'MSL100',
      'MSL100D',
      'MSL100R',
      'MSS560',
      'MSS560X',
      'MSS565',
      'MSS570',
      'MSS570X'
    ],
    lightRGB: [
      'MSL120',
      'MSL120B',
      'MSL120D',
      'MSL120DR',
      'MSL120J',
      'MSL320',
      'MSL320C',
      'MSL320CP',
      'MSL320M',
      'MSL420',
      'MSL430'
    ],
    lightCCT: ['MDL110M', 'MSL210'],
    diffuser: ['MOD100'],
    garage: ['MSG100', 'MSG200'],
    roller: ['MRS100'],
    hubMain: ['MSH300'],
    hubSub: ['MS100', 'MTS100V3']
  },

  hkNativeHardware: {
    MAP100: '7',
    MDL110M: '4',
    MSG100: '4',
    MSL120D: '4',
    MSL320C: '4',
    MSL320CP: '4',
    MSL420: '4',
    MSL430: '4',
    MSS110: '7',
    MSS110R: '4',
    MSS120B: '4',
    MSS210: '4',
    MSS425E: '4',
    MSS510X: '4',
    MSS620: '4'
  },

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']
}
