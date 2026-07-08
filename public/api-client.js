(function initSecondApiClient(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondApiClient = api;
  if (typeof window === "object") window.SecondApiClient = api;
  if (typeof globalThis === "object") globalThis.SecondApiClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondApiClient(root) {
  "use strict";

  async function request(url, options = {}, env = {}) {
    const fetchImpl = env.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") throw new Error("Fetch API is unavailable");
    const init = { ...options };
    if (init.body && typeof init.body !== "string") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
      init.body = JSON.stringify(init.body);
    }
    const res = await fetchImpl(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function createStateStream(path = "/api/events", env = {}) {
    const EventSourceImpl = env.EventSourceImpl || root.EventSource;
    if (typeof EventSourceImpl !== "function") return null;
    return new EventSourceImpl(path);
  }

  return {
    createStateStream,
    request,
  };
});
