// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPageKey,
  classifyCurrentPage,
  fillLoginFields,
  findPrimaryLoginFields,
} from "./contentLogin";

describe("contentLogin classification", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/login");
    document.title = "Sign in";
  });

  it("classifies a standard login form", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="login" />
        <input type="password" name="password" />
        <button type="submit">Sign in</button>
      </form>
    `;
    expect(classifyCurrentPage().classification).toBe("login_form");
    expect(findPrimaryLoginFields()?.password).not.toBeNull();
  });

  it("classifies a Chinese JavaScript login button as a login form", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" placeholder="用户名" />
        <input type="password" placeholder="密码" />
        <button type="button">登录</button>
      </form>
    `;
    const fields = findPrimaryLoginFields();
    expect(classifyCurrentPage().classification).toBe("login_form");
    expect(fields?.username).not.toBeNull();
    expect(fields?.submit?.textContent).toContain("登录");
  });

  it("classifies a captcha page as manual_required", () => {
    document.body.innerHTML = `
      <div>Verify it's you</div>
      <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
    `;
    expect(classifyCurrentPage().classification).toBe("manual_required");
  });

  it("creates a stable page key from url and form shape", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" />
        <input type="password" />
      </form>
    `;
    expect(buildPageKey()).toContain("/login");
  });

  it("fills located login fields", () => {
    document.body.innerHTML = `
      <form>
        <input id="user" type="text" name="login" />
        <input id="pass" type="password" name="password" />
        <button type="submit">Sign in</button>
      </form>
    `;
    expect(fillLoginFields("devops@acme.cn", "secret")).toBe(true);
    expect((document.getElementById("user") as HTMLInputElement).value).toBe("devops@acme.cn");
    expect((document.getElementById("pass") as HTMLInputElement).value).toBe("secret");
  });
});
