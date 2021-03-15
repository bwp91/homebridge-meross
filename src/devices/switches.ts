import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';
import { Meross } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig, data, PLATFORM_NAME, payload } from '../settings';

export class Switch {
  private service: Service;

  On!: CharacteristicValue;

  UpdateInProgress!: boolean;
  doUpdate!: Subject<unknown>;
  deviceStatus: any
  Payload!: payload
  Data!: data
  Request!: string;

  constructor(
    private readonly platform: Meross,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
  ) {
    // default placeholders
    this.On = false;

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
    (this.service =
      accessory.getService(this.platform.Service.Switch) ||
      accessory.addService(this.platform.Service.Switch)), device.name!;

    // Set Name Characteristic
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name!);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.On).onSet(this.OnSet.bind(this));

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
          await this.pushOnChanges();
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
    if (this.deviceStatus) {
      if (this.deviceStatus?.payload?.all?.digest?.togglex) {
        const onOff = this.deviceStatus.payload.all.digest.togglex[`${this.device.channel}`].onoff;
        this.platform.log.debug('Retrieved status successfully: ', onOff);
        this.On = onOff;
      } else {
        this.platform.log.debug('Retrieved status unsuccessfully.');
        this.On = false;
      }
    }
  }

  async refreshStatus() {
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
              namespace: 'Appliance.System.All',
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
      this.deviceStatus = deviceStatus;
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
    this.Payload = {
      togglex: {
        onoff: this.On ? 1 : 0,
        channel: `${this.device.channel}`,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.ToggleX',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    if (this.On) {
      this.Request = 'On';
    } else {
      this.Request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.Request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  updateHomeKitCharacteristics() {
    if (this.On !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.On, e);
    new this.platform.api.hap.HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
  }

  /**
   * Handle requests to set the value of the "On" characteristic
   */
  OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set On: %s', this.device.model, this.accessory.displayName, value);

    this.On = value;
    this.doUpdate.next();
  }
}