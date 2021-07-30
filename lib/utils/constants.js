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
    channelCount: 1,
    cloudRefreshRate: 0,
    connection: 'cloud',
    garageDoorOpeningTime: 20,
    overrideLogging: 'default',
    refreshRate: 5
  },

  minValues: {
    channelCount: 1,
    cloudRefreshRate: 30,
    garageDoorOpeningTime: 1,
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
      'firmwareRevision',
      'deviceUrl',
      'channelCount',
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
      'MSS110',
      'MSS1101',
      'MSS1102',
      'MSS210',
      'MSS210N',
      'MSS310',
      'MSS310R',
      'MSS510',
      'MSS510M',
      'MSS510X',
      'MSS530H',
      'MSS550',
      'MSS570',
      'MSS5X0'
    ],
    switchMulti: ['MSS420F', 'MSS425', 'MSS425E', 'MSS425F', 'MSS620', 'MSS630'],
    lightbulb: ['HP110A', 'MSL100', 'MSL120', 'MSL120D', 'MSL320', 'MSL420', 'MSS560', 'MSS570X'],
    garage: ['MSG100', 'MSG200'],
    roller: ['MRS100'],
    diffuser: ['MOD100'],
    sensorHub: ['MSH300']
  },

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']
}
