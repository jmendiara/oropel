const { RxMqttClient } = require('../lib');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new RxMqttClient(process.env.MQTT_SERVER_URL);

const firstTopic = client.topic('oropel/first');
const firstTopicCopy = client.topic('oropel/first');
const secondTopic = client.topic('oropel/second');


async function run() {
  console.log('Subscribe oropel/first. Client will connect now');
  const firstTopicSubscription = firstTopic.subscribe((buffer) => {
    console.log(' <== Received in firstTopic:', buffer.toString());
  });

  console.log('Subscribe to otherCopy of oropel/first. Connection will be reused');
  const firstTopicSubscriptionCopy = firstTopicCopy.subscribe((buffer) => {
    console.log(' <== Received in firstTopicCopy:', buffer.toString());
  });


  await client.publish('oropel/first', 'Hello world');

  console.log('Subscribe to oropel/second. Connection will be reused');
  secondTopic.subscribe((buffer) => {
    console.log(' <== Received in secondTopic:', buffer.toString());
  });


  await delay(100);
  console.log('Unubscribe firstTopic');
  firstTopicSubscription.unsubscribe();
  console.log('Unubscribe secondTopic. Client should disconnect now');
  firstTopicSubscriptionCopy.unsubscribe();


  await client.publish('oropel/first', 'Is missed');
  await client.publish('oropel/second', 'Hello Mars');

  await delay(10000);

  await client.disconnect();
}


run().catch((err) => {
  console.error(err);
  process.exit(1)
});

