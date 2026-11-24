import type { WaterCutAPI } from './contracts/api';

declare global {
  interface Window { watercut: WaterCutAPI; }
}
export {};
