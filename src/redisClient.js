import Redis from 'ioredis';
import tunnelssh from 'tunnel-ssh';
const fs = require('fs');
var Client = require('ssh2').Client;

// fix ioredis hgetall key has been toString()
Redis.Command.setReplyTransformer("hgetall", (result) => {
  let arr = [];
  for (let i = 0; i < result.length; i += 2) {
    arr.push([result[i], result[i + 1]]);
  }

  return arr;
});

export default {
  sshTunnelLocalAddress: [],
  clusterFirstSSHPort: 0,
  createConnection(host, port, auth, config) {
    const options = {
      connectTimeout: 3000,
      retryStrategy: (times) => {return this.retryStragety(times, {host, port})},
      enableReadyCheck: false,
      connectionName: config.connectionName ? config.connectionName : null,
      password: auth,
      tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
    };

    // var ssh = new Client();
    //=========================

    // var server = tunnelssh({
    //   username: 'qii',
    //   password: '123',
    //   host: '192.168.11.69',
    //   port: 22,
    //   readyTimeout: 2000,
    //   dstHost: '172.19.0.2',
    //   dstPort: 7000,
    //   localHost: '127.0.0.1',
    //   // localPort: 7000,
    // }, function (error, server) {
    //   console.log(server.address(), '=--=-=');
    // });
    // var server = tunnelssh({
    //   username: 'qii',
    //   password: '123',
    //   host: '192.168.11.69',
    //   port: 22,
    //   readyTimeout: 2000,
    //   dstHost: '172.19.0.2',
    //   dstPort: 7001,
    //   localHost: '127.0.0.1',
    //   // localPort: 7000,
    // }, function (error, server) {
    //   console.log(server.address(), '=--=-=');
    // });
    // var server = tunnelssh({
    //   username: 'qii',
    //   password: '123',
    //   host: '192.168.11.69',
    //   port: 22,
    //   readyTimeout: 2000,
    //   dstHost: '172.19.0.2',
    //   dstPort: 7002,
    //   localHost: '127.0.0.1',
    //   // localPort: 7000,
    // }, function (error, server) {
    //   console.log(server.address(), '=--=-=');
    // });

    const clusterOptions = {
      connectionName: options.connectionName,
      enableReadyCheck: false,
      redisOptions: options,
      natMap: {
        "172.19.0.2:7000": { host: "127.0.0.1", port: 7000 },
        "172.19.0.2:7001": { host: "127.0.0.1", port: 7001 },
        "172.19.0.2:7002": { host: "127.0.0.1", port: 7002 },
      },
    };
console.log('con---',{port, host});
    const client = config.cluster ?
                    // new Redis.Cluster([{port, host}], clusterOptions) :
                    new Redis.Cluster([{port, host}], clusterOptions) :
                    new Redis(port, host, options);

    client.get('0').then((reply) => {
      console.log('reply--------', reply);
    });

    return client;
  },

  createSSHConnection(sshOptions, host, port, auth, config) {
    const options = {
      connectTimeout: 3000,
      retryStrategy: (times) => {return this.retryStragety(times, {host, port})},
      enableReadyCheck: false,
      connectionName: config.connectionName ? config.connectionName : null,
      password: auth,
      tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
    };

    const sshConfig = {
      username: sshOptions.username,
      password: sshOptions.password,
      host: sshOptions.host,
      port: sshOptions.port,
      readyTimeout: 2000,
      dstHost: host,
      dstPort: port,
      localHost: '127.0.0.1',
      localPort: null,
      privateKey: sshOptions.privatekey ?
                  fs.readFileSync(sshOptions.privatekey) : '',
    };

    const sshConfigBak = JSON.parse(JSON.stringify(sshConfig));

    const sshPromise = new Promise((resolve, reject) => {
      var server = tunnelssh(sshConfig, (error, server) => {
        if (error) {
          reject(error);
        }
        else {
          const listenAddress = server.address();
          console.log('first ssh server address: ', listenAddress);
          this.clusterFirstSSHPort = listenAddress.port;

          // ssh cluster mode
              if (config.cluster || 1) {
                config.cluster = false;

                // config.host = listenAddress.address;
                // config.port = listenAddress.port;

                let client = this.createConnection(listenAddress.address, listenAddress.port, auth, config);

                // client.on('ready', () => {
                //   console.log('first client is ready', client);
                // });
                
                client.call('cluster', 'nodes', (err, reply) => {
                  // console.log('cluster nodes: ', err, reply);
                  // return;
                  let nodes = this.getClusterNodes(reply);
                  console.log('cluster master nodes: ', nodes);

                  this.createClusterSSHTunnels(sshConfigBak, nodes);
                  // 把第一次的也加进去
                  // this.sshTunnelLocalAddress.push({
                  //   localHost: '127.0.0.1', localPort: listenAddress.port,
                  //   dstHost: host, dstPort: port
                  // });

                  // console.log(this.sshTunnelLocalAddress, '-=-=-=-=-=-==');
                  setTimeout(() => {
                    const nodes = this.sshTunnelLocalAddress;
                    const natMap = this.initNatMap(nodes);
                    console.log('nat mapppppp is:', natMap);

                    const clusterOptions = {
                      connectionName: options.connectionName,
                      enableReadyCheck: false,
                      redisOptions: options,
                      natMap: natMap,
                    };

// console.log('preparing to connect...', nodes[0]);
                    const clusterClient = new Redis.Cluster([{port: nodes[0].localPort, host: nodes[0].localHost}], clusterOptions);
                    clusterClient.on('ready', () => {
                      console.log('clusterClient is ready', clusterClient);

                      // clusterClient.get('1').then((reply) => {
                      //   console.log(reply);
                      // }).catch((e) => {
                      //   console.log(e);
                      // });
                      for (var i = 0; i< 10; i++) {
                        clusterClient.get(i).then((reply) => {
                          console.log(reply);
                        });
                      }
                    });

                  }, 1000)
                })
              }

              return;

// =============
          // const listenAddress = server.address();
          const client = config.cluster ?
                          new Redis.Cluster([{port: listenAddress.port, host: listenAddress.address}], clusterOptions) :
                          new Redis(listenAddress.port, listenAddress.address, options);
          resolve(client);
        }
      });

      server.on('error', (error) => {
        alert('SSH Connection Error: ' + error.message);
        reject(error);
      });
    });

    return sshPromise;
  },

  getClusterNodes(nodes, type = 'master') {
    nodes = nodes.split("\n");
    let result = [];
    for (let node of nodes) {
      if (!node) continue;

      node = node.trim().split(' ');
      if (node[2].includes(type)) {
        let dsn = node[1];
        dsn = dsn.split('@')[0].split(':');
        result.push({host: dsn[0], port: dsn[1]})
      }
    }

    return result;
  },

  createClusterSSHTunnels(sshConfig, nodes) {
    // console.log(JSON.parse(JSON.stringify(sshConfig)), '((((((((((');return;
    for (let node of nodes) {
      if (node.port == this.clusterFirstSSHPort) {
        console.log('first port listened...continue...');
        // let line = {
        //   localHost: '127.0.0.1', localPort: 7000,
        //   dstHost: '172.19.0.2', dstPort: 7000
        // };
        // this.sshTunnelLocalAddress.push(line);
        continue;
      }

      let sshCopy = JSON.parse(JSON.stringify(sshConfig));

      sshCopy.dstHost = node.host;
      sshCopy.dstPort = node.port;

      console.log('sshing...', JSON.parse(JSON.stringify(sshCopy)));

      var server = tunnelssh(sshCopy, (error, server) => {
        let addr = server.address();
        let line = {
          localHost: addr.address, localPort: addr.port,
          dstHost: node.host, dstPort: node.port
        };
        console.log('sshing end...', addr, line);
        this.sshTunnelLocalAddress.push(line);
      });
    }
  },
  // "172.19.0.2:7000": { host: "192.168.11.69", port: 7000 },
  initNatMap(nodes) {
    // console.log('initing nat.....', nodes);
    let result = {};
    for (let line of nodes) {
      result[`${line.dstHost}:${line.dstPort}`] = {host: line.localHost, port: line.localPort};
    }
    return result;
  },

  getTLSOptions(options) {
    return {
      ca: options.ca ? fs.readFileSync(options.ca) : '',
      key: options.key ? fs.readFileSync(options.key) : '',
      cert: options.cert ? fs.readFileSync(options.cert) : '',

      checkServerIdentity: (servername, cert) => {
        // skip certificate hostname validation
        return undefined;
      },
      rejectUnauthorized: false,
    }
  },

  retryStragety(times, connection) {
    const maxRetryTimes = 3;

    if (times >= maxRetryTimes) {
      alert(`${connection.host}:${connection.port}\nToo Many Attempts To Reconnect. Please Check The Server Status!`);
      return false;
    }

    // reconnect after
    return Math.min(times * 200, 1000);
  },
};
