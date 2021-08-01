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
    disableDeviceLogging: false,
    debug: false,
    disablePlugin: false,
    devices: [],
    platform: 'Meross'
  },

  defaultValues: {
    cloudRefreshRate: 0,
    connection: 'cloud',
    garageDoorOpeningTime: 20,
    inUsePowerThreshold: 0,
    overrideLogging: 'default',
    refreshRate: 5
  },

  minValues: {
    cloudRefreshRate: 30,
    garageDoorOpeningTime: 1,
    inUsePowerThreshold: 0,
    refreshRate: 5
  },

  allowed: {
    devices: [
      'name',
      'serialNumber',
      'connection',
      'ignoreDevice',
      'model',
      'showAs',
      'hideChannels',
      'inUsePowerThreshold',
      'firmwareRevision',
      'deviceUrl',
      'garageDoorOpeningTime',
      'reversePolarity',
      'overrideLogging'
    ],
    connection: ['cloud', 'local'],
    overrideLogging: ['default', 'standard', 'debug', 'disable'],
    showAs: ['default', 'outlet']
  },

  models: {
    switchSingle: [
      'HP110A',
      'MSS110',
      'MSS1101',
      'MSS1102',
      'MSS120B',
      'MSS210',
      'MSS210N',
      'MSS310',
      'MSS310H',
      'MSS310R',
      'MSS510',
      'MSS510M',
      'MSS510X',
      'MSS550',
      'MSS550X',
      'MSS570',
      'MSS5X0',
      'MSS710',
      'MSS810'
    ],
    switchMulti: {
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
    lightDimmer: ['MSL100', 'MSL100D', 'MSS560', 'MSS565', 'MSS570', 'MSS570X'],
    lightRGB: ['MSL120', 'MSL120B', 'MSL120D', 'MSL320', 'MSL420', 'MSL430'],
    garage: ['MSG100', 'MSG200'],
    roller: ['MRS100'],
    diffuser: ['MOD100'],
    sensorHub: ['MSH300']
  },

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']
}
