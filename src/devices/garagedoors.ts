import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';
import { Meross } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig, data, PLATFORM_NAME, state, payload } from '../settings';

export class GarageDoor {
  private service: Service;

  TargetDoorState?: CharacteristicValue;
  CurrentDoorState?: CharacteristicValue;
  ObstructionDetected?: CharacteristicValue;

  UpdateInProgress!: boolean;
  doUpdate!: Subject<unknown>;
  checkStateInterval!: NodeJS.Timeout;
  deviceStatus: any;
  lastSetTime!: number;
  Open!: state['open'];
  Payload!: payload;
  Data!: data;
  Request!: string;

  constructor(
    private readonly platform: Meross,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
  ) {
    // default placeholders
    this.TargetDoorState = this.platform.Characteristic.TargetDoorState.CLOSED;
    this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSED;
    this.ObstructionDetected = false;

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
      accessory.getService(this.platform.Service.GarageDoorOpener) ||
      accessory.addService(this.platform.Service.GarageDoorOpener)), device.name!;
    this.startUpdatingDoorState();

    // Set Name Characteristic
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name!);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onSet(this.TargetDoorStateSet.bind(this));

    this.service.setCharacteristic((this.platform.Characteristic.ObstructionDetected), this.ObstructionDetected || false);

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
          await this.pushTargetDoorStateChanges();
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
  async pushTargetDoorStateChanges() {
    this.lastSetTime = Math.floor(Date.now() / 1000);
    // Payload
    this.Payload = {
      state: {
        channel: `${this.device.channel}`,
        open: this.Open ? 1 : 0,
        uuid: `${this.device.deviceUrl}`,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.GarageDoor.State',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
        triggerSrc: 'iOSLocal',
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    if (this.Open === 0 ) {
      this.Request = 'Open';
    } else {
      this.Request = 'Close';
    }
    this.platform.log.info('Sending request %s for %s', this.Request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  updateHomeKitCharacteristics() {
    if (this.TargetDoorState !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState, this.TargetDoorState);
    }
    if (this.CurrentDoorState !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, this.CurrentDoorState);
    }
    if (this.ObstructionDetected !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, this.ObstructionDetected);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState, e);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, e);
    this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, e);
    new this.platform.api.hap.HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
  }

  /**
   * Handle requests to set the value of the "TargetDoorState" characteristic
   */
  TargetDoorStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set TargertDoorState: %s', this.device.model, this.accessory.displayName, value);

    this.TargetDoorState = value;
    if (value === this.platform.Characteristic.TargetDoorState.CLOSED) {
      if (this.CurrentDoorState === this.platform.Characteristic.CurrentDoorState.OPEN) {
        this.platform.log.debug('Target CLOSED, Current OPEN, close the door');
        this.CurrentDoorState = this.platform.Characteristic.CurrentDoorState.CLOSING;
        this.Open = 0;
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
        this.Open = 0;
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
        this.Open = 0;
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
        this.Open = 1;
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
        this.Open = 1;
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
