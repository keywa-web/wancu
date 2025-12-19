const tls = require('tls');

exports.handler = async (event, context) => {
  const ipParam =
    (event.queryStringParameters &&
      event.queryStringParameters.ip) || '';

  if (!ipParam) {
    return jsonResponse(400, {
      error: 'mana proxynya? pakai ?ip=ip:port,ip:port',
    });
  }

  const proxyList = ipParam.split(',').map((s) => s.trim()).filter(Boolean);
  const limitedProxies = proxyList.slice(0, 10);
  let srvip = {};

  const sendRequest = (proxy, port, host, path, useProxy = true) => {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: useProxy ? proxy : host,
          port: useProxy ? port : 443,
          servername: host,
        },
        () => {
          const request =
            `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            `User-Agent: Mozilla/5.0\r\n` +
            `Referer: https://speed.cloudflare.com/\r\n` +
            `Connection: close\r\n\r\n`;
          socket.write(request);
        }
      );

      let responseBody = '';

      socket.on('data', (data) => {
        responseBody += data.toString();
      });

      socket.on('end', () => {
        const body = responseBody.split('\r\n\r\n')[1] || '';
        socket.end();
        resolve(body);
      });

      socket.on('error', (error) => {
        socket.end();
        reject(error);
      });

      socket.setTimeout(5000, () => {
        socket.end();
        reject(new Error('Request timeout'));
      });
    });
  };

  const checkProxy = async (proxyString) => {
    const [proxy, port = '443'] = proxyString.split(':');

    if (!proxy) {
      return { error: 'mana proxynya?', proxyip: false };
    }

    try {
      //
      // START MEASURE DELAY
      //
      const t0 = Date.now();

      // Request via proxy (ini yang mau dihitung delay-nya)
      const ipinfo = await sendRequest(
        proxy,
        port,
        'speed.cloudflare.com',
        '/meta',
        true
      );

      const delay = Date.now() - t0;

      //
      // Request langsung ke CF (bukan proxy)
      //
      const myips = await sendRequest(
        proxy,
        port,
        'speed.cloudflare.com',
        '/meta',
        false
      );

      const ipingfo = JSON.parse(ipinfo);
      const { clientIp, ...ipinfoh } = ipingfo;

      srvip = JSON.parse(myips);

      if (clientIp && clientIp !== srvip.clientIp) {
        return {
          proxy,
          port,
          proxyip: true,
          ip: clientIp,
          delay: `${delay} ms`,   // <= DITAMBAHKAN DI SINI
          ...ipinfoh,
        };
      } else {
        return {
          proxy,
          port,
          proxyip: false,
          delay: `${delay} ms`,
        };
      }
    } catch (error) {
      return {
        proxy,
        port,
        error: error.message,
        proxyip: false,
      };
    }
  };

  try {
    let result;

    if (limitedProxies.length === 1) {
      result = await checkProxy(limitedProxies[0]);
    } else {
      result = await Promise.all(limitedProxies.map(checkProxy));
    }

    srvip = {};
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, { error: error.message || 'internal error' });
  }
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data, null, 2),
  };
}
