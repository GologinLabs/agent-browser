import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../src/lib/errors";
import { extractCookieArray, normalizeCookiesForPlaywright } from "../src/lib/cookieNormalizer";

test("normalizeCookiesForPlaywright accepts GoLogin exported cookies", () => {
  const cookies = normalizeCookiesForPlaywright([
    {
      name: "c_user",
      value: "123",
      domain: ".facebook.com",
      path: "/",
      expirationDate: 1790000000.25,
      httpOnly: true,
      secure: true,
      sameSite: "no_restriction",
      hostOnly: false,
      session: false
    }
  ]);

  assert.deepEqual(cookies, [
    {
      name: "c_user",
      value: "123",
      domain: ".facebook.com",
      path: "/",
      expires: 1790000000.25,
      httpOnly: true,
      secure: true,
      sameSite: "None"
    }
  ]);
});

test("normalizeCookiesForPlaywright omits unspecified sameSite", () => {
  const [cookie] = normalizeCookiesForPlaywright([
    {
      name: "presence",
      value: "abc",
      domain: ".facebook.com",
      path: "/",
      sameSite: "unspecified"
    }
  ]);

  assert.equal(cookie.sameSite, undefined);
  assert.equal(cookie.path, "/");
});

test("normalizeCookiesForPlaywright accepts url-only Playwright cookies", () => {
  const [cookie] = normalizeCookiesForPlaywright([
    {
      name: "sid",
      value: "abc",
      url: "https://example.com/login",
      sameSite: "Lax"
    }
  ]);

  assert.deepEqual(cookie, {
    name: "sid",
    value: "abc",
    url: "https://example.com/login",
    sameSite: "Lax"
  });
});

test("normalizeCookiesForPlaywright rejects cookies without url or domain", () => {
  assert.throws(
    () =>
      normalizeCookiesForPlaywright([
        {
          name: "sid",
          value: "abc",
          sameSite: "lax"
        }
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "BAD_REQUEST");
      assert.match(error.message, /either url or domain/);
      return true;
    }
  );
});

test("extractCookieArray accepts profile-cookies --json output", () => {
  const cookies = [{ name: "sid", value: "abc", domain: "example.com" }];
  assert.equal(extractCookieArray({ profileId: "profile-1", cookies }), cookies);
});
