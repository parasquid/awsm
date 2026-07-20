import { browser } from "wxt/browser";
import type { AccountConfigurationV1 } from "../../drivers/indexeddb/schema";
import type { ServerConfigurationHost } from "../../runtime/account/server";

export class ChromeAccountServerHost implements ServerConfigurationHost {
  constructor(private readonly save: (configuration: AccountConfigurationV1) => Promise<void>) {}

  async requestPermission(pattern: string): Promise<boolean> {
    if (await browser.permissions.contains({ origins: [pattern] })) return true;
    return browser.permissions.request({ origins: [pattern] });
  }

  async probe(url: string): Promise<{
    readonly status: number;
    readonly redirected: boolean;
    readonly body: unknown;
  }> {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Awsm-Protocol-Version": "1",
        "Awsm-Request-ID": crypto.randomUUID(),
      },
    });
    return {
      status: response.status,
      redirected: response.redirected || (response.status >= 300 && response.status < 400),
      body: await response.json().catch(() => undefined),
    };
  }

  commit(configuration: AccountConfigurationV1): Promise<void> {
    return this.save(configuration);
  }
}
