import { app } from 'electron';
import { projectStorageRoot } from './storage-paths';
import {
  readStorageSettings,
  assertExternalDataRoot,
} from './storage-settings';
import type { StorageSettings } from '../../shared/models';

export function storage(): StorageSettings {
  return readStorageSettings(
    app.getPath('userData'),
    projectStorageRoot(
      app.getAppPath(),
      app.getPath('exe'),
      app.getPath('documents'),
    ),
  );
}

export function activeLibraryRoot() {
  const root = storage().libraryRoot;
  assertExternalDataRoot(root);
  return root;
}

export function activeProjectsRoot() {
  const root = storage().projectsRoot;
  assertExternalDataRoot(root);
  return root;
}
