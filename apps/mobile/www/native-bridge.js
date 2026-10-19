"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      /*! Capacitor: https://capacitorjs.com/ - MIT License */
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform2 = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform2 in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform2] === "function" ? jsImplementation = await jsImplementations[platform2]() : jsImplementation = jsImplementations[platform2];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform2}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform2}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy2 = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy2;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy: proxy2,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform2] : []])
          });
          return proxy2;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          if (index !== -1) {
            this.listeners[eventName].splice(index, 1);
          }
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@capacitor/app/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    AppWeb: () => AppWeb
  });
  var AppWeb;
  var init_web = __esm({
    "node_modules/@capacitor/app/dist/esm/web.js"() {
      init_dist();
      AppWeb = class extends WebPlugin {
        constructor() {
          super();
          this.handleVisibilityChange = () => {
            const data = {
              isActive: document.hidden !== true
            };
            this.notifyListeners("appStateChange", data);
            if (document.hidden) {
              this.notifyListeners("pause", null);
            } else {
              this.notifyListeners("resume", null);
            }
          };
          document.addEventListener("visibilitychange", this.handleVisibilityChange, false);
        }
        exitApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getInfo() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getLaunchUrl() {
          return { url: "" };
        }
        async getState() {
          return { isActive: document.hidden !== true };
        }
        async minimizeApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async toggleBackButtonHandler() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getAppLanguage() {
          return {
            value: navigator.language.split("-")[0].toLowerCase()
          };
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js
  var StorageErrorType, KeychainAccess, StorageError;
  var init_definitions = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js"() {
      (function(StorageErrorType2) {
        StorageErrorType2["missingKey"] = "missingKey";
        StorageErrorType2["invalidData"] = "invalidData";
        StorageErrorType2["osError"] = "osError";
        StorageErrorType2["unknownError"] = "unknownError";
        StorageErrorType2["missingPrefix"] = "missingPrefix";
      })(StorageErrorType || (StorageErrorType = {}));
      (function(KeychainAccess2) {
        KeychainAccess2[KeychainAccess2["whenUnlocked"] = 0] = "whenUnlocked";
        KeychainAccess2[KeychainAccess2["whenUnlockedThisDeviceOnly"] = 1] = "whenUnlockedThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["afterFirstUnlock"] = 2] = "afterFirstUnlock";
        KeychainAccess2[KeychainAccess2["afterFirstUnlockThisDeviceOnly"] = 3] = "afterFirstUnlockThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["whenPasscodeSetThisDeviceOnly"] = 4] = "whenPasscodeSetThisDeviceOnly";
      })(KeychainAccess || (KeychainAccess = {}));
      StorageError = class extends Error {
        constructor(message, code) {
          super(message);
          this.name = "StorageError";
          this.code = code;
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js
  function isStorageErrorType(value) {
    return value !== void 0 && Object.keys(StorageErrorType).includes(value);
  }
  function parseISODate(isoDate) {
    const match = isoDateRE.exec(isoDate);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      const month = Number.parseInt(match[2], 10) - 1;
      const day = Number.parseInt(match[3], 10);
      const hour = Number.parseInt(match[4], 10);
      const minute = Number.parseInt(match[5], 10);
      const second = Number.parseInt(match[6], 10);
      const millis = Number.parseInt(match[7], 10);
      const epochTime = Date.UTC(year, month, day, hour, minute, second, millis);
      return new Date(epochTime);
    }
    return null;
  }
  var SecureStorageBase, isoDateRE;
  var init_base = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js"() {
      init_dist();
      init_definitions();
      SecureStorageBase = class _SecureStorageBase extends WebPlugin {
        constructor() {
          super(...arguments);
          this.prefix = "capacitor-storage_";
          this.sync = false;
          this.access = KeychainAccess.whenUnlocked;
        }
        async setSynchronize(sync) {
          this.sync = sync;
          if (Capacitor.getPlatform() === "ios") {
            return this.setSynchronizeKeychain({ sync });
          }
        }
        async getSynchronize() {
          return this.sync;
        }
        async setDefaultKeychainAccess(access) {
          this.access = access;
        }
        async tryOperation(operation) {
          try {
            return await operation();
          } catch (error) {
            if (error instanceof CapacitorException && isStorageErrorType(error.code)) {
              throw new StorageError(error.message, error.code);
            }
            throw error;
          }
        }
        async get(key, convertDate = true, sync) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            if (data === null) {
              return null;
            }
            if (convertDate) {
              const date = parseISODate(data);
              if (date) {
                return date;
              }
            }
            try {
              return JSON.parse(data);
            } catch (_a) {
              throw new StorageError("Invalid data", StorageErrorType.invalidData);
            }
          }
          return _SecureStorageBase.missingKey();
        }
        async getItem(key) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return data;
          }
          return null;
        }
        async set(key, data, convertDate = true, sync, access) {
          if (key) {
            let convertedData = data;
            if (convertDate && data instanceof Date) {
              convertedData = data.toISOString();
            }
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: JSON.stringify(convertedData),
              sync: sync !== null && sync !== void 0 ? sync : this.sync,
              access: access !== null && access !== void 0 ? access : this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async setItem(key, value) {
          if (key) {
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: value,
              sync: this.sync,
              access: this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async remove(key, sync) {
          if (key) {
            const { success } = await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            return success;
          }
          return _SecureStorageBase.missingKey();
        }
        async removeItem(key) {
          if (key) {
            await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return;
          }
          _SecureStorageBase.missingKey();
        }
        async clearItemsWithPrefix(options) {
          const prefix = this.checkPrefix(options.prefix);
          await this.tryOperation(async () => this.internalClearItemsWithPrefix({
            prefix,
            sync: this.sync
          }));
        }
        checkPrefix(prefix) {
          if (prefix.trim().length === 0) {
            throw new StorageError("Non-blank prefix provided", StorageErrorType.missingPrefix);
          }
          return prefix;
        }
        async keys(sync) {
          const { keys } = await this.tryOperation(async () => this.internalGetPrefixedKeys({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
          const prefixLength = this.prefix.length;
          return keys.map((key) => key.slice(prefixLength));
        }
        async getKeyPrefix() {
          return this.prefix;
        }
        async setKeyPrefix(prefix) {
          this.prefix = this.checkPrefix(prefix);
        }
        prefixedKey(key) {
          return this.prefix + key;
        }
        static missingKey() {
          throw new StorageError("No key provided", StorageErrorType.missingKey);
        }
      };
      isoDateRE = /^"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z"$/u;
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js
  var web_exports2 = {};
  __export(web_exports2, {
    SecureStorageWeb: () => SecureStorageWeb
  });
  var SecureStorageWeb;
  var init_web2 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js"() {
      init_base();
      SecureStorageWeb = class extends SecureStorageBase {
        // @native
        async setSynchronizeKeychain(_options) {
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalGetItem(options) {
          return { data: localStorage.getItem(options.prefixedKey) };
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalSetItem(options) {
          localStorage.setItem(options.prefixedKey, options.data);
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalRemoveItem(options) {
          const item = localStorage.getItem(options.prefixedKey);
          if (item !== null) {
            localStorage.removeItem(options.prefixedKey);
            return { success: true };
          }
          return { success: false };
        }
        async clear() {
          const { keys } = await this.internalGetPrefixedKeys({ prefix: this.prefix });
          for (const key of keys) {
            localStorage.removeItem(key);
          }
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalClearItemsWithPrefix(_options) {
          console.warn("internalClearItemsWithPrefix is native only");
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalGetPrefixedKeys(options) {
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null || key === void 0 ? void 0 : key.startsWith(options.prefix)) {
              keys.push(key);
            }
          }
          return { keys };
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js
  var native_exports = {};
  __export(native_exports, {
    SecureStorageNative: () => SecureStorageNative
  });
  var SecureStorageNative;
  var init_native = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js"() {
      init_base();
      SecureStorageNative = class extends SecureStorageBase {
        constructor(capProxy) {
          super();
          const proxy2 = capProxy;
          this.setSynchronizeKeychain = proxy2.setSynchronizeKeychain;
          this.internalGetItem = proxy2.internalGetItem;
          this.internalSetItem = proxy2.internalSetItem;
          this.internalRemoveItem = proxy2.internalRemoveItem;
          this.internalClearItemsWithPrefix = proxy2.internalClearItemsWithPrefix;
          this.internalGetPrefixedKeys = proxy2.internalGetPrefixedKeys;
        }
        // @native
        async setSynchronizeKeychain(_options) {
        }
        // @native
        async internalGetItem(_options) {
          return { data: "" };
        }
        // @native
        async internalSetItem(_options) {
        }
        // @native
        async internalRemoveItem(_options) {
          return { success: true };
        }
        async clear(sync) {
          return this.tryOperation(async () => this.clearItemsWithPrefix({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
        }
        // @native
        async internalClearItemsWithPrefix(_options) {
        }
        // @native
        async internalGetPrefixedKeys(_options) {
          return { keys: [] };
        }
      };
    }
  });

  // node_modules/@capacitor/local-notifications/dist/esm/web.js
  var web_exports3 = {};
  __export(web_exports3, {
    LocalNotificationsWeb: () => LocalNotificationsWeb
  });
  var LocalNotificationsWeb;
  var init_web3 = __esm({
    "node_modules/@capacitor/local-notifications/dist/esm/web.js"() {
      init_dist();
      LocalNotificationsWeb = class extends WebPlugin {
        constructor() {
          super(...arguments);
          this.pending = [];
          this.deliveredNotifications = [];
          this.hasNotificationSupport = () => {
            if (!("Notification" in window) || !Notification.requestPermission) {
              return false;
            }
            if (Notification.permission !== "granted") {
              try {
                new Notification("");
              } catch (e) {
                if (e instanceof Error && e.name === "TypeError") {
                  return false;
                }
              }
            }
            return true;
          };
        }
        async getDeliveredNotifications() {
          const deliveredSchemas = [];
          for (const notification of this.deliveredNotifications) {
            const deliveredSchema = {
              title: notification.title,
              id: parseInt(notification.tag),
              body: notification.body
            };
            deliveredSchemas.push(deliveredSchema);
          }
          return {
            notifications: deliveredSchemas
          };
        }
        async removeDeliveredNotifications(delivered) {
          for (const toRemove of delivered.notifications) {
            const found = this.deliveredNotifications.find((n) => n.tag === String(toRemove.id));
            found === null || found === void 0 ? void 0 : found.close();
            this.deliveredNotifications = this.deliveredNotifications.filter(() => !found);
          }
        }
        async removeDeliveredNotificationsById(options) {
          for (const id of options.ids) {
            const found = this.deliveredNotifications.find((n) => n.tag === String(id));
            found === null || found === void 0 ? void 0 : found.close();
            this.deliveredNotifications = this.deliveredNotifications.filter((n) => n !== found);
          }
        }
        async removeAllDeliveredNotifications() {
          for (const notification of this.deliveredNotifications) {
            notification.close();
          }
          this.deliveredNotifications = [];
        }
        async getByIds(options) {
          const ids = options.ids.map((id) => String(id));
          const scheduled = this.pending.filter((n) => ids.includes(String(n.id)));
          const delivered = this.deliveredNotifications.filter((n) => ids.includes(n.tag)).map((n) => this.deliveredToSchema(n));
          return { notifications: [...scheduled, ...delivered] };
        }
        async getAll(options) {
          const scheduled = [...this.pending];
          const delivered = this.deliveredNotifications.map((n) => this.deliveredToSchema(n));
          if ((options === null || options === void 0 ? void 0 : options.state) === "SCHEDULED") {
            return { notifications: scheduled };
          }
          if ((options === null || options === void 0 ? void 0 : options.state) === "TRIGGERED") {
            return { notifications: delivered };
          }
          return { notifications: [...scheduled, ...delivered] };
        }
        deliveredToSchema(notification) {
          return {
            title: notification.title,
            id: parseInt(notification.tag),
            body: notification.body
          };
        }
        async createChannel() {
          throw this.unimplemented("Not implemented on web.");
        }
        async deleteChannel() {
          throw this.unimplemented("Not implemented on web.");
        }
        async listChannels() {
          throw this.unimplemented("Not implemented on web.");
        }
        async schedule(options) {
          if (!this.hasNotificationSupport()) {
            throw this.unavailable("Notifications not supported in this browser.");
          }
          for (const notification of options.notifications) {
            this.sendNotification(notification);
          }
          return {
            notifications: options.notifications.map((notification) => ({
              id: notification.id
            }))
          };
        }
        async update(options) {
          if (!this.hasNotificationSupport()) {
            throw this.unavailable("Notifications not supported in this browser.");
          }
          const updated = [];
          for (const notification of options.notifications) {
            const index = this.pending.findIndex((n) => n.id === notification.id);
            if (index === -1) {
              continue;
            }
            this.pending.splice(index, 1);
            this.sendNotification(notification);
            updated.push(notification);
          }
          return {
            notifications: updated.map((notification) => ({ id: notification.id }))
          };
        }
        async getPending() {
          return {
            notifications: this.pending
          };
        }
        async cancelAll() {
          this.pending = [];
        }
        async registerActionTypes() {
          throw this.unimplemented("Not implemented on web.");
        }
        async cancel(pending) {
          this.pending = this.pending.filter((notification) => !pending.notifications.find((n) => n.id === notification.id));
        }
        async areEnabled() {
          const { display } = await this.checkPermissions();
          return {
            value: display === "granted"
          };
        }
        async changeExactNotificationSetting() {
          throw this.unimplemented("Not implemented on web.");
        }
        async checkExactNotificationSetting() {
          throw this.unimplemented("Not implemented on web.");
        }
        async requestPermissions() {
          if (!this.hasNotificationSupport()) {
            throw this.unavailable("Notifications not supported in this browser.");
          }
          const display = this.transformNotificationPermission(await Notification.requestPermission());
          return { display };
        }
        async checkPermissions() {
          if (!this.hasNotificationSupport()) {
            throw this.unavailable("Notifications not supported in this browser.");
          }
          const display = this.transformNotificationPermission(Notification.permission);
          return { display };
        }
        transformNotificationPermission(permission) {
          switch (permission) {
            case "granted":
              return "granted";
            case "denied":
              return "denied";
            default:
              return "prompt";
          }
        }
        sendPending() {
          var _a;
          const toRemove = [];
          const now = (/* @__PURE__ */ new Date()).getTime();
          for (const notification of this.pending) {
            if (((_a = notification.schedule) === null || _a === void 0 ? void 0 : _a.at) && notification.schedule.at.getTime() <= now) {
              this.buildNotification(notification);
              toRemove.push(notification);
            }
          }
          this.pending = this.pending.filter((notification) => !toRemove.find((n) => n === notification));
        }
        sendNotification(notification) {
          var _a;
          if ((_a = notification.schedule) === null || _a === void 0 ? void 0 : _a.at) {
            const diff = notification.schedule.at.getTime() - (/* @__PURE__ */ new Date()).getTime();
            this.pending.push(notification);
            setTimeout(() => {
              this.sendPending();
            }, diff);
            return;
          }
          this.buildNotification(notification);
        }
        buildNotification(notification) {
          const localNotification = new Notification(notification.title, {
            body: notification.body,
            tag: String(notification.id)
          });
          localNotification.addEventListener("click", this.onClick.bind(this, notification), false);
          localNotification.addEventListener("show", this.onShow.bind(this, notification), false);
          localNotification.addEventListener("close", () => {
            this.deliveredNotifications = this.deliveredNotifications.filter(() => !this);
          }, false);
          this.deliveredNotifications.push(localNotification);
          return localNotification;
        }
        onClick(notification) {
          const data = {
            actionId: "tap",
            notification
          };
          this.notifyListeners("localNotificationActionPerformed", data);
        }
        onShow(notification) {
          this.notifyListeners("localNotificationReceived", notification);
        }
      };
    }
  });

  // node_modules/@capgo/capacitor-share-target/dist/esm/web.js
  var web_exports4 = {};
  __export(web_exports4, {
    CapacitorShareTargetWeb: () => CapacitorShareTargetWeb
  });
  var CapacitorShareTargetWeb;
  var init_web4 = __esm({
    "node_modules/@capgo/capacitor-share-target/dist/esm/web.js"() {
      init_dist();
      CapacitorShareTargetWeb = class extends WebPlugin {
        async getPluginVersion() {
          return { version: "web" };
        }
      };
    }
  });

  // bridge/native-bridge.ts
  init_dist();

  // node_modules/@capacitor/app/dist/esm/index.js
  init_dist();
  var App = registerPlugin("App", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.AppWeb())
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/index.js
  init_dist();
  init_definitions();
  var proxy = registerPlugin("SecureStorage", {
    web: async () => {
      const module = await Promise.resolve().then(() => (init_web2(), web_exports2));
      return new module.SecureStorageWeb();
    },
    ios: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.SecureStorageNative(proxy);
    },
    android: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.SecureStorageNative(proxy);
    }
  });

  // node_modules/@capacitor/local-notifications/dist/esm/index.js
  init_dist();

  // node_modules/@capacitor/local-notifications/dist/esm/definitions.js
  var Weekday;
  (function(Weekday2) {
    Weekday2[Weekday2["Sunday"] = 1] = "Sunday";
    Weekday2[Weekday2["Monday"] = 2] = "Monday";
    Weekday2[Weekday2["Tuesday"] = 3] = "Tuesday";
    Weekday2[Weekday2["Wednesday"] = 4] = "Wednesday";
    Weekday2[Weekday2["Thursday"] = 5] = "Thursday";
    Weekday2[Weekday2["Friday"] = 6] = "Friday";
    Weekday2[Weekday2["Saturday"] = 7] = "Saturday";
  })(Weekday || (Weekday = {}));

  // node_modules/@capacitor/local-notifications/dist/esm/index.js
  var LocalNotifications = registerPlugin("LocalNotifications", {
    web: () => Promise.resolve().then(() => (init_web3(), web_exports3)).then((m) => new m.LocalNotificationsWeb())
  });

  // node_modules/@transistorsoft/capacitor-background-fetch/dist/esm/index.js
  init_dist();
  var EVENT_FETCH = "fetch";
  var TAG = "BackgroundFetch";
  var STATUS_RESTRICTED = 0;
  var STATUS_DENIED = 1;
  var STATUS_AVAILABLE = 2;
  var NETWORK_TYPE_NONE = 0;
  var NETWORK_TYPE_ANY = 1;
  var NETWORK_TYPE_UNMETERED = 2;
  var NETWORK_TYPE_NOT_ROAMING = 3;
  var NETWORK_TYPE_CELLULAR = 4;
  var NativeModule = registerPlugin("BackgroundFetch");
  var subscriber = null;
  var BackgroundFetch = class _BackgroundFetch {
    /**
    * Background fetch updates are unavailable and the user cannot enable them again. For example, this status can occur when parental controls are in effect for the current user.
    */
    static get STATUS_RESTRICTED() {
      return STATUS_RESTRICTED;
    }
    /**
    * The user explicitly disabled background behavior for this app or for the whole system.
    */
    static get STATUS_DENIED() {
      return STATUS_DENIED;
    }
    /**
    * Background fetch is available and enabled.
    */
    static get STATUS_AVAILABLE() {
      return STATUS_AVAILABLE;
    }
    /**
    * This job doesn't care about network constraints, either any or none.
    */
    static get NETWORK_TYPE_NONE() {
      return NETWORK_TYPE_NONE;
    }
    /**
    * This job requires network connectivity.
    */
    static get NETWORK_TYPE_ANY() {
      return NETWORK_TYPE_ANY;
    }
    /**
    * This job requires network connectivity that is a cellular network.
    */
    static get NETWORK_TYPE_CELLULAR() {
      return NETWORK_TYPE_CELLULAR;
    }
    /**
    * This job requires network connectivity that is unmetered.
    */
    static get NETWORK_TYPE_UNMETERED() {
      return NETWORK_TYPE_UNMETERED;
    }
    /**
    * This job requires network connectivity that is not roaming.
    */
    static get NETWORK_TYPE_NOT_ROAMING() {
      return NETWORK_TYPE_NOT_ROAMING;
    }
    /**
    * Initial configuration of BackgroundFetch, including config-options and Fetch-callback.  The [[start]] method will automatically be executed.
    *
    * ```javascript
    *   async initBackgroundFetch() {
    *     const status = await BackgroundFetch.configure({
    *       minimumFetchInterval: 15
    *     }, async (taskId) => {  // <---------------- Event handler.
    *       console.log('[BackgroundFetch] EVENT:', taskId);
    *       // Perform your work in an awaited Promise
    *       const result = await this.performYourWorkHere();
    *       console.log('[BackgroundFetch] work complete:', result);
    *       // [REQUIRED] Signal to the OS that your work is complete.
    *       BackgroundFetch.finish(taskId);
    *     }, async (taskId) => {  // <---------------- Event timeout handler
    *       // The OS has signalled that your remaining background-time has expired.
    *       // You must immediately complete your work and signal #finish.
    *       console.log('[BackgroundFetch] TIMEOUT:', taskId);
    *       // [REQUIRED] Signal to the OS that your work is complete.
    *       BackgroundFetch.finish(taskId);
    *     });
    *
    *     // Checking BackgroundFetch status:
    *     if (status !== BackgroundFetch.STATUS_AVAILABLE) {
    *       // Uh-oh:  we have a problem:
    *       if (status === BackgroundFetch.STATUS_DENIED) {
    *         alert('The user explicitly disabled background behavior for this app or for the whole system.');
    *       } else if (status === BackgroundFetch.STATUS_RESTRICTED) {
    *         alert('Background updates are unavailable and the user cannot enable them again.')
    *       }
    *     }
    *   }
    *
    *   // Simulate a long-running task (eg:  an HTTP request)
    *   async performYourWorkHere() {
    *     return new Promise((resolve, reject) => {
    *       setTimeout(() => {
    *         resolve(true);
    *       }, 5000);
    *     });
    *   }
    * }
    * ```
    */
    static configure(config, onEvent, onTimeout) {
      if (typeof onEvent !== "function") {
        throw "BackgroundFetch requires an event callback at 2nd argument";
      }
      if (typeof onTimeout !== "function") {
        console.warn("[BackgroundFetch] configure:  You did not provide a 3rd argument onTimeout callback.  This callback is a signal from the OS that your allowed background time is about to expire.  Use this callback to finish what you're doing and immediately call BackgroundFetch.finish(taskId)");
        onTimeout = (taskId) => {
          console.warn("[BackgroundFetch] default onTimeout callback fired.  You should provide your own onTimeout callbcak to .configure(options, onEvent, onTimeout)");
          _BackgroundFetch.finish(taskId);
        };
      }
      const myOnTimeout = onTimeout;
      if (subscriber !== null) {
        subscriber.remove();
        subscriber = null;
      }
      subscriber = NativeModule.addListener(EVENT_FETCH, (event) => {
        if (!event.timeout) {
          onEvent(event.taskId);
        } else {
          myOnTimeout(event.taskId);
        }
      });
      config = config || {};
      return new Promise((resolve, reject) => {
        NativeModule.configure({ options: config }).then((result) => {
          resolve(result.status);
        }).catch((error) => {
          console.warn(TAG, "ERROR:", error);
          reject(error.message);
        });
      });
    }
    /**
    * Execute a custom task in addition to the one initially provided to [[configure]].
    * This event can be configured to either a "ONE-SHOT" or "PERIODIC" with [[TaskConfig.periodic]].
    *
    * ```javascript
    * // You must ALWAYS first configure BackgroundFetch.
    * const status = await BackgroundFetch.configure({
    *   minimumFetchInterval: 15
    * }, async (taskId) => {
    *   console.log('[BackgroundFetch] EVENT', taskId);
    *   if (taskId === 'my-custom-task') {
    *     console.log('Handle your custom-task here');
    *   } else {
    *     console.log('This is the default, periodic fetch task');
    *   }
    *   // Always signal completion of your tasks.
    *   BackgroundFetch.finish(taskId);
    * }, async (taskId) => {
    *   console.log('[BackgroundFetch] TIMEOUT', taskId);
    *   if (taskId === 'my-custom-task') {
    *     console.log('My custom task timed-out');
    *   } else {
    *     console.log('The default, periodic fetch task timed-out');
    *   }
    *   BackgroundFetch.finish(taskId);
    * });
    *
    * // Execute an additional custom-task.
    * BackgroundFetch.scheduleTask({
    *   taskId: 'my-custom-task',  // <-- REQUIRED
    *   delay: 10000,              // <-- REQUIRED
    *   periodic: false            // <-- ONE-SHOT (default)
    * })
    * ```
    */
    static scheduleTask(config) {
      return new Promise((resolve, reject) => {
        if (typeof config.delay !== "number") {
          const delay = parseInt(config.delay, 10);
          if (delay === NaN) {
            reject("[BackgroundFetch] TaskConfig.delay must be a number: " + config.delay);
            return;
          }
          config.delay = delay;
        }
        return NativeModule.scheduleTask({ options: config }).then(() => {
          resolve();
        }).catch((error) => {
          reject(error.message);
        });
      });
    }
    /**
    * Start subscribing to fetch events.
    *
    * __Note:__ The inital call to [[configure]] *automatically* calls __`BackgroundFetch.start()`__
    *
    * ```javascript
    *   async initBackgroundFetch() {
    *     // Calling .configure() automatically starts the plugin.
    *     const status = await BackgroundFetch.configure({
    *       minimumFetchInterval: 15
    *     }, async (taskId) => {  // <---------------- Event handler.
    *       console.log('[BackgroundFetch] EVENT:', taskId);
    *       BackgroundFetch.finish(taskId);
    *     }, async (taskId) => {  // <---------------- Event timeout handler
    *       console.log('[BackgroundFetch] TIMEOUT:', taskId);
    *       // [REQUIRED] Signal to the OS that your work is complete.
    *       BackgroundFetch.finish(taskId);
    *     });
    *   }
    *
    *   // Stop BackgroundFetch
    *   onClickStop() {
    *     BackgroundFetch.stop();
    *   }
    *
    *   // Re-start BackgroundFetch
    *   onClickStart() {
    *     BackgroundFetch.start();
    *   }
    *
    * ```
    */
    static start() {
      return new Promise((resolve, reject) => {
        NativeModule.start().then((result) => {
          resolve(result.status);
        }).catch((error) => {
          reject(error.message);
        });
      });
    }
    /**
    * Stop subscribing to fetch events.
    *
    * ```javascript
    * // Stop everything.
    * BackgroundFetch.stop();
    * ```
    *
    * You may also provide an optional __`taskId`__ to stop a [[scheduleTask]]:
    *
    * ```javascript
    * // Stop a particular task scheduled with BackgroundFetch.scheduleTask
    * await BackgroundFetch.scheduleTask({
    *   taskId: 'my-custom-task',
    *   delay: 10000,
    *   periodic: false
    * });
    * .
    * .
    * .
    * BackgroundFetch.stop('my-custom-task');
    * ```
    */
    static stop(taskId) {
      return new Promise((resolve, reject) => {
        NativeModule.stop({ taskId }).then(() => {
          resolve();
        }).catch((error) => {
          reject(error.message);
        });
      });
    }
    /**
    * You must execute `BackgroundFetch.finish(taskId)` within your fetch-callback to signal completion of your task.
    *
    * If you *fail* to call `.finish()`, the OS __will punish your app for poor behaviour and stop firing events__.
    *
    * ```javascript
    * await BackgroundFetch.configure({
    *   minimumFetchInterval: 15
    * }, async (taskId) => {
    *   console.log('[BackgroundFetch] EVENT', taskId);
    *   // Always signal completion of your tasks.
    *   BackgroundFetch.finish(taskId);
    * }, async (taskId) => {
    *   console.log('[BackgroundFetch] TIMEOUT', taskId);
    *   // Always signal completion of your tasks.
    *   BackgroundFetch.finish(taskId);
    * });
    * ```
    */
    static finish(taskId) {
      return NativeModule.finish({ taskId });
    }
    /**
    * Query the BackgroundFetch API status
    *
    * ```javascript
    * // Checking BackgroundFetch status:
    * const status = await BackgroundFetch.status();
    *
    * if (status !== BackgroundFetch.STATUS_AVAILABLE) {
    *   // Uh-oh:  we have a problem:
    *   if (status === BackgroundFetch.STATUS_DENIED) {
    *     alert('The user explicitly disabled background behavior for this app or for the whole system.');
    *   } else if (status === BackgroundFetch.STATUS_RESTRICTED) {
    *     alert('Background updates are unavailable and the user cannot enable them again.')
    *   }
    * }
    * ```
    *
    * | BackgroundFetchStatus              | Description                                     |
    * |------------------------------------|-------------------------------------------------|
    * | `BackgroundFetch.STATUS_RESTRICTED`  | Background fetch updates are unavailable and the user cannot enable them again. For example, this status can occur when parental controls are in effect for the current user. |
    * | `BackgroundFetch.STATUS_DENIED`      | The user explicitly disabled background behavior for this app or for the whole system. |
    * | `BackgroundFetch.STATUS_AVAILABLE`   | Background fetch is available and enabled.      |
    */
    static status() {
      return new Promise((resolve, reject) => {
        NativeModule.status().then((result) => {
          resolve(result.status);
        }).catch((error) => {
          reject(error.message);
        });
      });
    }
  };

  // node_modules/@capgo/capacitor-share-target/dist/esm/index.js
  init_dist();
  var CapacitorShareTarget = registerPlugin("CapacitorShareTarget", {
    web: () => Promise.resolve().then(() => (init_web4(), web_exports4)).then((m) => new m.CapacitorShareTargetWeb())
  });

  // brand.json
  var brand_default = {
    $comment: "The one place the product name and ids live. apps/mobile and apps/desktop both read this file (scripts/apply-brand.mjs, capacitor.config.ts, apps/desktop/scripts/sync-web.mjs). Name-conflict check pending; the id must match a domain the publisher controls (multiverse.school). See docs/SHIPPING.md, Decisions.",
    displayName: "Meme Video",
    shortName: "Meme Video",
    appId: "school.multiverse.memevideo",
    publisher: "The Multiverse School",
    customUrlScheme: "memevideo"
  };

  // bridge/links.ts
  var MAX_INPUT = 4096;
  var MAX_URL = 512;
  var BECH32 = /^(npub|nprofile)1[02-9ac-hj-np-z]{6,}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SHORT_UUID = /^[1-9A-HJ-NP-Za-km-z]{16,24}$/;
  function parseNostr(input) {
    let s = input.trim();
    if (s.length > MAX_INPUT) return null;
    s = s.replace(/^nostr:(\/\/)?/i, "");
    s = s.toLowerCase();
    return BECH32.test(s) ? s : null;
  }
  function parsePeerTubeWatch(input) {
    const s = input.trim();
    if (s.length > MAX_URL) return null;
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    let id;
    if (parts.length === 2 && parts[0] === "w") id = parts[1];
    else if (parts.length === 3 && parts[0] === "videos" && (parts[1] === "watch" || parts[1] === "embed")) id = parts[2];
    if (!id || !(UUID.test(id) || SHORT_UUID.test(id))) return null;
    const t = u.searchParams.get("start") ?? u.searchParams.get("t");
    const clean = new URL(`https://${u.host}/w/${id}`);
    if (t && /^[0-9hms]{1,12}$/.test(t)) clean.searchParams.set("start", t);
    return { value: clean.toString(), host: u.host.toLowerCase(), videoId: id };
  }
  function classifyLink(url, source) {
    const n = parseNostr(url);
    if (n) return { kind: "nostr", source, value: n };
    const p = parsePeerTubeWatch(url);
    if (p) return { kind: "peertube-watch", source, ...p };
    return null;
  }
  function classifySharedText(text) {
    if (typeof text !== "string" || text.length > MAX_INPUT) return null;
    for (const token of text.split(/\s+/)) {
      const tok = token.replace(/^[<("']+|[>)"'.,;!?]+$/g, "");
      if (!tok) continue;
      const hit = classifyLink(tok, "share");
      if (hit) return hit;
    }
    return null;
  }
  function parseShareHandoff(url, scheme) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== `${scheme}:`) return null;
    if (u.host !== "share" && u.pathname.replace(/^\/+/, "") !== "share") return null;
    return { text: u.searchParams.get("text") };
  }

  // bridge/types.ts
  var SECRET_NAMES = ["nostr-secret-key", "vault-key"];
  var MAX_SECRET_LENGTH = 4096;

  // bridge/native-bridge.ts
  var platform = Capacitor.getPlatform();
  function install() {
    if (!Capacitor.isNativePlatform() || platform !== "android" && platform !== "ios") return;
    const ACCESS = {
      "vault-key": KeychainAccess.afterFirstUnlockThisDeviceOnly,
      "nostr-secret-key": KeychainAccess.whenUnlockedThisDeviceOnly
    };
    const ready = (async () => {
      await proxy.setKeyPrefix("mf_");
      await proxy.setSynchronize(false);
    })();
    const checkName = (name) => {
      if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret name: ${name}`);
      return name;
    };
    const secrets = {
      async get(name) {
        await ready;
        const v = await proxy.get(checkName(name), false, false);
        return typeof v === "string" ? v : null;
      },
      async set(name, value) {
        await ready;
        if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH) throw new Error("Secret must be a non-empty string of at most 4096 characters");
        const n = checkName(name);
        await proxy.set(n, value, false, false, ACCESS[n]);
      },
      async remove(name) {
        await ready;
        await proxy.remove(checkName(name), false);
      }
    };
    const queue = [];
    let handler = null;
    let last = { key: "", at: 0 };
    const deliver = (item) => {
      if (!item) return;
      const key = `${item.kind}:${item.value}`;
      const now = Date.now();
      if (key === last.key && now - last.at < 2e3) return;
      last = { key, at: now };
      if (handler) handler(item);
      else if (queue.length < 16) queue.push(item);
    };
    const onUrl = (url) => {
      const handoff = parseShareHandoff(url, brand_default.customUrlScheme);
      if (handoff) {
        if (handoff.text) deliver(classifySharedText(handoff.text));
        return;
      }
      deliver(classifyLink(url, "deeplink"));
    };
    void App.getLaunchUrl().then((r) => (r == null ? void 0 : r.url) && onUrl(r.url)).catch(() => {
    });
    void App.addListener("appUrlOpen", (e) => onUrl(e.url));
    if (platform === "ios") {
      void CapacitorShareTarget.addListener("shareReceived", (e) => {
        for (const t of e.texts ?? []) {
          const hit = classifySharedText(t);
          if (hit) return deliver(hit);
        }
        deliver(classifySharedText(e.title ?? ""));
      });
    }
    const incoming = {
      onIncoming(h) {
        handler = h;
        for (const item of queue.splice(0)) h(item);
        return () => {
          if (handler === h) handler = null;
        };
      }
    };
    const CHANNEL = "match-requests";
    const mapPerm = (p) => p === "granted" ? "granted" : p === "denied" ? "denied" : "prompt";
    let channelMade = null;
    const ensureChannel = () => channelMade ??= platform === "android" ? LocalNotifications.createChannel({ id: CHANNEL, name: "Match requests", description: "New match requests and replies", importance: 3, visibility: 0 }) : Promise.resolve();
    let openHandler = null;
    let pendingOpen;
    void LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
      var _a, _b;
      const route = typeof ((_b = (_a = a.notification) == null ? void 0 : _a.extra) == null ? void 0 : _b.route) === "string" ? a.notification.extra.route : null;
      if (openHandler) openHandler(route);
      else pendingOpen = route;
    });
    const notifications = {
      async permission() {
        return mapPerm((await LocalNotifications.checkPermissions()).display);
      },
      async requestPermission() {
        return mapPerm((await LocalNotifications.requestPermissions()).display);
      },
      async notify({ id, title, body, route }) {
        if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
        if (!Number.isInteger(id) || id < 1 || id > 2 ** 31 - 1) throw new Error("id must be a positive 32-bit integer");
        await ensureChannel();
        await LocalNotifications.schedule({
          notifications: [
            {
              id,
              title: String(title).slice(0, 64),
              body: String(body).slice(0, 160),
              channelId: CHANNEL,
              // Inexact: no SCHEDULE_EXACT_ALARM permission, no "Alarms & reminders" settings screen.
              isExactNotification: false,
              extra: route ? { route: String(route).slice(0, 64) } : void 0
            }
          ]
        });
      },
      onOpen(h) {
        openHandler = h;
        if (pendingOpen !== void 0) {
          h(pendingOpen);
          pendingOpen = void 0;
        }
        return () => {
          if (openHandler === h) openHandler = null;
        };
      }
    };
    const BUDGET_MS = 25e3;
    let bgHandler = null;
    const background = {
      async enable(h, opts) {
        bgHandler = h;
        const minutes = Math.max(15, Math.min(24 * 60, Math.round((opts == null ? void 0 : opts.minimumIntervalMinutes) ?? 12 * 60)));
        const status = await BackgroundFetch.configure(
          {
            minimumFetchInterval: minutes,
            // Our work is JavaScript in the WebView, so nothing runs after the app is terminated
            // (Android headless tasks would have to be Java).
            stopOnTerminate: true,
            startOnBoot: false,
            enableHeadless: false,
            requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
            requiresBatteryNotLow: true
          },
          async (taskId) => {
            try {
              const run = bgHandler ? bgHandler() : Promise.resolve();
              await Promise.race([run, new Promise((r) => setTimeout(r, BUDGET_MS))]);
            } catch {
            } finally {
              await BackgroundFetch.finish(taskId);
            }
          },
          async (taskId) => {
            await BackgroundFetch.finish(taskId);
          }
        );
        return status === BackgroundFetch.STATUS_AVAILABLE ? "available" : status === BackgroundFetch.STATUS_DENIED ? "denied" : "restricted";
      },
      async disable() {
        bgHandler = null;
        await BackgroundFetch.stop();
      }
    };
    const api = Object.freeze({
      version: 1,
      platform,
      secrets: Object.freeze(secrets),
      incoming: Object.freeze(incoming),
      notifications: Object.freeze(notifications),
      background: Object.freeze(background)
    });
    Object.defineProperty(window, "MatchFeedNative", { value: api, writable: false, configurable: false, enumerable: false });
  }
  install();
})();
