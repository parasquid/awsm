# Automated Chrome Extension Releases and Installation

**Document:** `docs/plans/12-automated-chrome-extension-releases-and-installation.md`

**Status:** Implemented

**Owner:** Engineering

**Last Updated:** 2026-07-21

**Depends On:** `README.md`, `ROADMAP.md`, `package.json`,
`apps/browser-extension/package.json`, `apps/browser-extension/scripts/verify-release.mjs`, and
`.github/workflows/coordination-server.yml`

---

# 1. Purpose

This is the decision-complete implementation plan for automatically validating, packaging, and
publishing the Chrome extension from Git tags. It is written for an implementer starting from a
cold checkout with no conversation context. Do not reopen the decisions recorded here.

The completed workflow SHALL:

1. run when a `v*` Git tag is pushed and support a manual non-publishing dry run;
2. publish only a tag whose version exactly matches the browser-extension package version and whose
   commit is contained in `main`;
3. run lint, typecheck, unit tests, the production build, the release-security verifier, and Chrome
   ZIP packaging;
4. never run the IndexedDB/OPFS integration suite, packaged-Chrome E2E suite, Playwright, Docker
   proof stacks, or synchronization proof;
5. create a friendly versioned Chrome ZIP and matching SHA-256 checksum;
6. publish a GitHub Release only after every validation and packaging step succeeds;
7. prepend a brief installation procedure to GitHub-generated change notes;
8. link each Release to installation documentation at that exact release tag; and
9. provide a canonical, complete Chrome installation, checksum, upgrade, and troubleshooting guide.

The implementation configures distribution only. It does not declare or publish the first stable
release. The user must separately declare the first release under repository policy before a stable
tag is pushed.

# 2. Scope and Non-Goals

## 2.1 In scope

- one Chrome-extension release workflow under `.github/workflows/`;
- `v*` tag-push and `workflow_dispatch` triggers;
- exact SemVer/package/tag validation;
- proof that the tagged commit belongs to `main`;
- stable-versus-prerelease classification from the package version;
- lint, typecheck, unit-test, production-build, security-verifier, and ZIP steps;
- friendly artifact naming, ZIP validation, and SHA-256 generation;
- a 14-day GitHub Actions artifact for successful tagged and manual runs;
- release publication with the ZIP, checksum, quick-install notes, generated change notes, and a
  tag-specific documentation link;
- a unit-tested release-metadata and notes renderer;
- a complete Chrome installation guide;
- README and Roadmap reconciliation;
- one real GitHub Actions manual dry run after the workflow reaches `main`; and
- commits and push needed to make that dry run possible.

## 2.2 Explicitly out of scope

- running on ordinary pushes to `main` or pull requests;
- integration tests, E2E tests, Playwright, browser launching, Docker Compose, Rails tests, or the
  two-Replica synchronization proof;
- Chrome Web Store packaging, signing, submission, review, or automatic updates;
- Firefox or another extension Host;
- changing extension product behavior, permissions, Vault formats, or protocol contracts;
- creating, moving, or deleting a release tag during implementation verification;
- creating a stable or prerelease GitHub Release during implementation verification;
- automatic package-version bumps, changelog generation, semantic-release, or conventional-commit
  version inference;
- overwriting an existing Release or release asset;
- a rolling Release whose assets are replaced in place;
- preserving compatibility with an earlier unpublished workflow design; and
- modifying `.github/workflows/coordination-server.yml`.

# 3. Fixed Release Contract

## 3.1 Trigger and version identity

- Add `.github/workflows/chrome-extension-release.yml` with exactly two triggers:
  - `push.tags: ["v*"]`; and
  - `workflow_dispatch` with no inputs.
- A tag-triggered run SHALL read `version` from `apps/browser-extension/package.json` and require the
  ref name to equal `v${version}` byte-for-byte.
- Accept package versions matching this restricted SemVer grammar:

  ```text
  MAJOR.MINOR.PATCH
  MAJOR.MINOR.PATCH-PRERELEASE
  ```

  where each numeric field is either `0` or begins with `1` through `9`, and `PRERELEASE` contains
  one or more dot-separated identifiers made from ASCII letters, digits, or hyphens. A purely
  numeric prerelease identifier also forbids leading zeroes. Reject leading/trailing separators,
  empty identifiers, build metadata (`+...`), whitespace, and a missing numeric field.

