import { expect, test } from "@playwright/test";
import {
  appRequest,
  archiveFixture,
  createSynchronizedClient,
  faultControl,
  loginSynchronizedClient,
  sharedDeletedBase,
  vacuumDeleted,
  waitForSynchronizedState,
} from "./server-switch-support";

test("preserves the source context across candidate authentication failures", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(600_000);
  expect(browserName).toBe("chromium");
  const password = "correct horse archive battery";
  const sourceEmail = `failure-source-${crypto.randomUUID()}@example.test`;
  const candidateEmail = `failure-candidate-${crypto.randomUUID()}@example.test`;
  const source = await createSynchronizedClient(
    testInfo,
    "failure-source",
    "http://127.0.0.1:3300",
    sourceEmail,
    password,
  );
  const candidate = await createSynchronizedClient(
    testInfo,
    "failure-candidate",
    "http://127.0.0.1:3301",
    candidateEmail,
    password,
  );
  try {
    const library = await source.context.newPage();
    await library.goto(`chrome-extension://${source.extensionId}/library.html`);
    await appRequest(library, {
      type: "BeginServerSwitch",
      candidateOrigin: "http://127.0.0.1:3301",
      expectedVaultId: source.vaultId,
    });
    await expect(
      appRequest(library, {
        type: "LoginServerSwitchCandidate",
        email: candidateEmail,
        password: "definitely incorrect password",
      }),
    ).rejects.toThrow("AUTHENTICATION_FAILED");
    await expect(
      appRequest(library, {
        type: "LoginServerSwitchCandidate",
        email: `unknown-${crypto.randomUUID()}@example.test`,
        password,
      }),
    ).rejects.toThrow("AUTHENTICATION_FAILED");
    const fixture = await source.context.newPage();
    await fixture.goto("http://127.0.0.1:4174/fixture");
    await archiveFixture(source, fixture, 1);
    await waitForSynchronizedState(library, "http://127.0.0.1:3300");
    await expect(
      appRequest(library, {
        type: "LoginServerSwitchCandidate",
        email: candidateEmail,
        password,
      }),
    ).rejects.toThrow("SERVER_SWITCH_VAULT_MISMATCH");
    const failed = await appRequest<{
      account: {
        accountState: string;
        configuration: { serverOrigin?: string };
      };
      serverSwitch?: { state: string; errorId?: string };
    }>(library, { type: "GetState" });
    expect(failed).toMatchObject({
      account: {
        accountState: "Authenticated",
        configuration: { serverOrigin: "http://127.0.0.1:3300" },
      },
      serverSwitch: {
        state: "Failed",
        errorId: "SERVER_SWITCH_VAULT_MISMATCH",
      },
    });
    await library.getByRole("button", { name: "Settings" }).click();
    await expect(
      library.getByText("This Account already contains a different Vault"),
    ).toBeVisible();
    await library.screenshot({
      path: testInfo.outputPath("server-switch-vault-mismatch-desktop.png"),
    });
    await library.setViewportSize({ width: 420, height: 800 });
    await library.screenshot({
      path: testInfo.outputPath("server-switch-vault-mismatch-narrow.png"),
    });
    await waitForSynchronizedState(library, "http://127.0.0.1:3300");
  } finally {
    await candidate.context.close();
    await source.context.close();
  }
});

test("reauthenticates a candidate switch before and after remote application", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(900_000);
  expect(browserName).toBe("chromium");
  const password = "correct horse archive battery";
  const beforeSourceEmail = `reauth-before-source-${crypto.randomUUID()}@example.test`;
  const beforeCandidateEmail = `reauth-before-candidate-${crypto.randomUUID()}@example.test`;
  const before = await createSynchronizedClient(
    testInfo,
    "reauth-before",
    "http://127.0.0.1:3300",
    beforeSourceEmail,
    password,
  );
  let after: Awaited<ReturnType<typeof sharedDeletedBase>> | undefined;
  try {
    const beforePage = await before.context.newPage();
    await beforePage.goto(`chrome-extension://${before.extensionId}/library.html`);
    await appRequest(beforePage, {
      type: "BeginServerSwitch",
      candidateOrigin: "http://127.0.0.1:3301",
      expectedVaultId: before.vaultId,
    });
    await faultControl(
      beforePage,
      "arm-authentication-expiry",
      "server-switch:after-candidate-authentication",
    );
    const expiredBefore = await appRequest<{
      account: { configuration: { serverOrigin?: string } };
      serverSwitch?: { jobId: string; state: string };
    }>(beforePage, {
      type: "SignupServerSwitchCandidate",
      email: beforeCandidateEmail,
      password,
    });
    expect(expiredBefore).toMatchObject({
      account: { configuration: { serverOrigin: "http://127.0.0.1:3300" } },
      serverSwitch: { state: "AuthenticationRequired" },
    });
    const beforeJobId = expiredBefore.serverSwitch?.jobId;
    expect(beforeJobId).toBeDefined();
    await faultControl(beforePage, "release");
    await appRequest(beforePage, {
      type: "LoginServerSwitchCandidate",
      email: beforeCandidateEmail,
      password,
    });
    await waitForSynchronizedState(beforePage, "http://127.0.0.1:3301");

    after = await sharedDeletedBase(testInfo, "reauth-after");
    await vacuumDeleted(after.page, after.client.vaultId);
    await appRequest(after.page, {
      type: "BeginServerSwitch",
      candidateOrigin: "http://127.0.0.1:3300",
      expectedVaultId: after.client.vaultId,
    });
    await faultControl(
      after.page,
      "arm-authentication-expiry",
      "server-switch:after-remote-activation",
    );
    const expiredAfter = await appRequest<{
      account: { configuration: { serverOrigin?: string } };
      serverSwitch?: { jobId: string; state: string };
    }>(after.page, {
      type: "LoginServerSwitchCandidate",
      email: after.sourceEmail,
      password,
    });
    expect(expiredAfter).toMatchObject({
      account: { configuration: { serverOrigin: "http://127.0.0.1:3301" } },
      serverSwitch: { state: "AuthenticationRequired" },
    });
    const afterJobId = expiredAfter.serverSwitch?.jobId;
    expect(afterJobId).toBeDefined();
    await faultControl(after.page, "release");
    await appRequest(after.page, {
      type: "LoginServerSwitchCandidate",
      email: after.sourceEmail,
      password,
    });
    await waitForSynchronizedState(after.page, "http://127.0.0.1:3300");
  } finally {
    await after?.client.context.close();
    await before.context.close();
  }
});

