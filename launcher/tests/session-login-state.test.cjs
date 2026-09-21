const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSessionLoginState } = require("../electron/session-login-state.cjs");

function cookie(name, domain, extra = {}) {
  return {
    name,
    value: `${name}-value`,
    domain,
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...extra,
  };
}

test("session transfer retains only portable ChatGPT/OpenAI state", () => {
  const state = validateSessionLoginState({
    cookies: [
      cookie("chatgpt", ".chatgpt.com"),
      cookie("openai", "auth.openai.com"),
      cookie("partitioned", ".chatgpt.com", { partitionKey: "https://accounts.google.com" }),
      cookie("identity-provider", ".accounts.google.com"),
      cookie("lookalike", ".chatgpt.com.attacker.example"),
      cookie("userinfo", "attacker.example@chatgpt.com"),
      cookie("port", "chatgpt.com:443"),
    ],
    origins: [
      { origin: "https://chatgpt.com", localStorage: [{ name: "chat", value: "kept" }] },
      { origin: "https://auth.openai.com", localStorage: [{ name: "auth", value: "ignored" }] },
      { origin: "https://accounts.google.com", localStorage: [{ name: "idp", value: "ignored" }] },
    ],
  });

  assert.deepEqual(state.cookies.map(value => value.name), ["chatgpt", "openai"]);
  assert.equal(state.cookies[0].domain, ".chatgpt.com");
  assert.equal(state.cookies[1].domain, undefined);
  assert.deepEqual(state.localStorage, [{ name: "chat", value: "kept" }]);
});

test("session transfer fails closed without an allowed session cookie", () => {
  assert.throws(() => validateSessionLoginState({
    cookies: [cookie("google", ".accounts.google.com")],
    origins: [],
  }), /no ChatGPT\/OpenAI cookies/);
});

test("session transfer rejects malformed allowed-domain cookie fields", () => {
  assert.throws(() => validateSessionLoginState({
    cookies: [cookie("broken", ".chatgpt.com", { path: "relative" })],
    origins: [],
  }), /invalid cookie path/);
  assert.throws(() => validateSessionLoginState({
    cookies: [cookie("broken", ".chatgpt.com", { sameSite: "Unknown" })],
    origins: [],
  }), /invalid cookie SameSite/);
});
