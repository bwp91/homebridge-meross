import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { Meross } from './platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig, data, numberToColour, RGBToHSL, colourToNumber, HSLToRGB, PLATFORM_NAME } from './settings';

export class Outlet {
  private service: Service;

  On?: CharacteristicValue;
  OutletInUse?: CharacteristicValue;
  Saturation?: CharacteristicValue;
  Brightness?: CharacteristicValue;
  ColorTemperature?: CharacteristicValue;
  Hue?: CharacteristicValue;
  TargetDoorState?: CharacteristicValue;
  CurrentDoorState?: CharacteristicValue;
  ObstructionDetected?: CharacteristicValue;

  UpdateInProgress!: boolean;
  doUpdate!: Subject<unknown>;
  checkStateInterval!: NodeJS.Timeout;
  deviceStatus: any;
  request!: string;
  data!: data;
  payload!: Record<any, any>;
  namespace!: string;
  mr_temp!: number;
  rgb_d: any;
  lastSetTime!: number;
  Open: any;

  constructor(
    private readonly platform: Meross,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
  ) {
    // default placeholders
    this.On = false;
    this.OutletInUse = true;

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.doUpdate = new Subject();
    this.UpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, this.device.model!)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.serialNumber || device.deviceUrl!)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, device.firmwareRevision || device.deviceUrl!);

    // get the WindowCovering service if it exists, otherwise create a new WindowCovering service
    // you can create multiple services for each accessory
    switch (device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
      case 'MSS560':
        (this.service =
          accessory.getService(this.platform.Service.Lightbulb) ||
          accessory.addService(this.platform.Service.Lightbulb)), '%s %s', device.name!;
        break;
      case 'MSS510':
      case 'MSS510M':
      case 'MSS530H':
      case 'MSS550':
      case 'MSS570':
      case 'MSS5X0':
        (this.service =
          accessory.getService(this.platform.Service.Switch) ||
          accessory.addService(this.platform.Service.Switch)), '%s %s', device.name!;
        break;
      case 'MSG100':
      case 'MSG200':
        (this.service =
          accessory.getService(this.platform.Service.GarageDoorOpener) ||
          accessory.addService(this.platform.Service.GarageDoorOpener)), '%s %s', device.name!;
        this.startUpdatingDoorState();
        break;
      case 'MSS210':
      case 'MSS310':
      case 'MSS420F':
      case 'MSS425':
      case 'MSS425E':
      case 'MSS425F':
      case 'MSS630':
      case 'MSS620':
      case 'MSS110-1':
      case 'MSS110-2':
      default:
        (this.service =
          accessory.getService(this.platform.Service.Outlet) ||
          accessory.addService(this.platform.Service.Outlet)), '%s %s', device.name!;
        this.service.setCharacteristic((this.platform.Characteristic.OutletInUse), true);
    }

    // Set Name Characteristic
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name!);

    /*
     * For each of the service characteristics we need to register setters and getter functions
     * 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     * 'set' is called when HomeKit wants to update the value of the characteristic
     */
    switch (device.model) {
      case 'MSG100':
      case 'MSG200':
        this.service
          .getCharacteristic(this.platform.Characteristic.TargetDoorState)
          .onSet(this.TargetDoorStateSet.bind(this));
        this.service.setCharacteristic((this.platform.Characteristic.ObstructionDetected), false);
        break;
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
        this.service
          .getCharacteristic(this.platform.Characteristic.Hue)
          .onSet(this.HueSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.ColorTemperature)
          .onSet(this.ColorTemperatureSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.Saturation)
          .onSet(this.SaturationSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.Brightness)
          .onSet(this.BrightnessSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.OnSet.bind(this));
        break;
      case 'MSS560':
        this.service
          .getCharacteristic(this.platform.Characteristic.Brightness)
          .onSet(this.BrightnessSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.OnSet.bind(this));
        break;
      default:
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.OnSet.bind(this));
    }

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.On).onSet(this.OnSet.bind(this));

    this.service.setCharacteristic(this.platform.Characteristic.OutletInUse, this.OutletInUse || true);

    // Update Homekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.refreshRate! * 1000)
      .pipe(skipWhile(() => this.UpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });


    // Watch for Plug change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doUpdate
      .pipe(
        tap(() => {
          this.UpdateInProgress = true;
        }),
        debounceTime(this.platform.config.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          switch (device.model) {
            case 'MSL-100':
            case 'MSL-420':
            case 'MSL-120':
            case 'MSL-320':
              await this.pushOnChanges();
              await this.pushBrightnessChanges();
              await this.pushSaturationChanges();
              await this.pushColorTemperatureChanges();
              break;
            case 'MSS560':
              await this.pushOnChanges();
              await this.pushBrightnessChanges();
              break;
            case 'MSG100':
            case 'MSG200':
              await this.pushTargetDoorStateChanges();
              break;
            default:
              await this.pushOnChanges();
          }
        } catch (e) {
          this.platform.log.error(
            'Failed to POST to the Meross Device %s at %s:',
            this.device.model,
            this.device.deviceUrl,
            JSON.stringify(e.message),
          );
          this.platform.log.debug('Plug %s -', accessory.displayName, JSON.stringify(e));
          this.apiError(e);
        }
        this.UpdateInProgress = false;
      });
  }

  parseStatus() {
    switch (this.device.model) {
      case 'MSS110-1':
        if (this.deviceStatus) {
          const onOff = this.deviceStatus.payload.all.control.toggle.onoff;

          this.platform.log.debug('Retrieved status successfully: ', onOff);
          this.On = onOff;
        } else {
          this.platform.log.debug('Retrieved status unsuccessfully.');
          this.On = false;
        }
        break;
      default:
        if (this.deviceStatus) {
          if (this.deviceStatus?.payload?.all?.digest?.togglex) {
            const onOff = this.deviceStatus.payload.all.digest.togglex[`${this.device.channel}`].onoff;
            this.platform.log.debug('Retrieved status successfully: ', onOff);
            this.On = onOff;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.On = false;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.luminance) {
            const luminance = this.deviceStatus.payload.all.digest.light.luminance;
            this.platform.log.debug('Retrieved status successfully: ', luminance);
            this.Brightness = luminance;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Brightness = this.On ? 100 : 0;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.temperature) {
            const tmp_temperature = this.deviceStatus.payload.all.digest.light.temperature;
            let mr_temp = (tmp_temperature / 100) * 360;
            mr_temp = 360 - mr_temp;
            mr_temp = mr_temp + 140;
            mr_temp = Math.round(mr_temp);
            this.ColorTemperature = mr_temp;
            this.platform.log.debug(
              'Retrieved temp status successfully: ',
              this.ColorTemperature,
            );
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.platform.log.debug(
              'Retrieved status successfully: ',
              this.deviceStatus.response.payload.all.digest.light,
            );

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const hue = hsl[0];
            this.platform.log.debug('Retrieved hue status successfully: ', hue);
            this.Hue = hue;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.Brightness = this.deviceStatus.payload.all.digest.light.luminance;
            this.ColorTemperature = this.deviceStatus.payload.all.digest.light.temperature;

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const saturation = hsl[1];
            this.platform.log.debug(
              'Retrieved saturation status successfully: ',
              saturation,
            );
            this.platform.log.debug(
              'Retrieved saturation/hue status successfully: ',
              this.Hue,
            );
            this.Saturation = saturation;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Saturation = this.On ? 100 : 0;
          }
          if (this.deviceStatus?.payload?.all?.digest?.garageDoor) {
            // Open means magnetic sensor not detected, doesn't really mean the door is open
            let isOpen = (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPEN);
            for (let i = 0; i < this.deviceStatus.payload.all.digest.garageDoor.length; i++) {
              if (this.deviceStatus.payload.all.digest.garageDoor[i].channel === this.device.channel) {
                isOpen = this.deviceStatus.payload.all.digest.garageDoor[i].open;
              }
            }
            if (isOpen) {
              const currentTime = Math.floor(Date.now() / 1000);
              const elapsedTime = currentTime - this.lastSetTime;
              if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPENING) {
                this.CurrentDoorState =
                  elapsedTime < this.device.garageDoorOpeningTime!
                    ? this.platform.Characteristic.CurrentDoorState.OPENING
                    : this.platform.Characteristic.CurrentDoorState.OPEN;
              } else if (
                this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.CLOSING
              ) {
                this.CurrentDoorState =
                  elapsedTime < this.device.garageDoorOpeningTime!
                    ? this.platform.Characteristic.CurrentDoorState.CLOSING
                    : this.platform.Characteristic.CurrentDoorState.OPEN;
              } else {
                this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPEN;
              }
            } else {
              this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSED;
            }

            switch (this.CurrentDoorState) {
              case this.platform.Characteristic.CurrentDoorState.OPEN:
                this.platform.log.debug('Current state OPEN');
                break;
              case this.platform.Characteristic.CurrentDoorState.CLOSED:
                this.platform.log.debug('Current state CLOSED');
                break;
              case this.platform.Characteristic.CurrentDoorState.OPENING:
                this.platform.log.debug('Current state OPENING');
                break;
              case this.platform.Characteristic.CurrentDoorState.CLOSING:
                this.platform.log.debug('Current state CLOSING');
                break;
              case this.platform.Characteristic.CurrentDoorState.STOPPED:
                this.platform.log.debug('Current state STOPPED');
                break;
              default:
                this.platform.log.debug('Current state UNKNOWN');
            }
          }

        }
    }
  }

  async refreshStatus() {
    // Namespace
    switch (this.device.model) {
      case 'MSL-320':
        this.namespace = 'Appliance.System.Online';
        break;
      default:
        this.namespace = 'Appliance.System.All';
    }

    try {
      this.platform.log.debug('%s - Reading', this.device.model, `${this.device.deviceUrl}/status`);
      const deviceStatus = (
        await this.platform.axios({
          url: `http://${this.device.deviceUrl}/config`,
          method: 'post',
          data: {
            payload: {},
            header: {
              messageId: `${this.device.messageId}`,
              method: 'GET',
              from: `http://${this.device.deviceUrl}/config`,
              namespace: this.namespace,
              timestamp: this.device.timestamp,
              sign: `${this.device.sign}`,
              payloadVersion: 1,
            },
          },
        },
        )).data;
      this.platform.log.debug(
        '%s %s refreshStatus -',
        this.device.model, 
        this.accessory.displayName,
        JSON.stringify(deviceStatus),
      );
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e) {
      this.platform.log.error(
        '%s - Failed to refresh status of %s: %s',
        this.device.model,
        this.device.name,
        JSON.stringify(e.message),
        this.platform.log.debug('%s %s -', this.device.model, this.accessory.displayName, JSON.stringify(e)),
      );
      this.apiError(e);
    }
  }

  /**
 * Pushes the requested changes to the Meross Device
 */
  async pushOnChanges() {
    switch (this.device.model) {
      case 'MSS110-1':
        // Payload
        this.payload = {
          toggle: {
            onoff: this.On ? 1 : 0,
          },
        };
        this.namespace = 'Appliance.Control.Toggle';
        break;
      default:
        this.payload = {
          togglex: {
            onoff: this.On ? 1 : 0,
            channel: `${this.device.channel}`,
          },
        };
        this.namespace = 'Appliance.Control.ToggleX';
    }

    // Data Info
    this.data = {
      payload: this.payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: this.namespace,
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.data,
    },
    );
    if (this.On) {
      this.request = 'On';
    } else {
      this.request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushBrightnessChanges() {
    // Payload
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'MSL-420':
        // Payload
        this.payload = {
          light: {
            luminance: this.Brightness,
            capacity: 4,
          },
        };
        break;
      default:
        this.payload = {
          light: {
            luminance: this.Brightness,
          },
        };
    }

    // Namespace
    this.namespace = 'Appliance.Control.Light';

    // Data Info
    this.data = {
      payload: this.payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.data,
    },
    );
    this.platform.log.info('Sending request %s for %s', this.Brightness, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushColorTemperatureChanges() {
    // Payload
    this.payload = {
      light: {
        temperature: this.mr_temp,
        capacity: 2,
      },
    };
    // Namespace
    this.namespace = 'Appliance.Control.Light';

    // Data Info
    this.data = {
      payload: this.payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: this.namespace,
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.data,
    },
    );
    this.ColorTemperature = this.mr_temp;
    this.platform.log.info('Sending request %s for %s', this.request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushSaturationChanges() {
    // Payload
    this.payload = {
      light: {
        rgb: this.rgb_d,
        capacity: 1,
        luminance: this.Brightness,
      },
    };
    // Namespace
    this.namespace = 'Appliance.Control.Light';

    // Data Info
    this.data = {
      payload: this.payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: this.namespace,
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.data,
    },
    );
    if (this.On) {
      this.request = 'On';
    } else {
      this.request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushTargetDoorStateChanges() {
    this.lastSetTime = Math.floor(Date.now() / 1000);
    // Payload
    this.payload = {
      state: {
        channel: `${this.device.channel}`,
        open: this.Open ? 1 : 0,
        uuid: `${this.device.deviceUrl}`,
      },
    };

    // Namespace
    this.namespace = 'Appliance.Control.Toggle';

    // Data Info
    this.data = {
      payload: this.payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: this.namespace,
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
        triggerSrc: 'iOS',
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.data,
    },
    );
    if (this.On) {
      this.request = 'On';
    } else {
      this.request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  updateHomeKitCharacteristics() {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
        if (this.Saturation !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.Saturation);
        }
        if (this.ColorTemperature !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.ColorTemperature);
        }
        if (this.Hue !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.Hue);
        }
        break;
      case 'MSS560':
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
        break;
      case 'MSG100':
      case 'MSG200':
        if (this.TargetDoorState !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState, this.TargetDoorState);
        }
        if (this.CurrentDoorState !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, this.CurrentDoorState);
        }
        if (this.ObstructionDetected !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, this.ObstructionDetected);
        }
        break;
      default:
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
    }
  }

  public apiError(e: any) {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Saturation, e);
        this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Hue, e);
        break;
      case 'MSS560':
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
        break;
      case 'MSG100':
      case 'MSG200':
        this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState, e);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, e);
        this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, e);
        break;
      default:
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
    }
  }

  /**
   * Handle requests to set the value of the "On" characteristic
   */
  OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set On: %s', this.device.model, this.accessory.displayName, value);

    this.On = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  BrightnessSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Brightness: %s', this.device.model, this.accessory.displayName, value);

    this.Brightness = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "ColorTemperature" characteristic
   */
  ColorTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set ColorTemperature: %s', this.device.model, this.accessory.displayName, value);

    this.ColorTemperature = value;
    this.mr_temp = Number(this.ColorTemperature) - 140;
    this.mr_temp = 360 - this.mr_temp;
    this.mr_temp = this.mr_temp / 360;
    this.mr_temp = Math.round(this.mr_temp * 100);
    this.mr_temp = this.mr_temp === 0 ? 1 : this.mr_temp;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  HueSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Hue: %s', this.device.model, this.accessory.displayName, value);

    this.Hue = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Saturation" characteristic
   */
  SaturationSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Saturation: %s', this.device.model, this.accessory.displayName, value);

    this.Saturation = value;
    const rgb = HSLToRGB(this.Hue, this.Saturation, 50);
    this.rgb_d = colourToNumber(rgb[0], rgb[1], rgb[2]);
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Saturation" characteristic
   */
  TargetDoorStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Saturation: %s', this.device.model, this.accessory.displayName, value);

    this.TargetDoorState = value;
    if (value === this.platform.Characteristic.TargetDoorState.CLOSED) {
      if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPEN) {
        this.platform.log.debug('Target CLOSED, Current OPEN, close the door');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSING;
        this.Open = false;
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.CLOSING,
        );
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.CLOSED) {
        this.platform.log.debug('Target CLOSED, Current CLOSED, no change');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSED;
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPENING) {
        this.platform.log.debug(
          'Target CLOSED, Current OPENING, stop the door (then it stays in open state)',
        );
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPEN;
        this.Open = false;
        this.service.setCharacteristic(
          this.platform.Characteristic.TargetDoorState,
          this.platform.Characteristic.TargetDoorState.OPEN,
        );
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.OPEN,
        );
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.CLOSING) {
        this.platform.log.debug('Target CLOSED, Current CLOSING, no change');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSING;
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.STOPPED) {
        this.platform.log.debug('Target CLOSED, Current STOPPED, close the door');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSING;
        this.Open = false;
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.CLOSING,
        );
      } else {
        this.platform.log.debug('Target CLOSED, Current UNKOWN, no change');
      }
    } else if (value === this.platform.Characteristic.TargetDoorState.OPEN) {
      if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPEN) {
        this.platform.log.debug('Target OPEN, Current OPEN, no change');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPEN;
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.CLOSED) {
        this.platform.log.debug('Target OPEN, Current CLOSED, open the door');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPENING;
        this.Open = true;
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.OPENING,
        );
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPENING) {
        this.platform.log.debug('Target OPEN, Current OPENING, no change');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPENING;
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.CLOSING) {
        this.platform.log.debug(
          'Target OPEN, Current CLOSING, Meross does not accept OPEN request while closing',
          ' since the sensor is already open, no change.',
        );
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSING;
        this.service.setCharacteristic(
          this.platform.Characteristic.TargetDoorState,
          this.platform.Characteristic.TargetDoorState.CLOSED,
        );
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.CLOSING,
        );
      } else if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.STOPPED) {
        this.platform.log.debug('Target OPEN, Current STOPPED, open the door');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.OPENING;
        this.Open = true;
        this.service.setCharacteristic(
          this.platform.Characteristic.CurrentDoorState,
          this.platform.Characteristic.CurrentDoorState.OPENING,
        );
      } else {
        this.platform.log.debug('Target OPEN, Current UNKOWN, no change');
      }
    }
    this.doUpdate.next();
  }

  startUpdatingDoorState() {
    this.stopUpdatingDoorState();
    // Update state repeatedly
    this.checkStateInterval = setInterval(() => {
      this.refreshStatus()
        .then(() =>
          this.service.setCharacteristic(this.platform.Characteristic.CurrentDoorState, this.CurrentDoorState!),
        )
        .catch((e) => this.platform.log.error(`${e}`));
    }, 5000);
  }

  stopUpdatingDoorState() {
    clearInterval(this.checkStateInterval);
    this.checkStateInterval;
  }
}