test("reports a concurrent candidate rewrite after accepted Union authority truthfully", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(900_000);
  expect(browserName).toBe("chromium");
  const setup = await sharedDeletedBase(testInfo, "concurrent-union");
  let source: Awaited<ReturnType<typeof loginSynchronizedClient>> | undefined;
  try {
    source = await loginSynchronizedClient(
      testInfo,
      "concurrent-union-source",
      "http://127.0.0.1:3300",
      setup.sourceEmail,
      setup.password,
    );
    const sourcePage = await source.context.newPage();
    await sourcePage.goto(`chrome-extension://${source.extensionId}/library.html`);
    const sourceFixture = await source.context.newPage();
    await sourceFixture.goto("http://127.0.0.1:4174/fixture");
    await sourceFixture.evaluate(() => {
      document.title = "Source Event accepted before candidate rewrite";
      document.body.dataset.branch = "concurrent-source";
    });
    await archiveFixture(source, sourceFixture, 3);

    await appRequest(sourcePage, {
      type: "BeginServerSwitch",
      candidateOrigin: "http://127.0.0.1:3301",
      expectedVaultId: source.vaultId,
    });
    await faultControl(sourcePage, "arm", "server-switch:after-first-union-event");
    const switching = appRequest<{
      account: { configuration: { serverOrigin?: string } };
      serverSwitch?: {
        state: string;
        reason?: string;
        candidateAuthorityChanged?: boolean;
      };
    }>(sourcePage, {
      type: "LoginServerSwitchCandidate",
      email: setup.candidateEmail,
      password: setup.password,
    }).catch(async (error) => {
      const diagnostic = await faultControl(sourcePage, "status");
      throw new Error(
        `Concurrent switch setup failed (${JSON.stringify(diagnostic.lastFailure)})`,
        {
          cause: error,
        },
      );
    });
    await expect
      .poll(async () => (await faultControl(sourcePage, "status")).reached, {
        timeout: 120_000,
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const groups = await appRequest<readonly { captures: readonly unknown[] }[]>(setup.page, {
          type: "ListLibrary",
          expectedVaultId: setup.client.vaultId,
        });
        return groups.reduce((total, group) => total + group.captures.length, 0);
      })
      .toBe(3);
    await vacuumDeleted(setup.page, setup.client.vaultId);
    await faultControl(sourcePage, "release");

    const conflicted = await switching;
    expect(conflicted).toMatchObject({
      account: { configuration: { serverOrigin: "http://127.0.0.1:3300" } },
      serverSwitch: {
        state: "Conflict",
        reason: "DivergedGeneration",
        candidateAuthorityChanged: true,
      },
    });
    await sourcePage.getByRole("button", { name: "Settings" }).click();
    await expect(
      sourcePage.getByText("Server switch stopped after a concurrent change", { exact: false }),
    ).toBeVisible();
    await expect(
      sourcePage.getByText("Neither Vault was overwritten.", { exact: false }),
    ).toBeVisible();
    await sourcePage.screenshot({
      path: testInfo.outputPath("server-switch-concurrent-conflict-desktop.png"),
    });
    await sourcePage.setViewportSize({ width: 420, height: 800 });
    await sourcePage.screenshot({
      path: testInfo.outputPath("server-switch-concurrent-conflict-narrow.png"),
    });
    await sourcePage.getByRole("button", { name: "Try another server" }).click();

    await sourceFixture.evaluate(() => {
      document.title = "Source remains live after concurrent switch conflict";
      document.body.dataset.branch = "post-conflict-source";
    });
    await archiveFixture(source, sourceFixture, 4);
    await waitForSynchronizedState(sourcePage, "http://127.0.0.1:3300");
  } finally {
    await source?.context.close();
    await setup.client.context.close();
  }
});
