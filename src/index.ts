/* eslint-disable no-useless-escape */
'use strict';

import request from 'request';
let Service, Characteristic;

// Wrap request with a promise to make it awaitable
function doRequest(options) {
  return new Promise((resolve, reject) => {
    request(options, (error, res, body) => {
      if (!error && res.statusCode === 200) {
        resolve(body);
      } else {
        reject(error);
      }
    });
  });
}

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-meross', 'Meross', Meross);
};

class Meross {
  log: any;
  config: any;
  service: any;
  isOn: any;
  brightness: any;
  currentState: any;
  lastSetTime!: number;
  checkStateInterval!: NodeJS.Timeout;
  constructor(log, config) {
    /*
     * The constructor function is called when the plugin is registered.
     * log is a function that can be used to log output to the homebridge console
     * config is an object that contains the config for this plugin that was defined the homebridge config.json
     */

    /* assign both log and config to properties on 'this' class so we can use them in other methods */
    this.log = log;
    this.config = config;

    /*
     * A HomeKit accessory can have many "services". This will create our base service,
     * Service types are defined in this code: https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js
     * Search for "* Service" to tab through each available service type.
     * Take note of the available "Required" and "Optional" Characteristics for the service you are creating
     */

    /* To be used later
     switch (config.model) {
      case "MSS110-1":
      case "MSS110-2":
      case "MSS210":
      case "MSS310":
      case "MSS420F":
      case "MSS425":
      case "MSS425E":
      case "MSS425F":
      case "MSS620":
        this.service = new Service.Outlet(this.config.name);
        break;
      case "MSS510":
      case "MSS510M":
      case 'MSS530H':
      case "MSS550":
      case "MSS560":
      case "MSS570":
      case "MSS5X0":
        this.service = new Service.Switch(this.config.name);
        break;
      case "MSG100":
        this.service = new Service.GarageDoorOpener(this.config.name);
        break;
      case "MSL100":
      case "MSL120":
      case "MSL420":
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case "MTS100":
      case "MTS100H":
        this.service = new Service.Thermostat(this.config.name);
        break;
      case "MS100":
      case "MS100H":
        this.service = new Service.TemperatureSensor(this.config.name);
        break;
      case "MSXH0":
        this.service = new Service.HumidifierDehumidifier(this.config.name);
        break;
      case "MRS110":
        this.service = new Service.WindowCovering(this.config.name);
        break;
      default:
        this.service = new Service.Outlet(this.config.name);
    }
     */
    switch (config.model) {
      case 'MSS110-1':
      case 'MSS110-2':
      case 'MSS210':
      case 'MSS310':
      case 'MSS420F':
      case 'MSS425':
      case 'MSS425E':
      case 'MSS425F':
      case 'MSS620':
        this.service = new Service.Outlet(this.config.name);
        break;
      case 'MSS510':
      case 'MSS510M':
      case 'MSS530H':
      case 'MSS550':
      case 'MSS570':
      case 'MSS5X0':
        this.service = new Service.Switch(this.config.name);
        break;
      case 'MSS560':
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case 'MSG100':
        this.service = new Service.GarageDoorOpener(this.config.name);
        this.startUpdatingDoorState();
        break;
      default:
        this.service = new Service.Outlet(this.config.name);
    }
  }

  getServices() {
    /*
     * The getServices function is called by Homebridge and should return an array of Services this accessory is exposing.
     * It is also where we bootstrap the plugin to tell Homebridge which function to use for which action.
     */

    /* Create a new information service. This just tells HomeKit about our accessory. */
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Meross')
      .setCharacteristic(Characteristic.Model, this.config.model)
      .setCharacteristic(Characteristic.SerialNumber, '❤️');

    /*
     * For each of the service characteristics we need to register setters and getter functions
     * 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     * 'set' is called when HomeKit wants to update the value of the characteristic
     */
    switch (this.config.model) {
      case 'MSG100':
        this.service
          .getCharacteristic(Characteristic.CurrentDoorState)
          .on('get', this.getDoorStateHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.TargetDoorState)
          .on('get', this.getDoorStateHandler.bind(this))
          .on('set', this.setDoorStateHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.ObstructionDetected)
          .on('get', this.getObstructionDetectedHandler.bind(this));
        break;
      case 'MSS560':
        this.service
          .getCharacteristic(Characteristic.Brightness)
          .on('get', this.getBrightnessCharacteristicHandler.bind(this))
          .on('set', this.setBrightnessCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getOnCharacteristicHandler.bind(this))
          .on('set', this.setOnCharacteristicHandler.bind(this));
        break;
      default:
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getOnCharacteristicHandler.bind(this))
          .on('set', this.setOnCharacteristicHandler.bind(this));
    }

