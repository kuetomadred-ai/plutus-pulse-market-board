/* Biquote is the sole market-data provider for PLUTUS. */
(function (global) {
  "use strict";

  var BASE_URL = "https://biquote.io";
  var REQUEST_TIMEOUT_MS = 10000;
  var RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
  var STREAM_TIMEOUT_MS = 45000;
  var CHUNK_SIZE = 100;
  var stream = {
    connection: null,
    symbols: [],
    tickHandlers: [],
    stateHandlers: [],
    reconnectTimer: null,
    reconnectAttempt: 0,
    starting: null,
    stopped: false,
    lastTickKey: "",
    lastTickAt: 0,
  };

  function BiquoteError(message, status, retryAfter) {
    this.name = "BiquoteError";
    this.message = message || "Biquote request failed";
    this.status = status || 0;
    this.retryAfter = retryAfter || 0;
    if (Error.captureStackTrace) Error.captureStackTrace(this, BiquoteError);
  }
  BiquoteError.prototype = Object.create(Error.prototype);
  BiquoteError.prototype.constructor = BiquoteError;

  function uniqueSymbols(symbols) {
    var seen = Object.create(null);
    return (symbols || [])
      .map(function (symbol) {
        return String(symbol || "")
          .trim()
          .toUpperCase();
      })
      .filter(function (symbol) {
        if (!symbol || seen[symbol]) return false;
        seen[symbol] = true;
        return true;
      });
  }

  function reportState(state, detail) {
    stream.stateHandlers.slice().forEach(function (handler) {
      try {
        handler(state, detail || null);
      } catch (ignore) {}
    });
  }

  function request(path, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    return fetch(BASE_URL + path, Object.assign({ signal: controller.signal }, options || {}))
      .then(function (response) {
        clearTimeout(timer);
        if (response.ok) return response.json();
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            var retryAfter = Number(response.headers.get("Retry-After") || 0);
            throw new BiquoteError(
              body.message || body.error || "Biquote HTTP " + response.status,
              response.status,
              retryAfter,
            );
          });
      })
      .catch(function (error) {
        clearTimeout(timer);
        if (error && error.name === "AbortError")
          throw new BiquoteError("Biquote request timed out", 0, 0);
        throw error;
      });
  }

  function getSymbols() {
    // Keep recently quoted instruments visible while their market is closed.
    return request("/api/symbols?quotedWithinDays=7").then(function (items) {
      if (!Array.isArray(items))
        throw new BiquoteError("Biquote returned an invalid symbol catalogue");
      return items;
    });
  }

  function getQuote(symbol, allowStale) {
    var safeSymbol = encodeURIComponent(
      String(symbol || "")
        .trim()
        .toUpperCase(),
    );
    return request(
      "/api/" + safeSymbol + "?allowStale=" + (allowStale === false ? "false" : "true"),
    );
  }

  function getQuotes(symbols) {
    var names = uniqueSymbols(symbols);
    if (!names.length) return Promise.resolve({});
    var chunks = [];
    for (var index = 0; index < names.length; index += CHUNK_SIZE)
      chunks.push(names.slice(index, index + CHUNK_SIZE));
    return chunks.reduce(function (chain, chunk) {
      return chain.then(function (all) {
        var query = chunk
          .map(function (symbol) {
            return "symbols=" + encodeURIComponent(symbol);
          })
          .join("&");
        return request("/api/latest?" + query).then(function (result) {
          Object.keys(result || {}).forEach(function (symbol) {
            all[symbol] = result[symbol];
          });
          return all;
        });
      });
    }, Promise.resolve({}));
  }

  function getHistoricalCandles(symbol, interval, limit) {
    var safeSymbol = encodeURIComponent(
      String(symbol || "")
        .trim()
        .toUpperCase(),
    );
    var supported = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
    if (supported.indexOf(interval) < 0)
      return Promise.reject(new BiquoteError("Unsupported Biquote interval: " + interval));
    var size = Math.max(1, Math.min(1000, Number(limit) || 300));
    return request(
      "/api/" + safeSymbol + "/ohlc?interval=" + encodeURIComponent(interval) + "&limit=" + size,
    ).then(function (payload) {
      if (!payload || !Array.isArray(payload.bars) || !payload.bars.length)
        throw new BiquoteError("Biquote returned invalid OHLC data");
      payload.bars.forEach(function (bar) {
        var timeValue = bar.openTime || bar.time || bar.t;
        var numericTime =
          typeof timeValue === "string" && isNaN(Number(timeValue))
            ? Date.parse(timeValue)
            : Number(timeValue);
        var values = [numericTime, bar.open, bar.high, bar.low, bar.close];
        if (
          values.some(function (value) {
            return !isFinite(Number(value));
          })
        )
          throw new BiquoteError("Biquote returned malformed OHLC data");
        if (Number(bar.high) < Number(bar.low))
          throw new BiquoteError("Biquote returned inverted OHLC range");
      });
      return payload;
    });
  }

  function clearReconnectTimer() {
    if (stream.reconnectTimer) {
      clearTimeout(stream.reconnectTimer);
      stream.reconnectTimer = null;
    }
  }

  function invokeInChunks(connection, method, symbols) {
    return connection.invoke(method, symbols);
  }

  function queueReconnect(reason) {
    if (stream.stopped || stream.reconnectTimer) return;
    var delay =
      RECONNECT_DELAYS_MS[Math.min(stream.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    stream.reconnectAttempt += 1;
    reportState("reconnecting", { reason: reason || "stream closed", delay: delay });
    stream.reconnectTimer = setTimeout(function () {
      stream.reconnectTimer = null;
      connect();
    }, delay);
  }

  function makeConnection() {
    if (!global.signalR || !global.signalR.HubConnectionBuilder) {
      throw new BiquoteError("SignalR client library is unavailable");
    }
    var connection = new global.signalR.HubConnectionBuilder()
      .withUrl(BASE_URL + "/hubs/tick", {
        skipNegotiation: true,
        transport: global.signalR.HttpTransportType.WebSockets,
      })
      .withServerTimeout(STREAM_TIMEOUT_MS)
      .withKeepAliveInterval(15000)
      .withAutomaticReconnect(RECONNECT_DELAYS_MS)
      .build();

    function receiveTick(tick) {
      if (!tick || !tick.symbol) return;
      var key =
        String(tick.symbol).toUpperCase() +
        "|" +
        String(tick.bid || "") +
        "|" +
        String(tick.ask || "") +
        "|" +
        String(tick.time || tick.timestamp || "");
      var now = Date.now();
      if (key === stream.lastTickKey && now - stream.lastTickAt < 250) return;
      stream.lastTickKey = key;
      stream.lastTickAt = now;
      stream.tickHandlers.slice().forEach(function (handler) {
        try {
          handler(tick);
        } catch (ignore) {}
      });
    }
    connection.on("ReceiveTick", receiveTick);
    connection.on("Tick", receiveTick);
    connection.onreconnecting(function (error) {
      reportState("reconnecting", { reason: (error && error.message) || "SignalR reconnecting" });
    });
    connection.onreconnected(function () {
      stream.reconnectAttempt = 0;
      invokeInChunks(connection, "Subscribe", stream.symbols)
        .then(function () {
          reportState("live", { reconnected: true, count: stream.symbols.length });
        })
        .catch(function (error) {
          reportState("error", error);
          try {
            connection.stop();
          } catch (ignore) {}
        });
    });
    connection.onclose(function (error) {
      if (stream.connection === connection) queueReconnect(error && error.message);
    });
    return connection;
  }

  function connect() {
    clearReconnectTimer();
    if (stream.stopped || !stream.symbols.length) return Promise.resolve();
    if (stream.starting) return stream.starting;
    if (!stream.connection) {
      try {
        stream.connection = makeConnection();
      } catch (error) {
        reportState("error", error);
        queueReconnect(error.message);
        return Promise.reject(error);
      }
    }
    var connection = stream.connection;
    stream.starting = connection
      .start()
      .then(function () {
        if (stream.connection !== connection) return;
        return invokeInChunks(connection, "Subscribe", stream.symbols).then(function () {
          stream.reconnectAttempt = 0;
          reportState("live", { count: stream.symbols.length });
        });
      })
      .catch(function (error) {
        reportState("error", error);
        if (stream.connection === connection) {
          stream.connection = null;
          queueReconnect(error && error.message);
        }
        throw error;
      })
      .finally(function () {
        stream.starting = null;
      });
    return stream.starting;
  }

  function subscribeTicks(symbols, onTick, onState) {
    stream.symbols = uniqueSymbols(symbols);
    stream.stopped = false;
    if (typeof onTick === "function" && stream.tickHandlers.indexOf(onTick) < 0)
      stream.tickHandlers.push(onTick);
    if (typeof onState === "function" && stream.stateHandlers.indexOf(onState) < 0)
      stream.stateHandlers.push(onState);
    connect().catch(function () {});
    return function unsubscribe() {
      if (typeof onTick === "function")
        stream.tickHandlers = stream.tickHandlers.filter(function (handler) {
          return handler !== onTick;
        });
      if (typeof onState === "function")
        stream.stateHandlers = stream.stateHandlers.filter(function (handler) {
          return handler !== onState;
        });
    };
  }

  function stopTicks() {
    stream.stopped = true;
    clearReconnectTimer();
    var connection = stream.connection;
    stream.connection = null;
    stream.starting = null;
    if (connection) return connection.stop().catch(function () {});
    return Promise.resolve();
  }

  global.BiquoteAdapter = {
    name: "Biquote",
    baseUrl: BASE_URL,
    getSymbols: getSymbols,
    getQuote: getQuote,
    getQuotes: getQuotes,
    getHistoricalCandles: getHistoricalCandles,
    subscribeTicks: subscribeTicks,
    stopTicks: stopTicks,
    Error: BiquoteError,
  };
})(window);
