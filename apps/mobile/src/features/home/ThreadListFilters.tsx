import type { EnvironmentId } from "@t3tools/contracts";

import type { MenuProps } from "../../components/ui/Menu.types";
import { ListFilterLens } from "../layout/workspace/ListFilterLens";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

/** The thread list's environment and project scope, as Portal's list lens. */
export function ThreadListFilters(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
}) {
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  const active = selectedEnvironment !== undefined || selectedProject !== undefined;
  const label = active
    ? [selectedEnvironment?.label, selectedProject?.label].filter(Boolean).join(" · ")
    : "All threads";
  const actions: MenuProps["actions"] = [
    {
      id: "environment",
      title: "Environment",
      displayInline: true,
      subactions: [
        {
          id: "environment:all",
          title: "All environments",
          state: props.selectedEnvironmentId === null ? "on" : "off",
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          state:
            environment.environmentId === props.selectedEnvironmentId
              ? ("on" as const)
              : ("off" as const),
        })),
      ],
    },
    ...(props.projects.length > 0
      ? [
          {
            id: "project",
            title: "Project",
            displayInline: true,
            subactions: [
              {
                id: "project:all",
                title: "All projects",
                state: props.selectedProjectKey === null ? ("on" as const) : ("off" as const),
              },
              ...props.projects.map((project) => ({
                id: `project:${project.key}`,
                title: project.label,
                state:
                  project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
              })),
            ],
          },
        ]
      : []),
  ];
  const select = (id: string) => {
    if (id === "environment:all") props.onEnvironmentChange(null);
    else if (id === "project:all") props.onProjectChange(null);
    else if (id.startsWith("environment:")) {
      const environment = props.environments.find(
        (candidate) => `environment:${candidate.environmentId}` === id,
      );
      if (environment) props.onEnvironmentChange(environment.environmentId);
    } else if (id.startsWith("project:")) {
      const project = props.projects.find((candidate) => `project:${candidate.key}` === id);
      if (project) props.onProjectChange(project.key);
    }
  };
  return (
    <ListFilterLens
      title="Filter threads"
      label={label}
      active={active}
      actions={actions}
      onSelect={select}
      onClear={() => {
        props.onEnvironmentChange(null);
        props.onProjectChange(null);
      }}
      clearAccessibilityLabel="Clear thread filters"
    />
  );
}
