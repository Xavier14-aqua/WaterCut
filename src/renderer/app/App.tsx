import { AppShell } from './AppShell';
import { useAppController } from './useAppController';

export function App() {
  const model = useAppController();
  return <AppShell model={model} />;
}