- A version containing a prerelease suffix is published with GitHub's prerelease flag. A version
  without the suffix is stable.
- A manual run derives the prospective tag and filenames from the package version but performs no
  release publication.
- Use a full-history checkout. For a tag-triggered run, peel the tag to its commit and require:

  ```bash
  git merge-base --is-ancestor "$(git rev-list -n 1 "$GITHUB_REF_NAME")" origin/main
  ```

  Fetch `origin/main` explicitly before this check. Failure stops the build and creates no Release.

## 3.2 Runtime and dependency setup

- Run on `ubuntu-latest` with a 20-minute job timeout.
- Use Node.js major version `22`.
- Run `corepack enable`, then `corepack pnpm install --frozen-lockfile` from the repository root.
- Do not install a standalone unpinned pnpm package. The root `packageManager` field remains the
  pnpm version authority.
- Set workflow-level permissions to `contents: read`. Override only the publishing job with
  `contents: write`.
- Use non-cancelling concurrency keyed by workflow name and full ref. A repeated run for a release
  tag SHALL queue rather than cancel an in-progress publisher.

## 3.3 Pinned Actions

Use these exact Action commits and retain the version comments in the workflow:

| Action                      | Commit SHA                                 | Version comment |
| --------------------------- | ------------------------------------------ | --------------- |
| `actions/checkout`          | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `v7.0.1`        |
| `actions/setup-node`        | `820762786026740c76f36085b0efc47a31fe5020` | `v7.0.0`        |
| `actions/upload-artifact`   | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | `v7.0.1`        |
| `actions/download-artifact` | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | `v8.0.1`        |

Do not replace these with mutable major tags. Updating an Action is separate dependency work that
must re-resolve and review its exact commit.

# 4. Release Metadata and Notes Renderer

## 4.1 Script boundary

Add `apps/browser-extension/scripts/chrome-release-metadata.mjs`. Keep release parsing and note
rendering outside YAML so it can be covered by unit tests.

The module SHALL export these pure functions:

```js
releaseMetadata({ version, eventName, refName, repository });
renderReleaseNotes(metadata);
```

`releaseMetadata` returns exactly:

```js
{
  version,
  tag: `v${version}`,
  prerelease,
  archiveName: `awsm-chrome-v${version}.zip`,
  checksumName: `awsm-chrome-v${version}.zip.sha256`,
  guideUrl:
    `https://github.com/${repository}/blob/v${version}/docs/guides/install-chrome-extension.md`
}
```

- Validate `repository` as exactly two nonempty slash-separated GitHub path components. Do not
  accept a URL, whitespace, query string, fragment, or extra path component.
- For `eventName === "push"`, reject a `refName` that is not exactly the derived tag.
- For `eventName === "workflow_dispatch"`, do not require a ref-name match and never return a
  publication instruction.
- Reject every other event name.
- Errors SHALL be deterministic and identify invalid version, repository, event, or tag mismatch
  without exposing secrets or environment dumps.

The executable portion of the module SHALL:

1. read the real browser-extension `package.json` relative to the script;
2. read `GITHUB_EVENT_NAME`, `GITHUB_REF_NAME`, `GITHUB_REPOSITORY`, and `GITHUB_OUTPUT`;
3. call the pure metadata function;
4. append `version`, `tag`, `prerelease`, `archive_name`, `checksum_name`, and `guide_url` to
   `GITHUB_OUTPUT`; and
5. write `dist/release-notes.md` using `renderReleaseNotes`.

Use Node filesystem APIs for the output files. Do not construct a shell heredoc containing Markdown
backticks or interpolate untrusted ref text into shell commands.

## 4.2 Quick-install Release notes

`renderReleaseNotes` SHALL emit this information before GitHub-generated change notes:

```markdown
## Install the Chrome extension