    /* Return both the main service (this.service) and the informationService */
    return [informationService, this.service];
  }

  async setOnCharacteristicHandler(value, callback) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setOnCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    /*
     * Differentiate requests based on device model.
     */

    switch (this.config.model) {
      case 'MSS110-1':
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                toggle: {
                  onoff: value ? 1 : 0,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Toggle',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
        break;
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                togglex: {
                  onoff: value ? 1 : 0,
                  channel: `${this.config.channel}`,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.ToggleX',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }

    if (response) {
      this.isOn = value;
      this.log.debug('Set succeeded:', response);
      this.log(`${this.config.model} turned`, value ? 'On' : 'Off');
    } else {
      this.isOn = false;
      this.log('Set failed:', this.isOn);
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('setOnCharacteristicHandler:', value);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     */
    callback(null, this.isOn);
  }

  async getOnCharacteristicHandler(callback) {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getOnCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: 'Appliance.System.All',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }

    /*
     * Differentiate response based on device model.
     */

    switch (this.config.model) {
      case 'MSS110-1':
        if (response) {
          const onOff = response.payload.all.control.toggle.onoff;

          this.log('Retrieved status successfully: ', onOff);
          this.isOn = onOff;
        } else {
          this.log('Retrieved status unsuccessfully.');
          this.isOn = false;
        }
        break;
      default:
        if (response) {
          const onOff =
            response.payload.all.digest.togglex[`${this.config.channel}`].onoff;

          this.log.debug('Retrieved status successfully: ', onOff);
          this.isOn = onOff;
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
          this.isOn = false;
        }
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('getOnCharacteristicHandler:', this.isOn);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     * The second argument in the function should be the current value of the characteristic
     * This is just an example so we will return the value from `this.isOn` which is where we stored the value in the set handler
     */
    callback(null, this.isOn);
  }


  async setBrightnessCharacteristicHandler(value, callback) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setBrightnessCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    /*
     * Differentiate requests based on device model.
     */

    switch (this.config.model) {
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                light: {
                  luminance: value,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Light',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }

    if (response) {
      this.brightness = value;
      this.log.debug('Set succeeded:', response);
      this.log(`${this.config.model} set brightness to`, value);
    } else {
      this.brightness = this.isOn ? 100 : 0;
      this.log('Set failed:', this.brightness);
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('setBrightnessCharacteristicHandler:', value);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     */
    callback(null, this.brightness);
  }

  async getBrightnessCharacteristicHandler(callback) {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getBrightnessCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: 'Appliance.System.All',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }

    /*
     * Differentiate response based on device model.
     */

    switch (this.config.model) {
      default:
        if (response) {
          const luminance =
            response.payload.all.digest.light.luminance;

          this.log.debug('Retrieved status successfully: ', luminance);
          this.brightness = luminance;
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
          this.brightness = this.isOn ? 100 : 0;
        }
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('getBrightnessCharacteristicHandler:', this.brightness);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     * The second argument in the function should be the current value of the characteristic
     * This is just an example so we will return the value from `this.brightness` which is where we stored the value in the set handler
     */
    callback(null, this.brightness);
  }

  async getDoorStateHandler(callback) {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */
    this.log.debug(
      `getDoorStateHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    this.getDoorState()
      .then((state) => callback(null, state))
      .catch((e) => this.log(`${e}`));
  }

  async getObstructionDetectedHandler(callback) {
    this.log.debug(
      `getObstructionDetectedHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    callback(null, Characteristic.ObstructionDetected.NO);
  }

  async setDoorStateHandler(value, callback) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    this.log.debug(
      `setDoorStateHandler ${value} for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    this.getDoorState()
      .then((state) => {
        if (value === Characteristic.TargetDoorState.CLOSED) {
          if (state === Characteristic.CurrentDoorState.OPEN) {
            this.log('Target CLOSED, Current OPEN, close the door');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            this.setDoorState(false);
            callback();
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else if (state === Characteristic.CurrentDoorState.CLOSED) {
            this.log('Target CLOSED, Current CLOSED, no change');
            this.currentState = Characteristic.CurrentDoorState.CLOSED;
            callback();
          } else if (state === Characteristic.CurrentDoorState.OPENING) {
            this.log(
              'Target CLOSED, Current OPENING, stop the door (then it stays in open state)',
            );
            this.currentState = Characteristic.CurrentDoorState.OPEN;
            this.setDoorState(false);
            callback();
            this.service.setCharacteristic(
              Characteristic.TargetDoorState,
              Characteristic.TargetDoorState.OPEN,
            );
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPEN,
            );
          } else if (state === Characteristic.CurrentDoorState.CLOSING) {
            this.log('Target CLOSED, Current CLOSING, no change');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            callback();
          } else if (state === Characteristic.CurrentDoorState.STOPPED) {
            this.log('Target CLOSED, Current STOPPED, close the door');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            this.setDoorState(false);
            callback();
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else {
            this.log('Target CLOSED, Current UNKOWN, no change');
            callback();
          }
        } else if (value === Characteristic.TargetDoorState.OPEN) {
          if (state === Characteristic.CurrentDoorState.OPEN) {
            this.log('Target OPEN, Current OPEN, no change');
            this.currentState = Characteristic.CurrentDoorState.OPEN;
            callback();
          } else if (state === Characteristic.CurrentDoorState.CLOSED) {
            this.log('Target OPEN, Current CLOSED, open the door');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
            this.setDoorState(true);
            callback();
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPENING,
            );
          } else if (state === Characteristic.CurrentDoorState.OPENING) {
            this.log('Target OPEN, Current OPENING, no change');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
            callback();
          } else if (state === Characteristic.CurrentDoorState.CLOSING) {
            this.log(
              'Target OPEN, Current CLOSING, Meross does not accept OPEN request while closing',
              ' since the sensor is already open, no change.',
            );
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            callback();
            this.service.setCharacteristic(
              Characteristic.TargetDoorState,
              Characteristic.TargetDoorState.CLOSING,
            );
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else if (state === Characteristic.CurrentDoorState.STOPPED) {
            this.log('Target OPEN, Current STOPPED, open the door');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
            this.setDoorState(true);
            callback();
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPENING,
            );
          } else {
            this.log('Target OPEN, Current UNKOWN, no change');
            callback();
          }
        }
      })
      .catch((e) => this.log(`${e}`));
  }

  async setDoorState(open) {
    this.lastSetTime = Math.floor(Date.now() / 1000);
    let response;
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {
            state: {
              channel: 0,
              open: open ? 1 : 0,
              uuid: `${this.config.deviceUrl}`,
            },
          },
          header: {
            messageId: `${this.config.messageId}`,
            method: 'SET',
            from: `http://${this.config.deviceUrl}\/config`,
            namespace: 'Appliance.GarageDoor.State',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
            triggerSrc: 'iOS',
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    return response;
  }

  async getDoorState() {
    let response;
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: 'Appliance.System.All',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
      throw e;
    }

    if (response) {
      // Open means magnetic sensor not detected, doesn't really mean the door is open
      const isOpen =
        response.payload.all.digest.garageDoor[`${this.config.channel}`].open;
      if (isOpen) {
        const currentTime = Math.floor(Date.now() / 1000);
        const elapsedTime = currentTime - this.lastSetTime;
        if (this.currentState === Characteristic.CurrentDoorState.OPENING) {
          this.currentState =
            elapsedTime < this.config.garageDoorOpeningTime
              ? Characteristic.CurrentDoorState.OPENING
              : Characteristic.CurrentDoorState.OPEN;
        } else if (
          this.currentState === Characteristic.CurrentDoorState.CLOSING
        ) {
          this.currentState =
            elapsedTime < this.config.garageDoorOpeningTime
              ? Characteristic.CurrentDoorState.CLOSING
              : Characteristic.CurrentDoorState.OPEN;
        } else {
          this.currentState = Characteristic.CurrentDoorState.OPEN;
        }
      } else {
        this.currentState = Characteristic.CurrentDoorState.CLOSED;
      }
    }

    switch (this.currentState) {
      case Characteristic.CurrentDoorState.OPEN:
        this.log.debug('Current state OPEN');
        break;
      case Characteristic.CurrentDoorState.CLOSED:
        this.log.debug('Current state CLOSED');
        break;
      case Characteristic.CurrentDoorState.OPENING:
        this.log.debug('Current state OPENING');
        break;
      case Characteristic.CurrentDoorState.CLOSING:
        this.log.debug('Current state CLOSING');
        break;
      case Characteristic.CurrentDoorState.STOPPED:
        this.log.debug('Current state STOPPED');
        break;
      default:
        this.log.debug('Current state UNKNOWN');
    }

    return this.currentState;
  }

  startUpdatingDoorState() {
    this.stopUpdatingDoorState();
    // Update state repeatedly
    this.checkStateInterval = setInterval(() => {
      this.getDoorState()
        .then((state) =>
          this.service.setCharacteristic(Characteristic.CurrentDoorState, state),
        )
        .catch((e) => this.log(`${e}`));
    }, 5000);
  }

  stopUpdatingDoorState() {
    clearInterval(this.checkStateInterval);
    this.checkStateInterval;
  }
}
