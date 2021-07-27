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
    cloudRefreshRate: 300,
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
      'overrideLogging'
    ],
    connection: ['cloud', 'local'],
    overrideLogging: ['default', 'standard', 'debug', 'disable'],
    showAs: ['default', 'outlet']
  },

  models: {
    switchSingle: [
      'MSS510X',
      'MSS110',
      'MSS210',
      'MSS210N',
      'MSS310',
      'MSS310R',
      'MSS510',
      'MSS510M',
      'MSS530H',
      'MSS550',
      'MSS570',
      'MSS5X0',
      'MSS420F',
      'MSS425',
      'MSS425E',
      'MSS425F',
      'MSS1101',
      'MSS1102'
    ],
    switchMulti: ['MSS620', 'MSS630', 'MSS420F', 'MSS425F'],
    lightbulb: ['HP110A', 'MSL100', 'MSL420', 'MSL120', 'MSL320', 'MSS560', 'MSS570X'],
    garage: ['MSG100', 'MSG200'],
    sensorHub: ['MSH300']
  },

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']
}