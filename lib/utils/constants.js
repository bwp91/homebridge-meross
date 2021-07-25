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
    pushRate: 0.1,
    disableDeviceLogging: false,
    debug: false,
    debugMerossCloud: false,
    disablePlugin: false,
    cloudDevices: [],
    devices: [],
    platform: 'Meross'
  },

  defaultValues: {
    channel: 0,
    cloudRefreshRate: 300,
    garageDoorOpeningTime: 20,
    overrideLogging: 'default',
    pushRate: 0.1,
    refreshRate: 5,
    timestamp: 0
  },

  minValues: {
    channel: 0,
    cloudRefreshRate: 30,
    garageDoorOpeningTime: 1,
    pushRate: 0.1,
    refreshRate: 5,
    timestamp: 0
  },

  allowed: {
    cloudDevices: [
      'label',
      'serialNumber',
      'ignoreDevice',
      'showAs',
      'firmwareRevision',
      'overrideLogging'
    ],
    devices: [
      'name',
      'serialNumber',
      'userKey',
      'model',
      'showAs',
      'firmwareRevision',
      'deviceUrl',
      'channel',
      'messageId',
      'timestamp',
      'sign',
      'garageDoorOpeningTime',
      'overrideLogging'
    ],
    overrideLogging: ['default', 'standard', 'debug', 'disable'],
    showAs: ['default', 'outlet']
  },

  models: {
    cloud: {
      switchSingle: ['MSS510X', 'MSS110', 'MSS210', 'MSS210N', 'MSS310', 'MSS310R'],
      switchMulti: ['MSS620', 'MSS420F', 'MSS425F'],
      lightbulb: ['HP110A'],
      sensorHub: ['MSH300']
    },
    local: {
      switchSingle: [
        'MSS510',
        'MSS510M',
        'MSS530H',
        'MSS550',
        'MSS570',
        'MSS5X0',
        'MSS210',
        'MSS310',
        'MSS420F',
        'MSS425',
        'MSS425E',
        'MSS425F',
        'MSS630',
        'MSS620',
        'MSS1101',
        'MSS1102'
      ],
      lightbulb: ['MSL100', 'MSL420', 'MSL120', 'MSL320', 'MSS560', 'MSS570X'],
      garage: ['MSG100', 'MSG200']
    }
  },

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']
}
