import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const decoder = readFileSync(
  new URL("../src-tauri/src/workbuddy/read_session.cjs", import.meta.url),
  "utf8",
);
/** Exercise the embedded session reader with fake plaintext sessions, without touching local credentials. */
function readToken(token: string): string {
  let output = "";
  runInNewContext(decoder, {
    require: (name: string) => {
      if (name === "fs")
        return {
          existsSync: () => false,
          readFileSync: () =>
            JSON.stringify({
              account: { uid: "demo" },
              auth: { accessToken: token },
            }),
        };
      if (name === "path")
        return { join: (...parts: string[]) => parts.join("/") };
      if (name === "os") return { homedir: () => "/demo" };
      if (name === "crypto") return {};
      throw Error("unexpected dependency");
    },
    process: {
      stdout: {
        write: (data: string) => {
          output += data;
        },
      },
      exit: () => {
        throw Error("session read failed");
      },
    },
  });
  return JSON.parse(output).token;
}
test("WorkBuddy plaintext JWT and uid-prefixed JWT both become a bearer token", () => {
  const jwt = "fakeHeader.fakePayload.fakeSignature";
  assert.equal(readToken(jwt), jwt);
  assert.equal(readToken("demo-user+" + jwt), jwt);
  assert.equal(readToken("demo-user+legacyOpaqueToken"), "legacyOpaqueToken");
});
