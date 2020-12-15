
# oropel

Minimalistic Reactive MQTT client, using RxJS, with a fluent async api

## Getting Started

```sh
npm i oropel
```

### Basic Usage

```js
import { RxMqttClient } from 'oropel';

const client = new RxMqttClient('mqtt://localhost:1883');

client.topic('test').subscribe((msg) => console.log(msg.toString()));
await client.publish('test', 'hello world');
```


## Development setup

To clone the repository use the following commands:

```sh
git clone https://github.com/jmendiara/oropel && cd oropel
```

Use [VSCode development containers](https://code.visualstudio.com/docs/remote/containers),  directly [docker-compose](https://docs.docker.com/compose/)

```sh
# Shell interactive session inside a container
docker-compose run app bash
```

### Available Scripts

- `clean` - remove coverage data, Jest cache and transpiled files,
- `build` - transpile TypeScript to ES6,
- `watch` - interactive watch mode to automatically transpile source files,
- `lint` - lint source files and tests,
- `test` - run tests,
- `test:watch` - interactive watch mode to automatically re-run tests
- `format` - format the code

## License

Copyright 2020 Javier Mendiara Cañardo

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
