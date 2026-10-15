import { describe, expect, it } from "vitest";
import { userMenuEntries } from "../../src/modules/identity/navigation";
import type { UserDto } from "../../src/modules/identity/service";

const account = (patch: Partial<UserDto>): UserDto => ({ id: "00000000-0000-4000-8000-000000000001", email: "member@example.test", nickname: "成员", role: "user", status: "normal", ...patch });

describe("A4 user menu entries follow the product baseline", () => {
  it("normal member gets the personal entries including settings", () => {
    expect(userMenuEntries(account({})).map((entry) => entry.key)).toEqual(["notifications", "articles", "bookmarks", "reports", "settings"]);
  });

  it("banned member keeps read-only entries without settings", () => {
    expect(userMenuEntries(account({ status: "banned" })).map((entry) => entry.key)).toEqual(["notifications", "articles", "bookmarks", "reports"]);
  });

  it("active admin gets the console entry while a banned admin does not", () => {
    expect(userMenuEntries(account({ role: "admin" })).map((entry) => entry.key)).toEqual(["notifications", "articles", "bookmarks", "reports", "settings", "admin"]);
    expect(userMenuEntries(account({ role: "admin", status: "banned" })).map((entry) => entry.key)).toEqual(["notifications", "articles", "bookmarks", "reports"]);
  });

  it("entries point at the product routes and keep stable labels", () => {
    const entries = userMenuEntries(account({ role: "admin" }));
    expect(entries.map((entry) => entry.href)).toEqual(["/notifications", "/me/articles", "/me/bookmarks", "/me/reports", "/settings/profile", "/admin"]);
    for (const entry of entries) {
      expect(entry.label.length).toBeGreaterThan(1);
      expect(entry.href.startsWith("/")).toBe(true);
    }
  });
});
