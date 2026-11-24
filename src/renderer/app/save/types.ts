import type { Project } from '../../../shared/models';

export type SaveTask = {
  key: string;
  action: () => Promise<Project>;
};
