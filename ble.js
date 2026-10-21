// Web Bluetooth abstraction for Smart Weighing Scale
export const SERVICE_UUID = '12345678-1234-1234-1234-123456789001';
export const CHARACTERISTIC_UUID = '12345678-1234-1234-1234-123456789002';

let bluetoothDevice = null;
let characteristic = null;
let connected = false;
let isConnecting = false;

let reconnectTimer = null;
let currentBackoffDelay = 2000; // 2s initial, x1.5, max 15s
const INITIAL_BACKOFF_DELAY = 2000;
const MAX_BACKOFF_DELAY = 15000;

const textListeners = new Set();
const disconnectListeners = new Set();
const connectListeners = new Set();

export function bleSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export function isConnected() {
  return connected && !!characteristic;
}

export function hasDevice() {
  return !!bluetoothDevice;
}

export function onText(cb) {
  textListeners.add(cb);
  return () => textListeners.delete(cb);
}

export function onDisconnect(cb) {
  disconnectListeners.add(cb);
  return () => disconnectListeners.delete(cb);
}

export function onConnect(cb) {
  connectListeners.add(cb);
  return () => connectListeners.delete(cb);
}

function notifyText(text) {
  for (const cb of textListeners) {
    try {
      cb(text);
    } catch (err) {
      console.error('onText callback error:', err);
    }
  }
}

function notifyDisconnect() {
  connected = false;
  characteristic = null;
  for (const cb of disconnectListeners) {
    try {
      cb();
    } catch (err) {
      console.error('onDisconnect callback error:', err);
    }
  }
}

function notifyConnect() {
  connected = true;
  for (const cb of connectListeners) {
    try {
      cb();
    } catch (err) {
      console.error('onConnect callback error:', err);
    }
  }
}

function handleCharacteristicValueChanged(event) {
  const value = event.target.value;
  const text = new TextDecoder().decode(value);
  notifyText(text);
}

function onDeviceDisconnected() {
  notifyDisconnect();
  scheduleReconnect();
}

function scheduleReconnect(customDelay) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (!hasDevice()) return;

  const delay = typeof customDelay === 'number' ? customDelay : currentBackoffDelay;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (isConnected() || isConnecting) return;
    try {
      await reconnect();
    } catch (err) {
      console.warn('Auto-reconnect attempt failed:', err);
    }
  }, delay);
}

// Auto-reconnect retry on document visibility change back to visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (hasDevice() && !isConnected() && !isConnecting) {
        currentBackoffDelay = INITIAL_BACKOFF_DELAY;
        scheduleReconnect(300);
      }
    }
  });
}

export async function connect() {
  if (!bleSupported()) {
    throw new Error('Web Bluetooth not supported here. Use Chrome on Android or desktop Chrome/Edge. On iPhone use the Bluefy browser app.');
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  isConnecting = true;
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    });

    bluetoothDevice = device;
    bluetoothDevice.addEventListener('gattserverdisconnected', onDeviceDisconnected);

    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

    currentBackoffDelay = INITIAL_BACKOFF_DELAY;
    notifyConnect();
    return bluetoothDevice;
  } finally {
    isConnecting = false;
  }
}

export async function reconnect() {
  if (!bluetoothDevice || connected || isConnecting) {
    return;
  }

  isConnecting = true;
  try {
    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

    currentBackoffDelay = INITIAL_BACKOFF_DELAY;
    notifyConnect();
  } catch (err) {
    currentBackoffDelay = Math.min(Math.round(currentBackoffDelay * 1.5), MAX_BACKOFF_DELAY);
    scheduleReconnect();
    throw err;
  } finally {
    isConnecting = false;
  }
}

export async function sendText(text) {
  if (!connected || !characteristic) {
    throw new Error('Scale is not connected');
  }

  const encoder = new TextEncoder();
  await characteristic.writeValue(encoder.encode(text));
}

export async function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
    try {
      bluetoothDevice.gatt.disconnect();
    } catch (e) {
      console.warn('Disconnect error:', e);
    }
  }

  connected = false;
  characteristic = null;
  notifyDisconnect();
}
