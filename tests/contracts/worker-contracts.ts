import type { DataClient } from '../../src/main/services/data-client';
import type { WaterCutAPI } from '../../src/contracts/api';
import type { Project } from '../../src/shared/models';

// Compiled by typecheck, never executed. These must remain compile-time errors
// so a stringly-typed transport cannot accidentally replace the contract.
export function verifyContracts(client: DataClient, api: WaterCutAPI) {
  const read: Promise<Project> = client.call('project', 'readProject', [
    'example.watercut',
  ]);
  // @ts-expect-error database handles are not part of the worker whitelist
  client.call('project', 'openDatabase', ['example.watercut']);
  // @ts-expect-error the project directory is required
  client.call('project', 'readProject', []);
  // @ts-expect-error project editing is not a global-library command
  client.call('library', 'reorderShots', ['example.watercut', []]);
  // @ts-expect-error unknown module names cannot be dispatched
  client.call('arbitrary-module', 'readProject', ['example.watercut']);
  // @ts-expect-error the renderer receives no direct database capability
  api.openDatabase('example.watercut');
  return read;
}
