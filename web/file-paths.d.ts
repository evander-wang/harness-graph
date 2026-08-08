export type UiFile = {
  path: string;
  kind: "workflow" | "skill" | "check" | "model";
};

export type UiDetail = {
  catalog: {
    name: string;
    path: string;
  };
  files: UiFile[];
};

export type UiStep = {
  workflowName?: string;
  call?: string;
  checks: string[];
};

export function filesForStep(detail: UiDetail, step: UiStep): UiFile[];
