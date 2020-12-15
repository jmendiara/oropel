import { RxMqttClient } from '../src/index';

describe('RxMqttClient', () => {
  it('should create de RxMqttClient', () => {
    const client = new RxMqttClient();
    expect(client).toBeInstanceOf(RxMqttClient);
  });
});
