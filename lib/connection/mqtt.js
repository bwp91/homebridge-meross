import { createHash } from 'crypto';
import { connect as mqttConnect } from 'mqtt';
import pTimeout from 'p-timeout';
import { generateRandomString } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory) {
    this.accessory = accessory;
    this.clientResponseTopic = null;
    this.key = platform.accountDetails.key;
    this.platform = platform;
    this.queuedCommands = [];
    this.status = 'init';
    this.userId = platform.accountDetails.userId;
    this.uuid = accessory.context.serialNumber;
    this.waitingMessageIds = {};
  }

  connect() {
    const randomUUID = this.accessory.UUID.substring(0, this.accessory.UUID.length - 6) + generateRandomString(6);
    const appId = createHash('md5')
      .update(`API${randomUUID}`)
      .digest('hex');
    this.client = mqttConnect({
      protocol: 'mqtts',
      host: this.accessory.context.domain || 'eu-iotx.meross.com',
      port: 2001,
      clientId: `app:${appId}`,
      username: this.userId,
      password: createHash('md5')
        .update(this.userId + this.key)
        .digest('hex'),
      rejectUnauthorized: true,
      keepalive: 30,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      this.client.subscribe(`/app/${this.userId}/subscribe`, (err) => {
        if (err) {
          this.accessory.logWarn(`mqtt subscribe error - ${err}`);
        }
      });

      this.clientResponseTopic = `/app/${this.userId}-${appId}/subscribe`;
      this.client.subscribe(this.clientResponseTopic, (err) => {
        if (err) {
          this.accessory.logWarn(`mqtt user-response subscribe error - ${err}`);
        }
        this.accessory.logDebug('mqtt subscribe complete');
      });
      this.status = 'online';
      while (this.queuedCommands.length > 0) {
        const resolveFn = this.queuedCommands.pop();
        if (typeof resolveFn === 'function') {
          resolveFn();
        }
      }
    });

    this.client.on('message', (topic, msg) => {
      if (!msg) {
        return;
      }

      const msgStr = msg.toString();

      let decMsg;
      try {
        decMsg = JSON.parse(msgStr);
      } catch (e) {
        this.accessory.logWarn(`mqtt message error - [${e}] [${msgStr}]]`);
        return;
      }
      if (!decMsg.header?.from.includes(this.uuid)) {
        return;
      }

      // If message is the RESP for a previous action,
      // process return the control to the 'stopped' method.
      const resolveForThisMessage = this.waitingMessageIds[decMsg.header.messageId];
      if (typeof resolveForThisMessage === 'function') {
        resolveForThisMessage({ data: decMsg });
        delete this.waitingMessageIds[decMsg.header.messageId];
      } else if (decMsg.header.method === 'PUSH') {
        // Otherwise, process it accordingly
        if (this.accessory.control?.receiveUpdate && decMsg.payload) {
          this.accessory.control.receiveUpdate(decMsg);
        }
      }
    });
    this.client.on('error', (error) => {
      this.accessory.logWarn(`mqtt connection error${error ? ` [${error.toString()}]` : ''}`);
    });
    this.client.on('close', (error) => {
      this.accessory.logWarn(`mqtt connection closed${error ? ` [${error.toString()}]` : ''}`);
      this.status = 'offline';
    });
    this.client.on('reconnect', () => {
      this.accessory.logWarn('mqtt connection reconnecting');
      this.status = 'offline';
    });
  }

  disconnect() {
    this.client.end(true);
  }

  async sendUpdate(accessory, toSend) {
    // Timeout shorter for get updates than set updates
    const timeout = toSend.method === 'GET' ? 4000 : 9000;
    // Helper to queue commands before the device is connected
    if (this.status !== 'online') {
      let connectResolve;

      // We create a idle promise - connectPromise
      const connectPromise = new Promise((resolve) => {
        connectResolve = resolve;
      });

      // connectPromise will get resolved when the device connects
      this.queuedCommands.push(connectResolve);
      // when the device is connected, the futureCommand will be executed
      // that is exactly the same command issued now, but in the future
      const futureCommand = () => this.sendUpdate(toSend);
      // we return immediately an 'idle' promise, that when it gets resolved
      // it will then execute the futureCommand
      // IF the above takes too much time, the command will fail with a TimeoutError
      return pTimeout(connectPromise.then(futureCommand), {
        milliseconds: timeout,
      });
    }

    let commandResolve;
    // create an awaiting promise, it will get (maybe) resolved if the device responds in time
    const commandPromise = new Promise((resolve) => {
      commandResolve = resolve;
    });

    const messageId = createHash('md5')
      .update(generateRandomString(16))
      .digest('hex');
    const timestamp = Math.round(new Date().getTime() / 1000);

    const data = {
      header: {
        from: this.clientResponseTopic,
        messageId,
        method: toSend.method,
        namespace: toSend.namespace,
        payloadVersion: 1,
        sign: createHash('md5')
          .update(messageId + this.key + timestamp)
          .digest('hex'),
        timestamp,
      },
      payload: toSend.payload || {},
    };

    // Log to send
    accessory.logDebug(`${platformLang.sendMQTT}: ${JSON.stringify(data)}`);

    // Send the message
    this.client.publish(`/appliance/${this.uuid}/subscribe`, JSON.stringify(data));
    this.waitingMessageIds[messageId] = commandResolve;
    // the command returns with a timeout
    return pTimeout(commandPromise, {
      milliseconds: timeout,
    });
  }
}
