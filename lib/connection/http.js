import { createHash } from 'crypto';
import axios from 'axios';
import platformConsts from '../utils/constants.js';
import {
  encodeParams,
  generateRandomString,
  hasProperty,
  parseError,
  sleep,
} from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform) {
    this.devLoginRetried = false;
    this.domain = platform.config.domain;
    this.ignoredDevices = platform.ignoredDevices;
    this.ignoreHKNative = platform.config.ignoreHKNative;
    this.ignoreMatter = platform.config.ignoreMatter;
    this.key = platform.accountDetails.key;
    this.log = platform.log;
    this.mfaCode = platform.config.mfaCode;
    this.password = platform.config.password;
    this.showUserKey = platform.config.showUserKey;
    this.storageData = platform.storageData;
    this.token = platform.accountDetails.token;
    this.userId = platform.accountDetails.userId;
    this.username = platform.config.username;
    this.userkey = platform.config.userkey;

    this.requestHeaders = {
      AppLanguage: 'en',
      AppType: 'iOS',
      AppVersion: '3.22.4',
      Vendor: 'meross',
      'User-Agent': 'intellect_socket/3.22.4 (iPhone; iOS 17.2; Scale/2.00)',
    };

    // Common error codes
    // https://github.com/Apollon77/meross-cloud/blob/master/lib/errorcodes.js
    // 500: 'The selected timezone is not supported',
    // 1001: 'Wrong or missing password',
    // 1002: 'Account does not exist',
    // 1003: 'This account has been disabled or deleted',
    // 1004: 'Wrong email or password',
    // 1005: 'Invalid email address',
    // 1006: 'Bad password format',
    // 1008: 'This email is not registered',
    // 1019: 'Token expired',
    // 1022: some issue with token
    // 1032: some issue with mfa
    // 1033: some issue with mfa
    // 1200: 'Token has expired',
    // 1255: 'The number of remote control boards exceeded the limit',
    // 1301: 'Too many tokens have been issued',
    // 5000: 'Unknown or generic error',
    // 5001: 'Unknown or generic error',
    // 5002: 'Unknown or generic error',
    // 5003: 'Unknown or generic error',
    // 5004: 'Unknown or generic error',
    // 5020: 'Infrared Remote device is busy',
    // 5021: 'Infrared record timeout',
    // 5022: 'Infrared record invalid'
  }

  async login() {
    try {
      const nonce = generateRandomString(16);
      const timestampMillis = Date.now();
      const loginParams = encodeParams({
        email: this.username,
        password: this.password,
        encryption: 0,
        accountCountryCode: '--',
        mobileInfo: {
          resolution: '--',
          carrier: '--',
          deviceModel: '--',
          mobileOs: '--',
          mobileOSVersion: '--',
          uuid: '--',
        },
        agree: 1,
        mfaCode: this.mfaCode || undefined,
      });

      // Generate the md5-hash (called signature)
      const dataToSign = `23x17ahWarFH6w29${timestampMillis}${nonce}${loginParams}`;
      const md5hash = createHash('md5')
        .update(dataToSign)
        .digest('hex');

      const res = await axios({
        url: `https://${this.domain}/v1/Auth/signIn`,
        method: 'post',
        headers: {
          Authorization: 'Basic ',
          ...this.requestHeaders,
        },
        data: {
          params: loginParams,
          sign: md5hash,
          timestamp: timestampMillis,
          nonce,
        },
      });

      // Check to see we got a response
      if (!res.data || !res.data.data) {
        throw new Error(platformLang.noResponse);
      }

      if (Object.keys(res.data.data).length === 0) {
        // Sometimes returns 'Wrong password', sometimes 'Incorrect password'
        if (res.data.info?.includes('password') || res.data.apiStatus === 1004) {
          if (!this.base64Tried) {
            this.base64Tried = true;
            this.password = Buffer.from(this.password, 'base64')
              .toString('utf8')
              .replace(/(\r\n|\n|\r)/gm, '')
              .trim();
            return await this.login();
          }
        }

        if ([1032, 1033].includes(res.data.apiStatus)) {
          throw new Error(platformLang.mfaFail);
        }

        throw new Error(`${platformLang.loginFail} - ${JSON.stringify(res.data)}`);
      }
      this.key = res.data.data.key;
      this.token = res.data.data.token;
      this.userId = res.data.data.userid;
      if (this.showUserKey && !this.userkey) {
        this.log.warn('%s: %s', platformLang.merossKey, this.key);
      }
      try {
        await this.storageData.setItem(
          'Meross_All_Devices_temp',
          `${this.username}:::${this.key}:::${this.token}:::${this.userId}`,
        );
      } catch (e) {
        this.log.warn('[HTTP] %s %s.', platformLang.accTokenStoreErr, parseError(e));
      }

      return {
        key: this.key,
        token: this.token,
        userId: this.userId,
      };
    } catch (err) {
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [login() - %s].', platformLang.httpRetry, err.code);
        await sleep(30000);
        return this.login();
      }
      throw err;
    }
  }

  async getDevices() {
    try {
      if (!this.token) {
        throw new Error(platformLang.notAuth);
      }

      const nonce = generateRandomString(16);
      const timestampMillis = Date.now();
      const loginParams = encodeParams({});

      // Generate the md5-hash (called signature)
      const dataToSign = `23x17ahWarFH6w29${timestampMillis}${nonce}${loginParams}`;
      const md5hash = createHash('md5')
        .update(dataToSign)
        .digest('hex');

      const res = await axios({
        url: `https://${this.domain}/v1/Device/devList`,
        method: 'post',
        headers: {
          Authorization: `Basic ${this.token}`,
          ...this.requestHeaders,
        },
        data: {
          params: loginParams,
          sign: md5hash,
          timestamp: timestampMillis,
          nonce,
        },
      });

      // Check to see we got a response
      if (!res.data) {
        throw new Error(platformLang.noResponse);
      }

      if (!hasProperty(res.data, 'data') || !Array.isArray(res.data.data)) {
        // apiStatus 1022 denotes that the token is invalid or has expired
        // we could try logging in again, just once, and only if the mfaCode is not set
        if (res.data.apiStatus === 1022) {
          if (!this.mfaCode && !this.devLoginRetried) {
            this.devLoginRetried = true;
            this.log.warn('%s.', platformLang.loginRetry);
            await this.login();
            return this.getDevices();
          }
          throw new Error(platformLang.accTokenInvalid);
        }
        throw new Error(`${platformLang.invalidDevices} - ${JSON.stringify(res.data)}`);
      }

      // Don't return ignored devices or those that have been configured for local control
      const toReturn = [];
      res.data.data.forEach((device) => {
        // Don't initialise the device if ignored
        if (this.ignoredDevices.includes(device.uuid)) {
          this.log('[%s] %s.', device.devName, platformLang.noInitIgnore);
          return;
        }

        const model = device.deviceType.toUpperCase();

        // Don't initialise the device if the 'ignore homekit native option' is enabled and hardware matches
        if (
          this.ignoreHKNative
          && device.hdwareVersion
          && Array.isArray(platformConsts.hkNativeHardware[model])
          && platformConsts.hkNativeHardware[model].includes(device.hdwareVersion.charAt(0))
        ) {
          this.log('[%s] %s.', device.devName, platformLang.noInitHKIgnore);
          return;
        }

        // Don't initialise the device if the 'ignore matter option' is enabled and hardware matches
        if (
          this.ignoreMatter
          && device.hdwareVersion
          && Array.isArray(platformConsts.matterHardware[model])
          && platformConsts.matterHardware[model].includes(device.hdwareVersion.charAt(0))
        ) {
          this.log('[%s] %s.', device.devName, platformLang.noInitMatterIgnore);
          return;
        }

        // Add the device to the return array for the plugin to initialise as a cloud device
        toReturn.push(device);
      });

      // Return the amended device list
      return toReturn;
    } catch (err) {
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [getDevices() - %s].', platformLang.httpRetry, err.code);
        await sleep(30000);
        return this.getDevices();
      }
      throw err;
    }
  }

  async getSubDevices(device) {
    try {
      if (!this.token) {
        throw new Error(platformLang.notAuth);
      }

      const nonce = generateRandomString(16);
      const timestampMillis = Date.now();
      const loginParams = encodeParams({
        uuid: device.uuid,
      });

      // Generate the md5-hash (called signature)
      const dataToSign = `23x17ahWarFH6w29${timestampMillis}${nonce}${loginParams}`;
      const md5hash = createHash('md5')
        .update(dataToSign)
        .digest('hex');

      const res = await axios({
        url: `https://${this.domain}/v1/Hub/getSubDevices`,
        method: 'post',
        headers: {
          Authorization: `Basic ${this.token}`,
          ...this.requestHeaders,
        },
        data: {
          params: loginParams,
          sign: md5hash,
          timestamp: timestampMillis,
          nonce,
        },
      });

      // Check to see we got a response
      if (!res.data) {
        throw new Error(platformLang.noResponse);
      }

      if (
        res.data.info !== 'Success'
        || !hasProperty(res.data, 'data')
        || !Array.isArray(res.data.data)
      ) {
        throw new Error(`${platformLang.invalidSubdevices} - ${JSON.stringify(res.data)}`);
      }

      // Return the subdevice list to the platform
      return res.data.data;
    } catch (err) {
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [getDevices() - %s].', platformLang.httpRetry, err.code);
        await sleep(30000);
        return this.getSubDevices();
      }
      throw err;
    }
  }
}
