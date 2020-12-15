import { MqttClient, connect, IClientSubscribeOptions, IClientOptions, IClientPublishOptions, IPacket } from 'mqtt';

import { Observable, using, Unsubscribable, fromEvent, Subject, merge } from 'rxjs';
import { share, finalize, map, shareReplay, filter, switchMapTo, switchMap, take, mapTo } from 'rxjs/operators';
import Debug from 'debug';

const DEBUG_TAG = 'oropel';

/**
 * Represents the current connection to the mqtt broker.
 */
class MqttConnection implements Unsubscribable {
  public client: MqttClient;

  private debug = Debug(`${DEBUG_TAG}:MqttConnection`);

  constructor(protected url?: string | unknown, protected opts?: IClientOptions) {}

  connect(): Observable<MqttClient> {
    this.client = connect(this.url, this.opts);
    this.debug('connect', this.client.options.clientId);

    const connect$ = fromEvent(this.client, 'connect');
    const error$ = fromEvent(this.client, 'error');
    this.client.on('end', () => {
      this.debug('closed', this.client?.options.clientId);
      this.client.removeAllListeners();
      this.client = null;
    });

    const connection$ = merge<MqttClient>(connect$.pipe(mapTo(this.client)), error$);

    return connection$;
  }

  unsubscribe(): void {
    if (this.client && this.client.connected) {
      this.client.end(true);
    }
  }
}

/**
 * Represents a subscription to a Topic
 */
class MqttSubscription implements Unsubscribable {
  private debug = Debug(`${DEBUG_TAG}:MqttSubscription`);
  private subscription$ = new Subject<void>();
  constructor(
    private client: MqttClient,
    private filterString: string,
    private opts: IClientSubscribeOptions = { qos: 1 },
  ) {}

  unsubscribe(): void {
    this.debug(`UNSubscribing from "${this.filterString}"`);
    this.client.unsubscribe(this.filterString);
  }

  connect(): Observable<void> {
    this.debug(`Subscribing to "${this.filterString}" with ${this.client.options.clientId}`);
    this.client.subscribe(this.filterString, this.opts, (err) => {
      if (err) {
        return this.subscription$.error(err);
      }
      this.subscription$.next();
      // Does not completes intentionally: Mimics the lifecycle for the
      // real subscription
    });
    return this.subscription$.asObservable();
  }
}

/**
 * The MQTT Client.
 *
 * It's lazy: Only connects to the mqtt broker when there is an active subscription to topics or you
 * want to publish. It disconnects when all consumers unsubscribe from it
 */
export class RxMqttClient {
  /** a map of all mqtt subscriptions by filter */
  private topicSubscriptions = new Map<string, Observable<Buffer>>();

  private client$: Observable<MqttClient>;
  private messages$: Observable<OnMessageEvent>;
  private debug = Debug(`${DEBUG_TAG}:RxMqttClient`);

  constructor(protected url?: string | unknown, protected opts?: IClientOptions) {
    const connection$ = using(
      () => new MqttConnection(url, opts),
      (connection: MqttConnection) => connection.connect(),
    );

    // The mother of the lamb (spanish expression)
    // allows to share the connection and once nobody is interested, closes the underlying
    this.client$ = connection$.pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.messages$ = this.client$.pipe(
      switchMap((client) => fromEvent<OnMessageEvent>(client, 'message')),
      share(), // avoid multiple client.on('message') when subscribing the observable
    );
  }

  /**s
   * disconnect disconnects from the mqtt broker.
   * This method `should` be executed when leaving the application.
   */
  async disconnect(force = true): Promise<void> {
    return new Promise((resolve, reject) => {
      // TODO: should not subscribe: When there is not a conection, it will connect to a new one and disconnect
      this.client$.subscribe(
        (client) => client.connected && client.end(force, (err: Error) => (err ? reject(err) : resolve())),
      );
    });
  }

