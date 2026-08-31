import type * as graphStore from './store';
import type { WebMcpHost, WebMcpTool } from './types';

declare global {
  interface Document {
    modelContext?: WebMcpHost;
  }

  interface Navigator {
    modelContext?: WebMcpHost;
  }

  interface Window {
    chalkboard: {
      graph: typeof graphStore;
      TOOLS: WebMcpTool[];
      runTool: (
        name: string,
        args: Record<string, unknown>,
        source?: 'you' | 'agent',
      ) => Promise<unknown>;
    };
  }
}

export {};
