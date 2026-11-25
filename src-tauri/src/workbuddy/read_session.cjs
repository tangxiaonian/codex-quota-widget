// Runs inside the installed WorkBuddy runtime. Credentials stay in the private pipe to Rust.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
try {
  const file = path.join(
    require("os").homedir(),
    "Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info",
  );
  if (fs.existsSync(file + ".logged-out")) process.exit(3);
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  let key;
  /** Decode only the selected field using this installed WorkBuddy runtime. */
  function readField(value) {
    if (typeof value === "string") return value;
    if (value?.$wbEncrypted !== 1) return "";
    if (!key) {
      const settings = JSON.parse(
        process
          ._linkedBinding("electron_browser_workbuddy_storage")
          .loggerGet(),
      );
      key = crypto
        .createHash("sha256")
        .update(settings.atRestSecretKey, "utf8")
        .digest();
    }
    const envelope = JSON.parse(
      Buffer.from(value.envelope, "base64").toString("utf8"),
    );
    const id = crypto
      .createHash("sha256")
      .update(key)
      .digest("hex")
      .slice(0, 16);
    if (envelope.suite !== 1 || envelope.keyId !== id) throw Error();
    const word = (n) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const text = (s) =>
      Buffer.concat([word(Buffer.byteLength(s)), Buffer.from(s)]);
    const aad = Buffer.concat([
      Buffer.from("WB-AAD\0\x01"),
      text("WBEV1"),
      text("sym-v1"),
      word(1),
      text(id),
      Buffer.from([2, 0, 0]),
    ]);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64"),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
  let token = readField(
    session.auth?.accessToken ?? session.token ?? session.access_token,
  );
  if (token.includes("+")) token = token.slice(token.indexOf("+") + 1);
  if (!token) process.exit(3);
  const account = session.account ?? {};
  process.stdout.write(
    JSON.stringify({
      token,
      uid: account.uid,
      name: account.email || account.nickname || "WorkBuddy 账号",
      enterprise: account.enterpriseId || "",
      domain: session.auth?.domain || "",
    }),
  );
  key?.fill(0);
} catch {
  process.exit(2);
}