  /**
   * Setups a subscription to a mqtt topic.
   *
   * Returns an observable that will only emit messages matching the filter.
   * The first one subscribing to the resulting observable executes a mqtt subscribe.
   * The last one unsubscribing this filter executes a mqtt unsubscribe.
   */
  public topic(filterString: string, opts: IClientSubscribeOptions): Observable<Buffer> {
    // Use a small cache to allow reutilization of MqttSubscription when calling several times topic fn
    // ex: the following code shares a subscription
    // const aTopic = mqtt.topic('a/topic');
    // const anotherATopic = mqtt.topic('a/topic');
    // aTopic.subscribe(...)
    // aTopic.subscribe(...)
    // anotherATopic.subscribe(...)

    if (!this.topicSubscriptions.get(filterString)) {
      const subscription = this.client$.pipe(
        switchMap((client) => {
          return using(
            () => new MqttSubscription(client, filterString, opts),
            (mqttSubscription: MqttSubscription) =>
              mqttSubscription.connect().pipe(
                finalize(() => {
                  // this way we remove from cache when no more subscriptions are alive
                  this.debug('Removing subscription from cache');
                  this.topicSubscriptions.delete(filterString);
                }),
              ),
          );
        }),
        switchMapTo(this.messages$),
        share(), // multicast!
        filter(([topic, , packet]) => packet.cmd === 'publish' && filterMatchesTopic(filterString, topic)),
        map(([, payload]) => payload),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.topicSubscriptions.set(filterString, subscription);
    }
    return this.topicSubscriptions.get(filterString);
  }

  /**
   * Publish a message.
   *
   * All publications will be enqueued until a real connectiond to the broker is stablished.
   */
  public async publish(topic: string, message: string, options?: PublishOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client$.pipe(take(1)).subscribe((client) => {
        this.debug(`Publish message to "${topic}" topic`, client.options.clientId);
        client.publish(topic, message, options, (err: Error) => {
          if (err) {
            return reject(err);
          }
          resolve(message);
        });
      });
    });
  }
}

interface MqttMessage extends IPacket {
  /** the mqtt topic to which this message was published to */
  topic: string;
  /** the payload */
  payload: Uint8Array;
  /** the quality of service */
  qos: number;
  /** if this message is a retained message */
  retain: boolean;
  /** if this message is a duplicate */
  dup: boolean;
}

type PublishOptions = IClientPublishOptions;

type OnMessageEvent = [string, Buffer, MqttMessage];

/**
 * determine whether a MQTT topic matches a given filter.
 *
 * The matching rules are specified in the MQTT
 * standard documentation
 *
 * From https://github.com/sclausen/ngx-mqtt/
 *
 * @param filter A filter may contain wildcards like '#' and '+'.
 * @param topic  A topic may not contain wildcards.
 * @return true on match and false otherwise.
 */
export function filterMatchesTopic(filterString: string, topic: string): boolean {
  if (filterString[0] === '#' && topic[0] === '$') {
    return false;
  }
  // Preparation: split and reverse on '/'. The JavaScript split function is sane.
  const fs = (filterString || '').split('/').reverse();
  const ts = (topic || '').split('/').reverse();
  // This function is tail recursive and compares both arrays one element at a time.
  const match = (): boolean => {
    // Cutting of the last element of both the filter and the topic using pop().
    const f = fs.pop();
    const t = ts.pop();
    switch (f) {
      // In case the filter level is '#', this is a match no matter whether
      // the topic is undefined on this level or not ('#' matches parent element as well!).
      case '#':
        return true;
      // In case the filter level is '+', we shall dive into the recursion only if t is not undefined.
      case '+':
        return t ? match() : false;
      // In all other cases the filter level must match the topic level,
      // both must be defined and the filter tail must match the topic
      // tail (which is determined by the recursive call of match()).
      default:
        return f === t && (f === undefined ? true : match());
    }
  };
  return match();
}
