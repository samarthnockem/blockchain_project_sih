import pino from "pino";
import { describe, expect, it } from "vitest";
import { logRedaction } from "./log-redaction.js";

function writeLog(payload: Record<string, unknown>) {
  let output = "";
  const stream = {
    write(chunk: string) {
      output += chunk;
    }
  };
  const testLogger = pino({ redact: logRedaction }, stream);

  testLogger.info(payload, "redaction test");

  return output;
}

describe("log redaction", () => {
  it("redacts authorization headers and cookies", () => {
    const output = writeLog({
      req: {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=secret-session"
        }
      }
    });

    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("authorization");
    expect(output).not.toContain("cookie");
  });

  it("redacts private keys, AES keys, wrapped keys, passwords, and seed phrases", () => {
    const output = writeLog({
      privateKey: "private-key-value",
      walletPrivateKey: "wallet-private-key-value",
      aesKey: "raw-aes-key-value",
      rawKey: "raw-key-value",
      wrappedAESKey: "wrapped-key-value",
      password: "password-value",
      seedPhrase: "seed-phrase-value"
    });

    expect(output).not.toContain("private-key-value");
    expect(output).not.toContain("wallet-private-key-value");
    expect(output).not.toContain("raw-aes-key-value");
    expect(output).not.toContain("raw-key-value");
    expect(output).not.toContain("wrapped-key-value");
    expect(output).not.toContain("password-value");
    expect(output).not.toContain("seed-phrase-value");
  });

  it("redacts full encrypted files and MongoDB credentials", () => {
    const output = writeLog({
      encryptedFile: "full-encrypted-file-contents",
      connectionString: "mongodb://user:secret-password@localhost:27017/secure-vault"
    });

    expect(output).not.toContain("full-encrypted-file-contents");
    expect(output).not.toContain("secret-password");
  });
});
