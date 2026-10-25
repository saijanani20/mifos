import type { PrinterTransport } from './types';

export class WebBluetoothTransport implements PrinterTransport {
  name = 'Web Bluetooth LE Transport';
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private disconnectCallback?: () => void;

  // Standard Printer UUIDs including common Xprinter BLE UUIDs
  private PRINTER_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb', 
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', 
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '0000fee7-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000e0ff-0000-1000-8000-00805f9b34fb',
    '0000ae01-0000-1000-8000-00805f9b34fb',
    '0000180a-0000-1000-8000-00805f9b34fb',
    '00001101-0000-1000-8000-00805f9b34fb'
  ];
  private PRINTER_CHARACTERISTIC_UUIDS = [
    '00002af1-0000-1000-8000-00805f9b34fb', 
    '49535343-1e4d-4bd9-ba61-23c647249616', 
    'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    '0000fec7-0000-1000-8000-00805f9b34fb',
    '0000fec8-0000-1000-8000-00805f9b34fb',
    '0000ff01-0000-1000-8000-00805f9b34fb',
    '0000ff02-0000-1000-8000-00805f9b34fb',
    '00002a24-0000-1000-8000-00805f9b34fb',
    '0000ae02-0000-1000-8000-00805f9b34fb'
  ];

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && navigator.bluetooth != null;
  }

  async connect(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported by this browser.');
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.PRINTER_SERVICE_UUIDS
      });

      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

      const server = await this.device.gatt?.connect();
      if (!server) throw new Error('Could not connect to GATT Server');

      // Dynamic GATT discovery: iterate over all primary services and characteristics to find a writable one
      try {
        const services = await server.getPrimaryServices();
        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                this.characteristic = char;
                console.log(`[WebBluetoothTransport] Connected to writable characteristic: ${char.uuid} on service: ${service.uuid}`);
                return true;
              }
            }
          } catch (e) {
            // Ignore error for non-inspectable services
          }
        }
      } catch (e) {
        console.warn('[WebBluetoothTransport] Dynamic service scan failed, trying static fallback list:', e);
      }

      // Static UUID Fallback list if dynamic scan is restricted by browser security policies
      for (const serviceUuid of this.PRINTER_SERVICE_UUIDS) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          for (const charUuid of this.PRINTER_CHARACTERISTIC_UUIDS) {
            try {
              const characteristic = await service.getCharacteristic(charUuid);
              if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
                this.characteristic = characteristic;
                return true;
              }
            } catch (e) { /* Ignore */ }
          }
        } catch (e) { /* Ignore */ }
      }

      throw new Error('Could not find writable printer characteristic. Please ensure the printer is turned on and paired via Bluetooth.');

    } catch (error) {
      console.error('[WebBluetoothTransport] Connection error:', error);
      throw error;
    }
  }

  private handleDisconnect() {
    console.log('[WebBluetoothTransport] Device disconnected.');
    this.characteristic = null;
    if (this.disconnectCallback) {
      this.disconnectCallback();
    }
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async write(data: Uint8Array, chunkDelay = 30): Promise<boolean> {
    if (!this.characteristic) {
      throw new Error('Printer not connected or writable characteristic not found.');
    }

    const CHUNK_SIZE = 128; // Smaller chunks for BLE stability with thermal printers

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      // Prefer writeValueWithoutResponse (faster, no ACK), fall back to writeValue
      if (this.characteristic.properties.writeWithoutResponse && (this.characteristic as any).writeValueWithoutResponse) {
        await (this.characteristic as any).writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
      // Wait between chunks to prevent buffer overflow on the printer
      await new Promise((resolve) => setTimeout(resolve, chunkDelay));
    }

    return true;
  }

  isConnected(): boolean {
    return !!this.characteristic && !!this.device?.gatt?.connected;
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }
}
