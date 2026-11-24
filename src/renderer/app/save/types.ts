import type { Project } from '../../../shared/models';

export type SaveTask = {
  projectId: string;
  key: string;
  action: () => Promise<Project>;
};
