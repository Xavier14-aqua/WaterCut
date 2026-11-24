import * as boxes from '../../organization';

import type { Project } from '../../../shared/models';

import { mutateProject } from '../transaction';

export function saveIdeaBox(directory: string, input: unknown): Project {
  return mutateProject(directory, (db) => boxes.saveIdeaBox(db, input));
}

export function deleteIdeaBox(directory: string, id: unknown): Project {
  return mutateProject(directory, (db) => boxes.deleteIdeaBox(db, id));
}

export function moveIdeasToBox(
  directory: string,
  ids: unknown,
  boxId: unknown,
): Project {
  return mutateProject(directory, (db) => boxes.moveIdeasToBox(db, ids, boxId));
}
