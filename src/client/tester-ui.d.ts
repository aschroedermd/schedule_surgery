declare module '@surgical-board-simulator/tester-ui' {
  import type { ComponentType } from 'react';
  const Tester: ComponentType<{ apiBase: string; userName: string; backHref?: string; reviewHref?: string }>;
  export default Tester;
}
