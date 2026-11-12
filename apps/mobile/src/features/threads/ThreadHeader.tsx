import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { usePortalPhoneShell } from "../portal/shell/usePortalPhoneShell";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const isPortalPhone = usePortalPhoneShell();
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const files: AppBarAction | null = props.hasThreadCwd
    ? {
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        icon: "folder",
        selected: filesVisible,
        disabled: !props.gitControls.canOpenFiles,
        separateBackground: false,
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      }
    : null;
  const toolMenus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);
  // Portal's phone header keeps one "more" glyph so the title gets the width.
  const moreMenu: AppBarMenu = {
    title: props.title,
    accessibilityLabel: "More",
    icon: "ellipsis",
    status: props.subtitle,
    separateBackground: false,
    items: [
      ...(files === null
        ? []
        : [
            {
              id: "files",
              title: filesVisible ? "Close files" : "Files",
              icon: "folder",
              disabled: files.disabled,
              onPress: files.onPress,
            } satisfies AppBarMenuItem,
          ]),
      ...toolMenus.map((menu): AppBarMenuItem => ({
        id: menu.title,
        title: menu === gitMenu ? "Git" : menu.title,
        inline: true,
        items: menu.items,
      })),
    ],
  };
  const actions = isPortalPhone || files === null ? [] : [files];
  const menus = isPortalPhone ? [moreMenu] : toolMenus;

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
