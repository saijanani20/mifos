// Ambient declarations for Web Bluetooth API
interface Navigator {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean;
      optionalServices?: string[];
      filters?: Array<{ name?: string; services?: string[] }>;
    }): Promise<BluetoothDevice>;
  };
}

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  device: BluetoothDevice;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  uuid: string;
  properties: {
    write?: boolean;
    writeWithoutResponse?: boolean;
    read?: boolean;
    notify?: boolean;
  };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}
