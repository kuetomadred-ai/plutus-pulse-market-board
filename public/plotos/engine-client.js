(function (global) {
  "use strict";

  function baseUrl(raw) {
    try {
      var url = new URL(String(raw || ""));
      if (
        (url.protocol === "https:" ||
          ((url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
            url.protocol === "http:")) &&
        !url.search &&
        !url.hash
      ) {
        return url.href.replace(/\/+$/, "");
      }
    } catch (error) {
      // Invalid API origins fail closed.
    }
    return "";
  }

  function request(apiBase, supabase, path, body) {
    if (!apiBase) {
      var unavailable = new Error("Trading API URL is not configured; trading is disabled.");
      unavailable.retryable = true;
      return Promise.reject(unavailable);
    }
    var demoToken = "";
    try {
      var demo = JSON.parse(localStorage.getItem("plutus_demo_device_v1") || "{}");
      demoToken = demo && demo.session && demo.session.access_token || "";
    } catch (ignore) {}
    var tokenPromise = demoToken ? Promise.resolve(demoToken) : supabase && supabase.auth
      ? supabase.auth.getSession().then(function (result) {
        return result.data && result.data.session && result.data.session.access_token || "";
      }) : Promise.resolve("");
    return tokenPromise.then(function (token) {
        if (!token) throw new Error("Please sign in again.");
        return fetch(apiBase + path, {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          credentials: "omit",
        });
      })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) throw new Error(data.error || "Trading API error " + response.status);
             return data;
          });
      });
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (character) {
      var random = (Math.random() * 16) | 0;
      return (character === "x" ? random : (random & 3) | 8).toString(16);
    });
  }

  global.PLUTUS_ENGINE_CLIENT = Object.freeze({ baseUrl: baseUrl, request: request, uuid: uuid });
})(window);