1. Download `<archiveName>` and `<checksumName>` from this Release.
2. Verify the ZIP against the checksum using the full installation guide.
3. Extract the ZIP into a permanent directory.
4. Open `chrome://extensions` in Chrome.
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the extracted directory containing `manifest.json`.
7. Keep that directory in place. For an upgrade, replace its contents and reload the extension from
   the same path.

[Read the full installation, checksum, upgrade, and troubleshooting guide](guideUrl).
```

- Substitute only values returned by `releaseMetadata`.
- End the file with exactly one newline.
- Do not include plaintext secrets, workflow URLs, runner paths, or an unversioned documentation
  link.
- The Release publisher SHALL pass this file as the prepended notes while also requesting GitHub-
  generated notes. Use `gh release create --notes "$(cat dist/release-notes.md)" --generate-notes`.

## 4.3 Unit coverage

Add `apps/browser-extension/scripts/chrome-release-metadata.test.mjs` using Node's built-in
`node:test` and strict assertions. Cover:

- stable `0.1.0` metadata;
- prerelease `0.1.0-rc.1` metadata;
- exact tag match and mismatch;
- manual event behavior;
- malformed versions, build metadata, invalid repository paths, and unsupported events;
- exact archive/checksum names;
- tag-specific guide URL;
- all seven ordered installation steps; and
- exactly one trailing newline.

Change the browser-extension `test` script to run this Node unit file before the existing Vitest
suite:

```json
"test": "node --test scripts/chrome-release-metadata.test.mjs && vitest run"
```

Do not broaden Vitest's include pattern or introduce another test dependency.

# 5. Build, Package, and Publish Jobs

## 5.1 Build job

Use one `build` job with `contents: read`. Its steps SHALL be ordered as follows:

1. checkout with full history;
2. set up Node 22;
3. enable Corepack;
4. install the frozen workspace;
5. create an empty repository-root `dist/` directory;
6. execute the metadata/notes renderer and expose its outputs at job level;
7. for a tag push, fetch and prove containment in `origin/main`;
8. run `corepack pnpm lint`;
9. run `corepack pnpm typecheck`;
10. run `corepack pnpm test`;
11. run `corepack pnpm build`;
12. run `corepack pnpm zip`;
13. locate exactly one `apps/browser-extension/.output/*-chrome.zip` file;
14. move it to `dist/<archive_name>`;
15. validate the ZIP and create its checksum; and
16. upload the ZIP, checksum, and `release-notes.md` as one Actions artifact.

The production `build` command is mandatory even though `zip` rebuilds the extension: `build` owns
`scripts/verify-release.mjs`, while `zip` owns the distributable archive.

The packaging step SHALL fail unless exactly one matching WXT Chrome ZIP exists. It SHALL then run:

```bash
unzip -t "dist/<archive_name>"
unzip -Z1 "dist/<archive_name>" | grep -Fx "manifest.json"
```

Require exactly one root `manifest.json`; a nested-only or duplicate manifest fails. Generate the
checksum from inside `dist/` so the checksum file contains only the archive basename:

```bash
cd dist
sha256sum "<archive_name>" > "<checksum_name>"
sha256sum --check "<checksum_name>"
```

Upload one artifact named `chrome-extension-<tag>` with:

- the ZIP;
- the checksum;
- `release-notes.md`;
- `if-no-files-found: error`;
- `retention-days: 14`; and
- `compression-level: 0`, because the ZIP is already compressed.

## 5.2 Publishing job

Add a `publish` job with these fixed properties:

- `needs: build`;
- `if: github.event_name == 'push'`;
- `contents: write` and no other elevated permission;
- the same ref-scoped non-cancelling concurrency behavior;
- check out the tagged repository with full history so GitHub CLI can generate notes and enforce the
  no-empty-release guard;
- download the named build artifact into `dist/`; and
- re-run `sha256sum --check` and the ZIP/root-manifest validations before publication.

Set `GH_TOKEN` from the job's `github.token`. Publish with `gh release create` and all of:

- the exact tag from the build output;
- `--verify-tag`;
- `--title <tag>`;
- `--generate-notes`;
- `--notes "$(cat dist/release-notes.md)"`;
- `--fail-on-no-commits`;
- both asset paths; and
- `--prerelease` only when the metadata output is `true`.

Do not pass `--clobber`, edit an existing Release, or replace an asset. `gh release create` stages
the Release as a draft while it uploads the supplied assets and publishes only afterward. Any
pre-existing Release for the tag is an explicit failure.

# 6. Full Chrome Installation Guide

Create `docs/guides/install-chrome-extension.md`. This is the canonical user-facing installation
guide; README and Release notes link to it rather than duplicating its full content.

The guide SHALL use these sections and behavior:

1. **Before you install**
   - AWSM is pre-release, unavailable from the Chrome Web Store, and manually updated.
   - Require Chrome 116 or newer and access to the private GitHub repository while it remains
     private.
   - Explain that Vault content and browser-local state remain on the user's device unless encrypted
     synchronization is configured.
2. **Download a Release**
   - Open the applicable GitHub Release.
   - Download the matching `.zip` and `.zip.sha256` assets; do not download GitHub's automatic
     `Source code` archives as the extension package.
3. **Verify the checksum**
   - Linux: `sha256sum --check <checksumName>`.
   - macOS: `shasum -a 256 -c <checksumName>`.
   - PowerShell: use `Get-FileHash -Algorithm SHA256`, parse the first token from the checksum file,
     compare case-insensitively, and throw on mismatch.
   - Stop and delete both downloads when verification fails; never advise bypassing the mismatch.
4. **Extract and load in Chrome**
   - Extract into a permanent path owned by the user.
   - The selected directory must contain `manifest.json` at its root.
   - Open `chrome://extensions`, enable Developer mode, select Load unpacked, choose that directory,
     and optionally pin AWSM.
5. **First launch**
   - Open AWSM and choose a compatible self-hosted Coordination Server or continue without sync.
   - Do not advertise a hosted AWSM service.
6. **Upgrade safely**
   - Create an encrypted Complete Export before replacement.
   - Verify and extract the new Release separately.
   - Preserve the original permanent installation path because changing it may produce a different
     extension identity and separate browser storage.
   - Replace the contents at that path, retain `manifest.json` at its root, then click Reload on
     `chrome://extensions`.
   - Do not promise downgrade or pre-release data compatibility.
7. **Troubleshooting**
   - checksum mismatch;
   - selecting a parent directory with a nested package;
   - missing root manifest;
   - developer-mode warning;
   - extension disabled because files moved or were deleted;
   - extension appears as a separate installation because the path changed; and
   - no automatic update after a newer Release is published.
8. **Build from source**
   - Require Node.js 22 and Corepack.
   - Run frozen installation and `corepack pnpm build`.
   - Load `apps/browser-extension/.output/chrome-mv3`.
   - Use `corepack pnpm zip` only when a local distributable is needed.

Use placeholders such as `<checksumName>` only inside explanatory command templates. Include one
concrete example using `awsm-chrome-v0.1.0.zip` and its checksum so the commands are copyable.

# 7. README and Roadmap Reconciliation

## 7.1 README

- Keep a short **Install the Chrome Extension** section.
- Link **From a GitHub Release** to `docs/guides/install-chrome-extension.md` for checksum,
  extraction, upgrade, and troubleshooting details.
- State that Release notes contain the brief install procedure and the assets are a ZIP plus
  checksum.
- Add a maintainer subsection with the exact release procedure:
  1. update `apps/browser-extension/package.json` version;
  2. commit and push that change to `main`;
  3. create `v<version>` at that commit;
  4. push the tag; and
  5. wait for the workflow to publish the Release.
- Explain that `-alpha.N`, `-beta.N`, or `-rc.N` versions create prereleases and plain versions
  create stable Releases.
- State that failed validation creates no Release and that the tag must be handled explicitly before
  retrying with changed code.
- Do not claim that ordinary `main` pushes build or publish the extension.

## 7.2 Roadmap

- Remove the entire **Automated Chrome Extension Builds** initiative once the workflow, guide, and
  real manual dry run are complete.
- Do not move it to a completed section or restate implemented behavior elsewhere in the Roadmap.
- Search remaining Roadmap entries for dependencies on a rolling prerelease, stable public download
  link, or push-to-main release behavior and rewrite only stale dependencies.

# 8. Cold-Start Implementation Order

## Task 1: Release metadata and notes tests

- Write failing `node:test` cases for version parsing, event/tag behavior, filenames, guide URLs,
  and the seven-step notes body.
- Implement `chrome-release-metadata.mjs` minimally until those tests pass.
- Add the Node test to the existing package `test` script and prove the full unit command remains
  green.

## Task 2: Tag-driven build and publishing workflow

- Add the workflow with the exact triggers, SHA pins, permissions, job outputs, ordering, and
  validation defined in sections 3 and 5.
- Exercise metadata failure cases locally before relying on a GitHub run.
- Confirm no forbidden resource-intensive command appears in the workflow.

## Task 3: Release packaging validation

- Run the real build and ZIP commands.
- Rename, inspect, and hash the archive exactly as CI will.
- Inspect the notes preview and link target.
- Delete generated local `dist/` evidence after verification; never commit ZIPs or checksums.

## Task 4: Full installation documentation

- Add the canonical guide, condense README duplication, add the maintainer release procedure, and
  reconcile the Roadmap.
- Test every checksum command form for syntactic correctness on its named platform where available;
  PowerShell may be reviewed statically if unavailable.
- Check every relative documentation link and the generated tag-specific absolute URL.

## Task 5: Local completion gate

- Run all commands in section 9.1.
- Inspect the full diff for credentials, generated archives, mutable Action tags, broad permissions,
  and unrelated changes.
- Commit the implementation coherently and push `main` so GitHub can discover the workflow.

## Task 6: Real GitHub Actions dry run

- Snapshot `gh release list` and `git tag --list` before the run.
- Trigger `workflow_dispatch` against `main`, wait for success, and download its named Actions
  artifact into a temporary directory.
- Independently verify checksum, ZIP structure, root manifest, filenames, notes preview, and guide
  link.
- Prove the tag and Release snapshots are unchanged.
- Remove only the temporary downloaded artifact after inspection.
- If the run exposes a defect, fix it, repeat all affected local checks, commit, push, and rerun the
  manual workflow. Do not create a test tag as a shortcut.
- After the successful dry run, change this plan's status to `Implemented` and append the run ID,
  commit SHA, conclusion, downloaded artifact name, and exact verification commands under a final
  implementation-evidence section. Do not record credentials, signed URLs, or runner-local paths.

# 9. Required Verification

## 9.1 Local commands

Run from the repository root:

```bash
corepack pnpm exec prettier --check .github/workflows/chrome-extension-release.yml README.md ROADMAP.md docs/guides/install-chrome-extension.md docs/plans/12-automated-chrome-extension-releases-and-installation.md
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm zip
git diff --check
```

Do not run `test:integration`, `test:e2e`, `test:e2e:chrome`, `test:sync-proof`, Rails/RSpec, or a
Docker proof command for this task.

After `zip`, perform the exact `unzip`, root-manifest, rename, checksum creation, and checksum check
from section 5.1 against a temporary output directory. Generated build output remains ignored and
must not be staged.

## 9.2 Static workflow audit

Before pushing, prove:

- only `v*` tag pushes and manual dispatch trigger the workflow;
- manual dispatch cannot enter the publishing job;
- only the publishing job has `contents: write`;
- no workflow step uses a secret other than the scoped `github.token`;
- every Action reference equals the full SHA in section 3.3;
- dependency installation is frozen;
- the tagged commit must belong to `main`;
- build runs before ZIP;
- release verification runs through `corepack pnpm build`;
- assets are revalidated after job transfer;
- quick-install notes and GitHub-generated notes are both requested;
- the guide URL includes the exact version tag; and
- no integration, E2E, Playwright, Docker, Rails, or synchronization-proof command exists.

## 9.3 GitHub dry-run commands

After the implementation commit is on `main`:

```bash
gh workflow run chrome-extension-release.yml --ref main
gh run list --workflow chrome-extension-release.yml --event workflow_dispatch --limit 1
gh run watch <run-id> --exit-status
gh run download <run-id> --name chrome-extension-v<version> --dir <temporary-directory>
```

Within the downloaded artifact, run `sha256sum --check`, `unzip -t`, and the exact root-manifest
assertion. Read `release-notes.md` rather than trusting its presence. Compare tags and Releases with
the pre-run snapshots.

# 10. Acceptance Criteria

The task is complete only when all of the following are true:

- the new workflow is present on `main` and GitHub recognizes it;
- a manual dry run completes successfully on GitHub-hosted Ubuntu;
- the dry run publishes one Actions artifact containing the friendly ZIP, checksum, and notes
  preview;
- the downloaded checksum and ZIP validate independently;
- the ZIP has exactly one root `manifest.json`;
- the notes preview contains all seven quick-install steps and the exact tag-specific guide URL;
- the canonical installation guide covers download, verification on three platforms, installation,
  first launch, safe upgrades, troubleshooting, and source builds;
- tag/package mismatch, invalid SemVer, unsupported events, and malformed repository identity have
  unit coverage;
- a tag release cannot publish from a commit outside `main`;
- a failed build cannot create a Release;
- stable and prerelease classification is deterministic from the package version;
- no resource-intensive test appears in or was required by the release workflow;
- the manual dry run creates no tag and no Release;
- README and Roadmap contain no stale push-to-main or rolling-release contract;
- formatting, lint, typecheck, unit tests, production build, release verifier, and ZIP packaging pass;
- ignored build/download artifacts and credentials are absent from the staged diff;
- the implementation is committed and pushed; and
- no first stable Release is declared or created by this work.
- this plan is marked `Implemented` only after its GitHub dry-run evidence is recorded.

# 11. Commit Strategy

Use two coherent Conventional Commits after the local gate passes:

1. `ci(extension): publish validated Chrome release assets`
   - workflow, metadata renderer, metadata unit tests, and package test-script change;
2. `docs(extension): add Chrome installation and release guide`
   - full guide, README, Roadmap, and this plan's final `Implemented` status and dry-run evidence.

Do not commit generated ZIPs, checksums, downloaded Actions artifacts, runner logs, credentials, or
temporary release/tag snapshots.

# 12. Implementation Evidence

- **Successful GitHub Actions run:** `29811073257`
- **Validated commit:** `87768ef41ccf795a7a8c042f2edd2a5f036388ed`
- **Conclusion:** `success`; the `build` job passed and the manual run skipped the `publish` job.
- **Downloaded artifact:** `chrome-extension-v0.1.0`
- **Publication proof:** Git tag and GitHub Release snapshots were unchanged by the manual run.
- **Runner correction:** The first dry run exposed invalid pnpm 11 dependency-build placeholders.
  Commit `87768ef41ccf795a7a8c042f2edd2a5f036388ed` replaced the removed pnpm 10 setting with explicit
  boolean approvals for the two existing required build dependencies before the successful rerun.

The downloaded artifact was independently verified with these commands, where
`<artifact-directory>` is a temporary local directory and `<snapshot>` identifies the matching
pre-run or post-run snapshot file:

```bash
gh run view 29811073257 --json databaseId,headSha,status,conclusion,workflowName,jobs
gh run download 29811073257 --name chrome-extension-v0.1.0 --dir <artifact-directory>
cd <artifact-directory>
sha256sum --check awsm-chrome-v0.1.0.zip.sha256
unzip -t awsm-chrome-v0.1.0.zip
test "$(unzip -Z1 awsm-chrome-v0.1.0.zip | grep -Fxc 'manifest.json')" -eq 1
test "$(grep -Ec '^[1-7]\. ' release-notes.md)" -eq 7
grep -Fx '[Read the full installation, checksum, upgrade, and troubleshooting guide](https://github.com/parasquid/awsm/blob/v0.1.0/docs/guides/install-chrome-extension.md).' release-notes.md
cmp <tags-before-snapshot> <tags-after-snapshot>
cmp <releases-before-snapshot> <releases-after-snapshot>
```
