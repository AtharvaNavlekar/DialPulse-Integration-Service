import type http from 'node:http';
import type { InlineConfig, Plugin } from 'vite';

export function isViteClientModuleId(id: string): boolean {
  const cleanId = id.split('?')[0]?.replace(/\\/g, '/') ?? '';
  return (
    cleanId.endsWith('/vite/dist/client/client.mjs') ||
    cleanId === '/@vite/client'
  );
}

export function stripViteClientAutoConnect(code: string): string {
  const connectCallPattern =
    /(^|\r?\n)transport\.connect\(createHMRHandler\(handleMessage\)\);?/g;
  if (!connectCallPattern.test(code)) {
    return code;
  }
  return code.replace(
    connectCallPattern,
    '$1/* HMR disabled: WebSocket auto-connect skipped */'
  );
}

export function createDisableHmrClientPlugin(): Plugin {
  return {
    name: 'dialpulse-disable-hmr-websocket',
    enforce: 'pre',
    transform(code, id) {
      if (!isViteClientModuleId(id)) {
        return null;
      }
      const nextCode = stripViteClientAutoConnect(code);
      if (nextCode === code) {
        return null;
      }
      return {
        code: nextCode,
        map: null,
      };
    },
  };
}

export function buildViteMiddlewareOptions(options: {
  disableHmr: boolean;
  httpServer?: http.Server;
}): InlineConfig {
  if (options.disableHmr) {
    return {
      appType: 'spa',
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      plugins: [createDisableHmrClientPlugin()],
    };
  }

  return {
    appType: 'spa',
    server: {
      middlewareMode: true,
      ...(options.httpServer ? { ws: { server: options.httpServer } } : {}),
    },
  };
}
