The Enriched Markdown tarball comes from Julius's [`fork/t3-mobile` branch](https://github.com/pingdotgg/enriched-markdown/tree/fork/t3-mobile). Its `t3-fork.json` records the exact source commit and upstream base. React block renderers, signed image sources, the `onLinksChange` link list (`renderers`, `resolveImageSource`, `onLinksChange`) and the iOS streaming memory bounds are upstream. The fork carries only changes with an open upstream PR: clipboard link metadata ([#962](https://github.com/software-mansion/enriched-markdown/pull/962)), development-host autolinks ([#961](https://github.com/software-mansion/enriched-markdown/pull/961)) and hash-route link fragments ([mity/md4c#454](https://github.com/mity/md4c/pull/454), arriving through [md4c#7](https://github.com/software-mansion-labs/md4c/pull/7)), `md4cFlags.preserveWindowsPaths`, which keeps backslashes in Windows drive paths in prose ([#1105](https://github.com/software-mansion/enriched-markdown/pull/1105), after [mity/md4c#477](https://github.com/mity/md4c/pull/477)), GitHub's strikethrough rules for `~` ([md4c#6](https://github.com/software-mansion-labs/md4c/pull/6)), `\(…\)` and `\[…\]` math delimiters ([#1043](https://github.com/software-mansion/enriched-markdown/pull/1043), [md4c#4](https://github.com/software-mansion-labs/md4c/pull/4)), iOS Copy as Markdown keeping bold spans whole ([#1143](https://github.com/software-mansion/enriched-markdown/pull/1143)), line breaks in copied table cells written as `<br>` ([#1144](https://github.com/software-mansion/enriched-markdown/pull/1144)), and Android measuring text in the span order its view draws it, so code blocks nested in list items no longer make a reply overlap the next message ([#1145](https://github.com/software-mansion/enriched-markdown/pull/1145)).

To replace it, commit the fork changes, run `yarn install --immutable` and `yarn workspace react-native-enriched-markdown prepare` in the fork checkout, then `node scripts/pack-t3.mjs /path/to/t3code/apps/mobile/deps`. Keep the package version aligned with Julius's `fork/t3-mobile` branch. Rename the archive to include the first eight characters of the source commit, such as `react-native-enriched-markdown-1.2.0-t3.18-4287c5d3.tgz`, so each build has a distinct dependency path without version bumps. Update the tarball path in `apps/mobile/package.json` and `pnpm-workspace.yaml`'s `allowBuilds`, and run `vp i` to update the lockfile. Native clients need rebuilding when this dependency changes.

Change a tarball in this directory through its fork, never with a pnpm patch: `.pnpmfile.cjs` fails the install when `patchedDependencies` names one, since the next tarball would drop the patch without a trace.

## Portal patches

This fork's Portal look needs two native changes that the forks above do not carry. Each lives as a plain diff in `patches/`, applied to the fork tarball and repacked under a `-portal1` name, so the patch stays visible next to the tarball it changed:

- `patches/react-native-screens-portal.patch` (iOS 26 and later) draws a pushed screen's back button as a bare chevron, without the glass circle UIKit puts behind the system back button, and keeps the edge and full-screen back swipes. It changes `ios/header/RNSHeaderCoordinator.h`, `ios/header/RNSHeaderCoordinator.mm`, `ios/helpers/stack/RNSStackNavigationController.mm` and `ios/stack/screen/RNSStackScreenController.mm`.
- `patches/react-native-enriched-markdown-portal.patch` (iOS) drops a code block's language label and divider, leaving the copy button alone in the top corner as in Portal. It changes `ios/segments/ENRMCodeBlockContainerView.m`. Android still draws the label.

When a new fork tarball arrives, reapply the patch to it:

```sh
mkdir -p /tmp/rn-portal && tar -xzf <new fork tarball> -C /tmp/rn-portal
(cd /tmp/rn-portal/package && patch -p1 < <this directory>/patches/<name>-portal.patch)
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf <this directory>/<fork tarball name without .tgz>-portal1.tgz -C /tmp/rn-portal package
```

A hunk that fails to apply means the fork changed that code; port the change by hand and regenerate the diff against the clean tarball with `diff -ruN`. Then delete the old tarball, point `apps/mobile/package.json` (and `allowBuilds` in `pnpm-workspace.yaml` for Enriched Markdown) at the new one, run `vp i`, and rebuild the native clients.
