import type { ApplicationContext } from '../services/application-context';
import { registerApplicationIPC } from './application';
import { registerSettingsIPC } from './settings';
import { registerProjectIPC } from './project';
import { registerDeliveryIPC } from './delivery';
import { registerMediaIPC } from './media';
import { registerLibraryIPC } from './library';
import { registerAiIPC } from './ai';

export function registerIPC(context: ApplicationContext) {
  registerApplicationIPC(context);
  registerSettingsIPC(context);
  registerProjectIPC(context);
  registerDeliveryIPC(context);
  registerMediaIPC(context);
  registerLibraryIPC(context);
  registerAiIPC(context);
}
