import * as boxes from '../../organization/idea-boxes';

import { openLibrary, transact } from '../database';

export function saveLibraryIdeaBox(root: string, input: unknown): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.saveIdeaBox(db, input));
  } finally {
    db.close();
  }
}

export function deleteLibraryIdeaBox(root: string, id: unknown): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.deleteIdeaBox(db, id));
  } finally {
    db.close();
  }
}

export function moveLibraryIdeasToBox(
  root: string,
  ids: unknown,
  boxId: unknown,
): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.moveIdeasToBox(db, ids, boxId));
  } finally {
    db.close();
  }
}
